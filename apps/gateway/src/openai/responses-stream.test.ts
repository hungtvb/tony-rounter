import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import { ResponsesTextStreamEncoder } from './responses-stream.js';

interface ParsedEvent extends Readonly<Record<string, unknown>> {
  readonly type: string;
  readonly sequence_number: number;
}

function parseWire(wire: string): ParsedEvent {
  const lines = wire.trimEnd().split('\n');
  expect(lines[0]).toMatch(/^event: /);
  expect(lines[1]).toMatch(/^data: /);
  const parsed = JSON.parse(lines[1]!.slice(6)) as unknown;
  expect(parsed).toBeTypeOf('object');
  return parsed as ParsedEvent;
}

function chatChunk(
  delta: Readonly<Record<string, unknown>>,
  finishReason: string | null = null,
  usage?: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({
    id: 'chatcmpl_stream_123',
    object: 'chat.completion.chunk',
    created: 123,
    model: 'coding',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  });
}

describe('ResponsesTextStreamEncoder', () => {
  it('emits deterministic text lifecycle events with monotonic sequence numbers', () => {
    const encoder = new ResponsesTextStreamEncoder({
      model: 'coding',
      instructions: 'Be concise.',
      maxOutputTokens: 100,
      parallelToolCalls: false,
      temperature: 0.5,
      topP: 0.8,
      nowSeconds: () => 456,
    });

    const wires = [
      ...encoder.push(chatChunk({ role: 'assistant', content: 'Hel' })),
      ...encoder.push(chatChunk({ content: 'lo' })),
      ...encoder.push(
        chatChunk(
          {},
          'stop',
          { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        ),
      ),
      ...encoder.push('[DONE]'),
    ];
    encoder.end();

    const events = wires.map(parseWire);
    expect(events.map((event) => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(wires.join('')).not.toContain('[DONE]');

    expect(events[4]).toMatchObject({ delta: 'Hel' });
    expect(events[5]).toMatchObject({ delta: 'lo' });
    expect(events[6]).toMatchObject({ text: 'Hello' });
    expect(events[9]).toMatchObject({
      response: {
        id: 'resp_chatcmpl_stream_123',
        object: 'response',
        created_at: 123,
        completed_at: 456,
        status: 'completed',
        instructions: 'Be concise.',
        max_output_tokens: 100,
        model: 'coding',
        parallel_tool_calls: false,
        temperature: 0.5,
        top_p: 0.8,
        output: [
          {
            id: 'msg_chatcmpl_stream_123',
            type: 'message',
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Hello',
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 2,
          output_tokens: 3,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 5,
        },
      },
    });
  });

  it('accepts a final usage-only chunk before the terminal marker', () => {
    const encoder = new ResponsesTextStreamEncoder({ model: 'coding' });
    const wires = [
      ...encoder.push(chatChunk({ content: 'ok' }, 'stop')),
      ...encoder.push(
        JSON.stringify({
          id: 'chatcmpl_stream_123',
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      ),
      ...encoder.push('[DONE]'),
    ];

    const completed = parseWire(wires.at(-1)!);
    expect(completed).toMatchObject({
      type: 'response.completed',
      response: {
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
  });

  it('rejects tool-call deltas in the text-only slice', () => {
    const encoder = new ResponsesTextStreamEncoder({ model: 'coding' });

    expect(() =>
      encoder.push(
        chatChunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'write_file', arguments: '{' },
            },
          ],
        }),
      ),
    ).toThrowError(GatewayHttpError);
  });

  it('rejects unsupported and duplicate finish reasons', () => {
    const unsupported = new ResponsesTextStreamEncoder({ model: 'coding' });
    expect(() => unsupported.push(chatChunk({ content: 'x' }, 'length'))).toThrowError(
      /Unsupported streaming finish reason/,
    );

    const duplicate = new ResponsesTextStreamEncoder({ model: 'coding' });
    duplicate.push(chatChunk({ content: 'x' }, 'stop'));
    expect(() => duplicate.push(chatChunk({}, 'stop'))).toThrowError(
      /multiple finish reasons/,
    );
  });

  it('rejects truncated streams and terminal markers before a finish reason', () => {
    const truncated = new ResponsesTextStreamEncoder({ model: 'coding' });
    truncated.push(chatChunk({ content: 'partial' }));
    expect(() => truncated.end()).toThrowError(/before the terminal event/);

    const missingFinish = new ResponsesTextStreamEncoder({ model: 'coding' });
    missingFinish.push(chatChunk({ content: 'partial' }));
    expect(() => missingFinish.push('[DONE]')).toThrowError(/before a finish reason/);
  });

  it('rejects data after completion and response IDs that change mid-stream', () => {
    const encoder = new ResponsesTextStreamEncoder({ model: 'coding' });
    encoder.push(chatChunk({ content: 'done' }, 'stop'));
    encoder.push('[DONE]');
    expect(() => encoder.push('[DONE]')).toThrowError(/after the terminal event/);

    const changed = new ResponsesTextStreamEncoder({ model: 'coding' });
    changed.push(chatChunk({ content: 'first' }));
    expect(() =>
      changed.push(
        JSON.stringify({
          id: 'chatcmpl_other',
          choices: [{ index: 0, delta: { content: 'second' }, finish_reason: null }],
        }),
      ),
    ).toThrowError(/ID changed/);
  });
});
