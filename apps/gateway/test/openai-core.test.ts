import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createJsonLogger,
  createNullLogger,
} from '../src/index.js';
import {
  authorization,
  chat,
  createOpenAITestHarness,
  gatewayConfig,
  GATEWAY_TOKEN,
  hijackJson,
  UPSTREAM_KEY,
} from './helpers/openai-harness.js';

const harness = createOpenAITestHarness();

afterEach(async () => harness.close());

describe('OpenAI-compatible JSON adapter', () => {
  it('proxies and normalizes the upstream model list', async () => {
    const upstream = Fastify();
    upstream.get('/v1/models', (request) => {
      expect(request.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
      return {
        object: 'list',
        data: [
          {
            id: 'model-a',
            created: 123,
            owned_by: 'vendor',
            ignored: true,
          },
        ],
      };
    });
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await gateway.inject({
      method: 'GET',
      url: '/v1/models',
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: 'list',
      data: [
        {
          id: 'model-a',
          object: 'model',
          created: 123,
          owned_by: 'vendor',
        },
      ],
    });
  });

  it('proxies non-streaming requests and normalizes usage aliases', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (request) => {
      expect(request.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
      expect(request.body).toMatchObject({
        model: 'model-a',
        messages: [{ role: 'user', content: 'Hello' }],
      });
      return {
        id: 'chatcmpl-1',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { input_tokens: 2, output_tokens: 3 },
      };
    });
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(`${baseUrl}/v1`),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'model-a',
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
      },
    });
  });

  it('rejects invalid client requests before contacting upstream', async () => {
    let calls = 0;
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', () => {
      calls += 1;
      return {};
    });
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: '',
      messages: 'not-an-array',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(calls).toBe(0);
  });

  it('maps malformed upstream JSON to a normalized gateway error', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackJson(reply, '{"broken":');
    });
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_invalid_response' },
    });
  });

  it.each([401, 403])(
    'maps upstream authentication status %s without exposing its body',
    async (statusCode) => {
      const upstream = Fastify();
      upstream.post('/v1/chat/completions', (_request, reply) =>
        reply
          .code(statusCode)
          .send({ error: { message: `rejected ${UPSTREAM_KEY}` } }),
      );
      const baseUrl = await harness.listen(upstream);
      const gateway = harness.track(
        buildGateway({
          config: gatewayConfig(baseUrl),
          logger: createNullLogger(),
        }),
      );

      const response = await chat(gateway, {
        model: 'model-a',
        messages: [],
      });

      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain(UPSTREAM_KEY);
      expect(response.json()).toMatchObject({
        error: { code: 'upstream_authentication_failed' },
      });
    },
  );

  it('preserves rate-limit metadata from the upstream', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) =>
      reply
        .header('retry-after', '7')
        .code(429)
        .send({ error: { message: 'Try later' } }),
    );
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_rate_limited', message: 'Try later' },
    });
  });

  it('maps transient upstream failures to 502', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) =>
      reply.code(503).send({ error: { message: 'offline' } }),
    );
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_unavailable' },
    });
  });

  it('aborts an upstream that exceeds the configured idle timeout', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', async () => {
      await delay(80);
      return { id: 'too-late', choices: [] };
    });
    const baseUrl = await harness.listen(upstream);
    const gateway = harness.track(
      buildGateway({
        config: gatewayConfig(baseUrl, 10),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_timeout' },
    });
  });

  it('redacts upstream credentials from logs and public errors', async () => {
    let output = '';
    const stream = new Writable({
      write(
        chunk: unknown,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        output += Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : typeof chunk === 'string'
            ? chunk
            : '';
        callback();
      },
    });
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) =>
      reply
        .code(500)
        .send({ error: { message: `provider leaked ${UPSTREAM_KEY}` } }),
    );
    const baseUrl = await harness.listen(upstream);
    const logger = createJsonLogger({
      stream,
      sensitiveValues: [GATEWAY_TOKEN, UPSTREAM_KEY],
    });
    const gateway = harness.track(
      buildGateway({ config: gatewayConfig(baseUrl), logger }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
    });

    expect(response.body).not.toContain(UPSTREAM_KEY);
    expect(output).not.toContain(UPSTREAM_KEY);
  });
});
