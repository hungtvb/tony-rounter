import { describe, expect, it } from 'vitest';

import { ResponsesStreamEncoder } from './responses-stream.js';

interface ParsedEvent extends Readonly<Record<string, unknown>> {
  readonly type: string;
  readonly sequence_number: number;
}

const WRITE_FILE_TOOL = {
  type: 'function' as const,
  name: 'write_file',
  description: 'Write content to a file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
};

const READ_FILE_TOOL = {
  type: 'function' as const,
  name: 'read_file',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

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
  id = 'chatcmpl_stream_123',
): string {
  return JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: 123,
    model: 'coding',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  });
}

function toolCall(
  index: number,
  fields: Readonly<{
    id?: string;
    name?: string;
    arguments?: string;
    type?: string;
  }>,
): Readonly<Record<string, unknown>> {
  return {
    index,
    ...(fields.id !== undefined ? { id: fields.id } : {}),
    ...(fields.type !== undefined ? { type: fields.type } : {}),
    function: {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.arguments !== undefined
        ? { arguments: fields.arguments }
        : {}),
    },
  };
}

function completedEvent(wires: readonly string[]): ParsedEvent {
  const completed = wires.map(parseWire).find((event) => {
    return event.type === 'response.completed';
  });
  expect(completed).toBeDefined();
  return completed!;
}

describe('ResponsesStreamEncoder', () => {
  it('emits deterministic text lifecycle events with monotonic sequence numbers', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      instructions: 'Be concise.',
      maxOutputTokens: 100,
      parallelToolCalls: false,
      temperature: 0.5,
      topP: 0.8,
      toolChoice: 'none',
      nowSeconds: () => 456,
    });

    const wires = [
      ...encoder.push(chatChunk({ role: 'assistant', content: 'Hel' })),
      ...encoder.push(chatChunk({ content: 'lo' })),
      ...encoder.push(
        chatChunk({}, 'stop', {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
        }),
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
        tool_choice: 'none',
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

  it('streams one function call with exact argument aggregation', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
      toolChoice: 'required',
      parallelToolCalls: false,
      nowSeconds: () => 456,
    });

    const wires = [
      ...encoder.push(
        chatChunk({
          role: 'assistant',
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              type: 'function',
              name: 'write_file',
              arguments: '{"path":"a',
            }),
          ],
        }),
      ),
      ...encoder.push(
        chatChunk({
          tool_calls: [toolCall(0, { arguments: '.txt","content":"ok"}' })],
        }),
      ),
      ...encoder.push(
        chatChunk({}, 'tool_calls', {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
        }),
      ),
      ...encoder.push('[DONE]'),
    ];
    encoder.end();

    const events = wires.map(parseWire);
    expect(events.map((event) => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(events[2]).toMatchObject({
      output_index: 0,
      item: {
        id: 'fc_call_1_0',
        type: 'function_call',
        status: 'in_progress',
        call_id: 'call_1',
        name: 'write_file',
        arguments: '',
      },
    });
    expect(events[3]).toMatchObject({
      item_id: 'fc_call_1_0',
      output_index: 0,
      delta: '{"path":"a',
    });
    expect(events[5]).toEqual({
      type: 'response.function_call_arguments.done',
      sequence_number: 5,
      item_id: 'fc_call_1_0',
      output_index: 0,
      arguments: '{"path":"a.txt","content":"ok"}',
    });
    expect(events[7]).toMatchObject({
      response: {
        model: 'coding',
        parallel_tool_calls: false,
        tool_choice: 'required',
        tools: [WRITE_FILE_TOOL],
        output: [
          {
            id: 'fc_call_1_0',
            type: 'function_call',
            status: 'completed',
            call_id: 'call_1',
            name: 'write_file',
            arguments: '{"path":"a.txt","content":"ok"}',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      },
    });
  });

  it('preserves deterministic order for parallel function calls', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL, READ_FILE_TOOL],
      parallelToolCalls: true,
    });

    const wires = [
      ...encoder.push(
        chatChunk({
          tool_calls: [
            toolCall(0, {
              id: 'call_write',
              type: 'function',
              name: 'write_file',
              arguments: '{"path":"a",',
            }),
            toolCall(1, {
              id: 'call_read',
              type: 'function',
              name: 'read_file',
              arguments: '{"path":"',
            }),
          ],
        }),
      ),
      ...encoder.push(
        chatChunk({
          tool_calls: [
            toolCall(0, { arguments: '"content":"x"}' }),
            toolCall(1, { arguments: 'a"}' }),
          ],
        }),
      ),
      ...encoder.push(chatChunk({}, 'tool_calls')),
      ...encoder.push('[DONE]'),
    ];

    expect(completedEvent(wires)).toMatchObject({
      response: {
        output: [
          {
            id: 'fc_call_write_0',
            call_id: 'call_write',
            name: 'write_file',
            arguments: '{"path":"a","content":"x"}',
          },
          {
            id: 'fc_call_read_1',
            call_id: 'call_read',
            name: 'read_file',
            arguments: '{"path":"a"}',
          },
        ],
      },
    });
  });

  it('keeps mixed text and function outputs in first-observed order', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
    });

    const wires = [
      ...encoder.push(chatChunk({ content: 'I will write it.' })),
      ...encoder.push(
        chatChunk({
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              type: 'function',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
      ...encoder.push(chatChunk({}, 'tool_calls')),
      ...encoder.push('[DONE]'),
    ];

    expect(completedEvent(wires)).toMatchObject({
      response: {
        output: [
          { type: 'message', content: [{ text: 'I will write it.' }] },
          { type: 'function_call', call_id: 'call_1', name: 'write_file' },
        ],
      },
    });
  });

  it('accepts a final usage-only chunk before the terminal marker', () => {
    const encoder = new ResponsesStreamEncoder({ model: 'coding' });
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

    expect(completedEvent(wires)).toMatchObject({
      response: {
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
  });

  it('rejects ambiguous or unauthorized function-call output', () => {
    const ambiguous = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
    });
    expect(() =>
      ambiguous.push(
        chatChunk({
          content: 'same event',
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/same delta/);

    const noTools = new ResponsesStreamEncoder({ model: 'coding' });
    expect(() =>
      noTools.push(
        chatChunk({
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/without configured tools/);

    const disabled = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
      toolChoice: 'none',
    });
    expect(() =>
      disabled.push(
        chatChunk({
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/tool_choice none/);

    const named = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL, READ_FILE_TOOL],
      toolChoice: { type: 'function', name: 'read_file' },
    });
    expect(() =>
      named.push(
        chatChunk({
          tool_calls: [
            toolCall(0, {
              id: 'call_1',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/other than tool_choice/);
  });

  it('rejects malformed indices, IDs, names, and parallel calls', () => {
    const skipped = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
    });
    expect(() =>
      skipped.push(
        chatChunk({
          tool_calls: [
            toolCall(1, {
              id: 'call_1',
              name: 'write_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/non-contiguous/);

    const changed = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
    });
    changed.push(
      chatChunk({
        tool_calls: [
          toolCall(0, {
            id: 'call_1',
            name: 'write_file',
            arguments: '{',
          }),
        ],
      }),
    );
    expect(() =>
      changed.push(
        chatChunk({
          tool_calls: [toolCall(0, { id: 'call_other', arguments: '}' })],
        }),
      ),
    ).toThrowError(/ID changed/);

    const serial = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL, READ_FILE_TOOL],
      parallelToolCalls: false,
    });
    serial.push(
      chatChunk({
        tool_calls: [
          toolCall(0, {
            id: 'call_1',
            name: 'write_file',
            arguments: '{}',
          }),
        ],
      }),
    );
    expect(() =>
      serial.push(
        chatChunk({
          tool_calls: [
            toolCall(1, {
              id: 'call_2',
              name: 'read_file',
              arguments: '{}',
            }),
          ],
        }),
      ),
    ).toThrowError(/parallel_tool_calls is false/);
  });

  it('rejects incompatible finish reasons and required calls that never occur', () => {
    const unsupported = new ResponsesStreamEncoder({ model: 'coding' });
    expect(() =>
      unsupported.push(chatChunk({ content: 'x' }, 'length')),
    ).toThrowError(/unsupported finish reason/);

    const required = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
      toolChoice: 'required',
    });
    expect(() =>
      required.push(chatChunk({ content: 'x' }, 'stop')),
    ).toThrowError(/required function call/);

    const wrongFinish = new ResponsesStreamEncoder({
      model: 'coding',
      tools: [WRITE_FILE_TOOL],
    });
    wrongFinish.push(
      chatChunk({
        tool_calls: [
          toolCall(0, {
            id: 'call_1',
            name: 'write_file',
            arguments: '{}',
          }),
        ],
      }),
    );
    expect(() => wrongFinish.push(chatChunk({}, 'stop'))).toThrowError(
      /stop after a function call/,
    );
  });

  it('rejects truncated streams, duplicate terminals, and changed response IDs', () => {
    const truncated = new ResponsesStreamEncoder({ model: 'coding' });
    truncated.push(chatChunk({ content: 'partial' }));
    expect(() => truncated.end()).toThrowError(/before the terminal event/);

    const missingFinish = new ResponsesStreamEncoder({ model: 'coding' });
    missingFinish.push(chatChunk({ content: 'partial' }));
    expect(() => missingFinish.push('[DONE]')).toThrowError(
      /before a finish reason/,
    );

    const encoder = new ResponsesStreamEncoder({ model: 'coding' });
    encoder.push(chatChunk({ content: 'done' }, 'stop'));
    encoder.push('[DONE]');
    expect(() => encoder.push('[DONE]')).toThrowError(
      /after the terminal event/,
    );

    const changed = new ResponsesStreamEncoder({ model: 'coding' });
    changed.push(chatChunk({ content: 'first' }));
    expect(() =>
      changed.push(chatChunk({ content: 'second' }, null, undefined, 'other')),
    ).toThrowError(/ID changed/);
  });
});
