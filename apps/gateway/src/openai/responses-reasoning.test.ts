import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import { ResponsesStreamEncoder } from './responses-stream.js';
import {
  chatCompletionToResponse,
  parseResponsesRequest,
  responsesToChatCompletion,
} from './responses.js';

interface ParsedEvent extends Readonly<Record<string, unknown>> {
  readonly type: string;
  readonly sequence_number: number;
}

function parseWire(wire: string): ParsedEvent {
  const data = wire
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  if (!data) throw new Error('missing SSE data');
  return JSON.parse(data) as ParsedEvent;
}

function chunk(
  delta: Readonly<Record<string, unknown>>,
  finishReason: string | null = null,
  usage?: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({
    id: 'chatcmpl_reasoning_123',
    created: 123,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  });
}

describe('Responses refusal and reasoning compatibility', () => {
  it('translates bounded reasoning configuration without downgrade', () => {
    const request = parseResponsesRequest({
      model: 'coding',
      input: 'Solve carefully.',
      reasoning: { effort: 'high', summary: 'concise' },
    });

    expect(request.reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(responsesToChatCompletion(request)).toEqual({
      model: 'coding',
      messages: [{ role: 'user', content: 'Solve carefully.' }],
      stream: false,
      reasoning_effort: 'high',
      reasoning_summary: 'concise',
    });
  });

  it('rejects unsupported or malformed reasoning configuration', () => {
    const invalidValues: readonly unknown[] = [
      null,
      { effort: 'maximum' },
      { effort: 3 },
      { summary: 'full' },
      { summary: null },
      { context: 'all_turns' },
      { effort: 'high', extra: true },
    ];

    for (const reasoning of invalidValues) {
      expect(() =>
        parseResponsesRequest({ model: 'coding', input: 'hello', reasoning }),
      ).toThrowError(GatewayHttpError);
    }
  });

  it('normalizes explicit upstream reasoning summary and refusal', () => {
    expect(
      chatCompletionToResponse(
        {
          id: 'chatcmpl_refusal',
          created: 123,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                reasoning_summary: 'Checked the safety boundary.',
                refusal: 'I cannot help with that request.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 5,
            total_tokens: 13,
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        },
        'coding',
        { type: 'text' },
        { effort: 'high', summary: 'concise' },
      ),
    ).toMatchObject({
      reasoning: { effort: 'high', summary: 'concise' },
      output: [
        {
          type: 'reasoning',
          status: 'completed',
          summary: [
            { type: 'summary_text', text: 'Checked the safety boundary.' },
          ],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'refusal', refusal: 'I cannot help with that request.' },
          ],
        },
      ],
      usage: {
        input_tokens: 8,
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 13,
      },
    });
  });

  it('does not expose raw reasoning_content as a summary', () => {
    const normalized = chatCompletionToResponse(
      {
        id: 'chatcmpl_private_reasoning',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Safe visible answer.',
              reasoning_content: 'private chain of thought',
            },
          },
        ],
      },
      'coding',
    );

    expect(JSON.stringify(normalized)).not.toContain(
      'private chain of thought',
    );
    expect(normalized).toMatchObject({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Safe visible answer.' }],
        },
      ],
    });

    const encoder = new ResponsesStreamEncoder({ model: 'coding' });
    const events = [
      ...encoder.push(
        chunk({
          content: 'Safe visible answer.',
          reasoning_content: 'private chain of thought',
        }),
      ),
      ...encoder.push(chunk({}, 'stop')),
      ...encoder.push('[DONE]'),
    ].map(parseWire);
    encoder.end();

    expect(events.map((event) => event.type)).not.toContain(
      'response.reasoning_summary_text.delta',
    );
    expect(JSON.stringify(events)).not.toContain('private chain of thought');
  });

  it('emits ordered reasoning summary and refusal lifecycle events', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      reasoning: { effort: 'high', summary: 'concise' },
      nowSeconds: () => 456,
    });

    const events = [
      ...encoder.push(chunk({ reasoning_summary: 'Safety ' })),
      ...encoder.push(chunk({ reasoning_summary: 'checked.' })),
      ...encoder.push(chunk({ refusal: 'I cannot ' })),
      ...encoder.push(chunk({ refusal: 'help.' })),
      ...encoder.push(
        chunk({}, 'stop', {
          prompt_tokens: 8,
          completion_tokens: 5,
          total_tokens: 13,
          completion_tokens_details: { reasoning_tokens: 3 },
        }),
      ),
      ...encoder.push('[DONE]'),
    ].map(parseWire);
    encoder.end();

    expect(events.map((event) => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.delta',
      'response.output_item.added',
      'response.content_part.added',
      'response.refusal.delta',
      'response.refusal.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary_part.done',
      'response.output_item.done',
      'response.refusal.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual(
      events.map((_, index) => index),
    );
    expect(events[10]).toMatchObject({ text: 'Safety checked.' });
    expect(events[13]).toMatchObject({ refusal: 'I cannot help.' });
    expect(events.at(-1)).toMatchObject({
      response: {
        reasoning: { effort: 'high', summary: 'concise' },
        output: [
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Safety checked.' }],
          },
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'I cannot help.' }],
          },
        ],
        usage: {
          output_tokens_details: { reasoning_tokens: 3 },
        },
      },
    });
  });

  it('fails closed for ambiguous or reordered upstream output', () => {
    const mixed = new ResponsesStreamEncoder({ model: 'coding' });
    expect(() =>
      mixed.push(chunk({ content: 'text', refusal: 'no' })),
    ).toThrowError(/multiple output kinds/);

    const switched = new ResponsesStreamEncoder({ model: 'coding' });
    switched.push(chunk({ content: 'hello' }));
    expect(() => switched.push(chunk({ refusal: 'no' }))).toThrowError(
      /switched between text and refusal/,
    );

    const lateReasoning = new ResponsesStreamEncoder({ model: 'coding' });
    lateReasoning.push(chunk({ reasoning_summary: 'first' }));
    lateReasoning.push(chunk({ content: 'hello' }));
    expect(() =>
      lateReasoning.push(chunk({ reasoning_summary: 'late' })),
    ).toThrowError(/reasoning after visible output/);

    const refusalAfterTool = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [
        {
          type: 'function',
          name: 'read_file',
          parameters: { type: 'object' },
        },
      ],
    });
    refusalAfterTool.push(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      }),
    );
    expect(() => refusalAfterTool.push(chunk({ refusal: 'no' }))).toThrowError(
      /refusal after a function call/,
    );
  });
});
