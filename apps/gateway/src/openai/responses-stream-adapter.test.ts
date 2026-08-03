import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { prepareResponsesTextStream } from './responses-stream-adapter.js';

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

async function text(stream: Readable): Promise<string> {
  let output = '';
  for await (const value of stream) {
    if (typeof value === 'string') output += value;
    else if (value instanceof Uint8Array)
      output += Buffer.from(value).toString('utf8');
    else throw new TypeError('Unexpected stream chunk');
  }
  return output;
}

describe('prepareResponsesTextStream', () => {
  it('preflights the first upstream event before returning a downstream stream', async () => {
    await expect(
      prepareResponsesTextStream(
        Readable.from([
          event({
            id: 'chatcmpl_adapter',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'write_file', arguments: '{' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        ]),
        { model: 'coding' },
      ),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'upstream_unsupported_stream_event',
    });
  });

  it('translates canonical chat SSE without exposing the DONE sentinel', async () => {
    const output = await text(
      await prepareResponsesTextStream(
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

  it('emits one terminal error event when upstream fails after output', async () => {
    const upstream = Readable.from(
      (function* (): Generator<string> {
        yield event(chunk('partial'));
        yield event('{"broken":');
      })(),
    );

    const output = await text(
      await prepareResponsesTextStream(upstream, { model: 'coding' }),
    );

    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('event: error');
    expect(output).toContain('"sequence_number":5');
    expect(output).toContain('"code":"upstream_invalid_stream"');
    expect(output).not.toContain('event: response.completed');
  });

  it('emits a terminal error event for a truncated stream after output', async () => {
    const output = await text(
      await prepareResponsesTextStream(
        Readable.from([event(chunk('partial'))]),
        { model: 'coding' },
      ),
    );

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: error');
    expect(output).toContain('"code":"upstream_invalid_stream"');
  });

  it('rejects a truncated stream that ends before any downstream event', async () => {
    await expect(
      prepareResponsesTextStream(Readable.from([]), { model: 'coding' }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: 'upstream_invalid_stream',
    });
  });
});
