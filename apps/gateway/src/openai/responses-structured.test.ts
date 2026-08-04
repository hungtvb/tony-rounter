import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import { ResponsesStreamEncoder } from './responses-stream.js';
import {
  chatCompletionToResponse,
  parseResponsesRequest,
  responsesToChatCompletion,
  type ResponsesTextFormatJsonSchema,
} from './responses.js';

const FORMAT: ResponsesTextFormatJsonSchema = {
  type: 'json_schema',
  name: 'edit_plan',
  description: 'A bounded edit plan.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'files'],
    additionalProperties: false,
  },
  strict: true,
};

function chunk(
  content: string | null,
  finishReason: string | null = null,
): string {
  return JSON.stringify({
    id: 'chatcmpl_structured',
    created: 123,
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
      },
    ],
  });
}

function parseWire(value: string): Readonly<Record<string, unknown>> {
  const data = value
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  if (!data) throw new Error('missing SSE data');
  return JSON.parse(data) as Readonly<Record<string, unknown>>;
}

describe('Responses structured output translation', () => {
  it('translates Responses json_schema format without rewriting the schema', () => {
    const request = parseResponsesRequest({
      model: 'coding',
      input: 'Plan the patch.',
      text: { format: FORMAT },
    });

    expect(request.text?.format).toEqual(FORMAT);
    expect(responsesToChatCompletion(request)).toEqual({
      model: 'coding',
      messages: [{ role: 'user', content: 'Plan the patch.' }],
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: FORMAT.name,
          description: FORMAT.description,
          schema: FORMAT.schema,
          strict: true,
        },
      },
    });
  });

  it('accepts explicit text format without adding structured output', () => {
    const request = parseResponsesRequest({
      model: 'coding',
      input: 'hello',
      text: { format: { type: 'text' } },
    });

    expect(responsesToChatCompletion(request)).toEqual({
      model: 'coding',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });
  });

  it('rejects malformed, legacy, and unsupported text formats', () => {
    const invalidTextValues: readonly unknown[] = [
      null,
      { verbosity: 'low' },
      { format: null },
      { format: {} },
      { format: { type: 'json_object' } },
      { format: { type: 'yaml' } },
      {
        format: {
          type: 'json_schema',
          name: 'bad name',
          schema: {},
        },
      },
      {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: [],
        },
      },
      {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: {},
          description: 123,
        },
      },
      {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: {},
          strict: null,
        },
      },
      {
        format: {
          type: 'json_schema',
          name: 'result',
          schema: {},
          strict: true,
          extra: true,
        },
      },
    ];

    for (const text of invalidTextValues) {
      expect(() =>
        parseResponsesRequest({ model: 'coding', input: 'hello', text }),
      ).toThrowError(GatewayHttpError);
    }
  });

  it('returns the requested text format in non-streaming Responses metadata', () => {
    expect(
      chatCompletionToResponse(
        {
          id: 'chatcmpl_structured',
          created: 123,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '{"summary":"done","files":[]}',
              },
              finish_reason: 'stop',
            },
          ],
        },
        'coding',
        FORMAT,
      ),
    ).toMatchObject({
      object: 'response',
      model: 'coding',
      text: { format: FORMAT },
    });
  });

  it('returns the requested text format in streaming response lifecycle events', () => {
    const encoder = new ResponsesStreamEncoder({
      model: 'coding',
      textFormat: FORMAT,
      nowSeconds: () => 456,
    });
    const events = [
      ...encoder.push(chunk('{"summary":"done",')),
      ...encoder.push(chunk('"files":[]}')),
      ...encoder.push(chunk(null, 'stop')),
      ...encoder.push('[DONE]'),
    ].map(parseWire);
    encoder.end();

    expect(events[0]).toMatchObject({
      type: 'response.created',
      response: { text: { format: FORMAT } },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: { text: { format: FORMAT } },
    });
  });
});
