import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createJsonLogger,
  createNullLogger,
  type GatewayConfig,
} from '../src/index.js';

const TOKEN = 'gateway-token-'.padEnd(48, 'g');
const UPSTREAM_KEY = 'upstream-key-'.padEnd(48, 'u');
const apps: FastifyInstance[] = [];

function authorization(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${TOKEN}` };
}

function gatewayConfig(baseUrl: string, timeoutMs = 500): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: TOKEN,
    tokenFile: '/tmp/tony-router-openai-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 100,
    shutdownGraceMs: 100,
    upstream: {
      baseUrl,
      apiKey: UPSTREAM_KEY,
      timeoutMs,
    },
    version: '0.2.0',
  };
}

async function listen(app: FastifyInstance): Promise<string> {
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected a TCP address');
  }
  return `http://127.0.0.1:${address.port}`;
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

async function chat(
  app: FastifyInstance,
  payload: Readonly<Record<string, unknown>>,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: {
      ...authorization(),
      'content-type': 'application/json',
    },
    payload,
  });
}

function hijackJson(
  reply: Parameters<Parameters<FastifyInstance['post']>[1]>[1],
  body: string,
): void {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'application/json' });
  reply.raw.end(body);
}

function hijackSse(
  reply: Parameters<Parameters<FastifyInstance['post']>[1]>[1],
  chunks: readonly string[],
): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
  });
  for (const chunk of chunks) reply.raw.write(chunk);
  reply.raw.end();
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('OpenAI-compatible adapter', () => {
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
      const baseUrl = await listen(upstream);
      const gateway = track(
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
    const baseUrl = await listen(upstream);
    const gateway = track(
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
      return {
        id: 'too-late',
        choices: [],
      };
    });
    const baseUrl = await listen(upstream);
    const gateway = track(
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

  it('canonicalizes fragmented SSE events and terminal markers', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackSse(reply, [
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hel"}}]}\r',
        '\n\r\ndata: {"id":"chunk-1","choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    });
    const baseUrl = await listen(upstream);
    const gateway = track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
      stream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain(
      'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hel"}}],"object":"chat.completion.chunk"}\n\n',
    );
    expect(response.body).toContain(
      'data: {"id":"chunk-1","choices":[{"delta":{"content":"lo"}}],"object":"chat.completion.chunk"}\n\n',
    );
    expect(response.body.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('rejects malformed SSE before exposing a streaming response', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackSse(reply, ['data: not-json\n\n']);
    });
    const baseUrl = await listen(upstream);
    const gateway = track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
      stream: true,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_invalid_stream' },
    });
  });

  it('turns a partial truncated stream into a terminal SSE error event', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackSse(reply, [
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      ]);
    });
    const baseUrl = await listen(upstream);
    const gateway = track(
      buildGateway({
        config: gatewayConfig(baseUrl),
        logger: createNullLogger(),
      }),
    );

    const response = await chat(gateway, {
      model: 'model-a',
      messages: [],
      stream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"content":"Hi"');
    expect(response.body).toContain('"code":"upstream_truncated_stream"');
    expect(response.body.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('aborts the upstream stream when the downstream client disconnects', async () => {
    let resolveUpstreamClosed: (() => void) | undefined;
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveUpstreamClosed = resolve;
    });
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.write(
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"first"}}]}\n\n',
      );
      const timer = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, 10);
      reply.raw.once('close', () => {
        clearInterval(timer);
        resolveUpstreamClosed?.();
      });
    });
    const baseUrl = await listen(upstream);
    const gateway = buildGateway({
      config: gatewayConfig(baseUrl, 1000),
      logger: createNullLogger(),
    });
    const gatewayUrl = await listen(gateway);

    const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'model-a', messages: [], stream: true }),
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await reader?.read();
    await reader?.cancel();

    await expect(
      Promise.race([
        upstreamClosed,
        delay(500).then(() => {
          throw new Error('Upstream connection remained open');
        }),
      ]),
    ).resolves.toBeUndefined();
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
    const baseUrl = await listen(upstream);
    const logger = createJsonLogger({
      stream,
      sensitiveValues: [TOKEN, UPSTREAM_KEY],
    });
    const gateway = track(
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
