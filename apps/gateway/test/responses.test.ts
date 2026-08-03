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
    });
    expect(response.body).toContain('event: response.created');
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"text":"Hello"');
    expect(response.body).not.toContain('[DONE]');
    expect(response.body).not.toContain('event: error');
  });

  it('returns an error event when a streaming upstream fails after output', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: true,
      body: Readable.from([
        sse(streamChunk('partial')),
        sse('{"broken":'),
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
      payload: { model: 'coding', input: 'hello', stream: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('event: response.completed');
  });

  it('rejects streaming function tools before calling the provider', async () => {
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
        tools: [
          {
            type: 'function',
            name: 'write_file',
            parameters: { type: 'object', properties: {} },
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

  it('returns a protocol error when a streaming request receives JSON', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_wrong_shape',
        choices: [
          { message: { role: 'assistant', content: 'not a stream' } },
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
