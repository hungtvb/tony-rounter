import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  type GatewayConfig,
  type OpenAICompatibleProvider,
} from '../src/index.js';

const TOKEN = 'responses-test-token-'.padEnd(48, 'x');
const apps: FastifyInstance[] = [];
const PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK';

function config(): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: TOKEN,
    tokenFile: '/tmp/tony-router-responses-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 16 * 1024,
    requestTimeoutMs: 100,
    shutdownGraceMs: 100,
    version: '0.2.0',
  };
}

function authorization(): Readonly<Record<string, string>> {
  return {
    authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

function provider(
  createChatCompletion: OpenAICompatibleProvider['createChatCompletion'],
): OpenAICompatibleProvider {
  return {
    listModels: vi.fn().mockResolvedValue({ object: 'list', data: [] }),
    createChatCompletion,
  };
}

function sse(data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

function streamChunk(
  content: string | null,
  finishReason: string | null = null,
): Readonly<Record<string, unknown>> {
  return {
    id: 'chatcmpl_gateway_stream',
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

function functionStreamChunk(
  fields: Readonly<{
    id?: string;
    name?: string;
    arguments?: string;
    finishReason?: string | null;
  }>,
): Readonly<Record<string, unknown>> {
  return {
    id: 'chatcmpl_gateway_stream',
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

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('POST /v1/responses', () => {
  it('requires bearer authentication', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: { 'content-type': 'application/json' },
      payload: { model: 'coding', input: 'hello' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('returns provider_not_configured before attempting translation', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: { model: 'coding', input: 'hello' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'provider_not_configured' },
    });
  });

  it('translates a non-streaming request and normalizes the public response', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_gateway',
        created: 123,
        model: 'private-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello from upstream.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      },
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        instructions: 'Be concise.',
        input: 'Say hello.',
        max_output_tokens: 20,
        store: false,
        background: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        { role: 'developer', content: 'Be concise.' },
        { role: 'user', content: 'Say hello.' },
      ],
      stream: false,
      max_completion_tokens: 20,
    });
    expect(response.json()).toMatchObject({
      id: 'chatcmpl_gateway',
      object: 'response',
      status: 'completed',
      model: 'coding',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'Hello from upstream.',
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    });
  });

  it('forwards mixed text and image input to a non-streaming upstream', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_vision',
        created: 123,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'A cat.' },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'What is shown?' },
              {
                type: 'input_image',
                image_url: 'https://images.example.test/cat.png',
                detail: 'low',
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is shown?' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://images.example.test/cat.png',
                detail: 'low',
              },
            },
          ],
        },
      ],
      stream: false,
    });
    expect(response.json()).toMatchObject({
      object: 'response',
      model: 'coding',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'A cat.' }],
        },
      ],
    });
  });

  it('forwards mixed text and inline PDF input to a non-streaming upstream', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_pdf',
        created: 123,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'PDF received.' },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Summarize ' },
              {
                type: 'input_file',
                file_data: PDF_BASE64,
                filename: 'spec.pdf',
              },
              { type: 'input_text', text: ' briefly.' },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Summarize ' },
            {
              type: 'file',
              file: { file_data: PDF_BASE64, filename: 'spec.pdf' },
            },
            { type: 'text', text: ' briefly.' },
          ],
        },
      ],
      stream: false,
    });
    expect(response.json()).toMatchObject({
      object: 'response',
      model: 'coding',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'PDF received.' }],
        },
      ],
    });
  });

  it('rejects malformed inline PDF before calling the provider', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                file_data: Buffer.from('not a pdf').toString('base64'),
                filename: 'spec.pdf',
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('rejects malformed image input before calling the provider', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_image',
                image_url: 'http://images.example.test/cat.png',
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'unsupported_responses_feature' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('submits completed function output as non-streaming chat history', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_continuation',
        created: 124,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'The file was written.' },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          { type: 'message', role: 'user', content: 'Write a.txt.' },
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'write_file',
            arguments: '{"path":"a.txt","content":"hello"}',
            status: 'completed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: '{"ok":true}',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        { role: 'user', content: 'Write a.txt.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"hello"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      ],
      stream: false,
    });
    expect(response.json()).toMatchObject({
      id: 'chatcmpl_continuation',
      object: 'response',
      model: 'coding',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'The file was written.' }],
        },
      ],
    });
  });

  it('rejects incomplete function history before calling the provider', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'write_file',
            arguments: '{}',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('rejects malformed generation controls before calling the provider', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: { model: 'coding', input: 'hello', max_output_tokens: '20' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('streams text Responses events without exposing the Chat Completions sentinel', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(streamChunk('Hel')),
        sse(streamChunk('lo')),
        sse({
          ...streamChunk(null, 'stop'),
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
        sse('[DONE]'),
      ]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        instructions: 'Be concise.',
        input: 'Say hello.',
        max_output_tokens: 20,
        tool_choice: 'none',
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        { role: 'developer', content: 'Be concise.' },
        { role: 'user', content: 'Say hello.' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 20,
      tool_choice: 'none',
    });
    expect(response.body).toContain('event: response.created');
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"text":"Hello"');
    expect(response.body).toContain('"tool_choice":"none"');
    expect(response.body).not.toContain('[DONE]');
    expect(response.body).not.toContain('event: error');
  });

  it('forwards image input for a streaming Responses request', async () => {
    const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(streamChunk('Image received.')),
        sse(streamChunk(null, 'stop')),
        sse('[DONE]'),
      ]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        stream: true,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_image', image_url: image }],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: image, detail: 'auto' },
            },
          ],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('"text":"Image received."');
    expect(response.body).toContain('event: response.completed');
  });

  it('forwards inline PDF input for a streaming Responses request', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(streamChunk('PDF received.')),
        sse(streamChunk(null, 'stop')),
        sse('[DONE]'),
      ]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        stream: true,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                file_data: PDF_BASE64,
                filename: 'spec.pdf',
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: { file_data: PDF_BASE64, filename: 'spec.pdf' },
            },
          ],
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('"text":"PDF received."');
    expect(response.body).toContain('event: response.completed');
  });

  it('streams a continuation after completed function output', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(streamChunk('Done')),
        sse(streamChunk(null, 'stop')),
        sse('[DONE]'),
      ]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        stream: true,
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'write_file',
            arguments: '{"path":"a.txt"}',
            status: 'completed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'written',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toEqual({
      model: 'coding',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{"path":"a.txt"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'written' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"text":"Done"');
  });

  it('returns an error event when a streaming upstream fails after output', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([sse(streamChunk('partial')), sse('{"broken":')]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: { model: 'coding', input: 'hello', stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('event: response.completed');
  });

  it('streams function-call output and preserves tool metadata', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(
          functionStreamChunk({
            id: 'call_1',
            name: 'write_file',
            arguments: '{"path":"',
          }),
        ),
        sse(functionStreamChunk({ arguments: 'a.txt"}' })),
        sse(functionStreamChunk({ finishReason: 'tool_calls' })),
        sse('[DONE]'),
      ]),
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: 'hello',
        stream: true,
        parallel_tool_calls: false,
        tools: [
          {
            type: 'function',
            name: 'write_file',
            description: 'Write a file',
            parameters: { type: 'object', properties: {} },
          },
        ],
        tool_choice: { type: 'function', name: 'write_file' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      model: 'coding',
      stream: true,
      stream_options: { include_usage: true },
      parallel_tool_calls: false,
      tools: [
        {
          type: 'function',
          function: {
            name: 'write_file',
            description: 'Write a file',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'write_file' } },
    });
    expect(response.body).toContain(
      'event: response.function_call_arguments.delta',
    );
    expect(response.body).toContain(
      'event: response.function_call_arguments.done',
    );
    expect(response.body).toContain('"id":"fc_call_1_0"');
    expect(response.body).toContain('"call_id":"call_1"');
    expect(response.body).toContain('"name":"write_file"');
    expect(response.body).toContain('"arguments":"{\\"path\\":\\"a.txt\\"}"');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).not.toContain('[DONE]');
  });

  it('rejects named tool choice that is absent from tools', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: 'hello',
        stream: true,
        tools: [{ type: 'function', name: 'write_file' }],
        tool_choice: { type: 'function', name: 'read_file' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('returns a protocol error when a streaming request receives JSON', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_wrong_shape',
        choices: [{ message: { role: 'assistant', content: 'not a stream' } }],
      },
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: { model: 'coding', input: 'hello', stream: true },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_protocol_mismatch' },
    });
  });

  it('destroys an unexpected upstream stream for a non-streaming request', async () => {
    const body = Readable.from(['data: unexpected']);
    const destroy = vi.spyOn(body, 'destroy');
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body,
    });
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        provider: provider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: { model: 'coding', input: 'hello' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_protocol_mismatch' },
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
