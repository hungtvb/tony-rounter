import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { prepareResponsesStream } from './responses-stream-adapter.js';

const WRITE_FILE_TOOL = {
  type: 'function' as const,
  name: 'write_file',
  parameters: { type: 'object', properties: {} },
};

function event(data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

function chunk(
  content: string | null,
  finishReason: string | null = null,
): Readonly<Record<string, unknown>> {
  return {
    id: 'chatcmpl_adapter',
    created: 123,
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
      },
    ],
  };
}

function functionChunk(
  fields: Readonly<{
    id?: string;
    name?: string;
    arguments?: string;
    finishReason?: string | null;
  }>,
): Readonly<Record<string, unknown>> {
  return {
    id: 'chatcmpl_adapter',
    created: 123,
    choices: [
      {
        index: 0,
        delta:
          fields.id === undefined &&
          fields.name === undefined &&
          fields.arguments === undefined
            ? {}
            : {
                tool_calls: [
                  {
                    index: 0,
                    ...(fields.id !== undefined ? { id: fields.id } : {}),
                    function: {
                      ...(fields.name !== undefined
                        ? { name: fields.name }
                        : {}),
                      ...(fields.arguments !== undefined
                        ? { arguments: fields.arguments }
                        : {}),
                    },
                  },
                ],
              },
        finish_reason: fields.finishReason ?? null,
      },
    ],
  };
}

async function text(stream: Readable): Promise<string> {
  let output = '';
  for await (const value of stream) {
    if (typeof value === 'string') output += value;
    else if (value instanceof Uint8Array) {
      output += Buffer.from(value).toString('utf8');
    } else {
      throw new TypeError('Unexpected stream chunk');
    }
  }
  return output;
}

describe('prepareResponsesStream', () => {
  it('preflights the first upstream event before returning a downstream stream', async () => {
    await expect(
      prepareResponsesStream(
        Readable.from([
          event(
            functionChunk({
              name: 'write_file',
              arguments: '{',
            }),
          ),
        ]),
        { model: 'coding', tools: [WRITE_FILE_TOOL] },
      ),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'upstream_invalid_stream',
    });
  });

  it('translates canonical text SSE without exposing the DONE sentinel', async () => {
    const output = await text(
      await prepareResponsesStream(
        Readable.from([
          event(chunk('Hel')),
          event(chunk('lo')),
          event({
            ...chunk(null, 'stop'),
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          }),
          event('[DONE]'),
        ]),
        { model: 'coding', nowSeconds: () => 456 },
      ),
    );

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('event: response.completed');
    expect(output).toContain('"text":"Hello"');
    expect(output).not.toContain('[DONE]');
    expect(output).not.toContain('event: error');
  });

  it('translates function-call argument deltas into Responses events', async () => {
    const output = await text(
      await prepareResponsesStream(
        Readable.from([
          event(
            functionChunk({
              id: 'call_1',
              name: 'write_file',
              arguments: '{"path":"',
            }),
          ),
          event(functionChunk({ arguments: 'a"}' })),
          event(functionChunk({ finishReason: 'tool_calls' })),
          event('[DONE]'),
        ]),
        {
          model: 'coding',
          tools: [WRITE_FILE_TOOL],
          toolChoice: 'required',
        },
      ),
    );

    expect(output).toContain('event: response.output_item.added');
    expect(output).toContain('event: response.function_call_arguments.delta');
    expect(output).toContain('event: response.function_call_arguments.done');
    expect(output).toContain('"call_id":"call_1"');
    expect(output).toContain('"arguments":"{\\"path\\":\\"a\\"}"');
    expect(output).toContain('event: response.completed');
    expect(output).not.toContain('[DONE]');
  });

  it('emits one terminal error event when upstream fails after output', async () => {
    const upstream = Readable.from(
      (function* (): Generator<string> {
        yield event(chunk('partial'));
        yield event('{"broken":');
      })(),
    );

    const output = await text(
      await prepareResponsesStream(upstream, { model: 'coding' }),
    );

    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('event: error');
    expect(output).toContain('"sequence_number":5');
    expect(output).toContain('"code":"upstream_invalid_stream"');
    expect(output).not.toContain('event: response.completed');
  });

  it('emits a terminal error event for a truncated stream after output', async () => {
    const output = await text(
      await prepareResponsesStream(Readable.from([event(chunk('partial'))]), {
        model: 'coding',
      }),
    );

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: error');
    expect(output).toContain('"code":"upstream_invalid_stream"');
  });

  it('rejects a truncated stream that ends before any downstream event', async () => {
    await expect(
      prepareResponsesStream(Readable.from([]), { model: 'coding' }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'upstream_invalid_stream',
    });
  });
});
