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

  it('rejects unsupported streaming before calling the provider', async () => {
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
      payload: { model: 'coding', input: 'hello', stream: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'unsupported_responses_feature' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('destroys an unexpected upstream stream and returns a protocol error', async () => {
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
