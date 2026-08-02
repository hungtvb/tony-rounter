import { setTimeout as delay } from 'node:timers/promises';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildGateway, createNullLogger } from '../src/index.js';
import {
  authorization,
  chat,
  createOpenAITestHarness,
  gatewayConfig,
  hijackSse,
} from './helpers/openai-harness.js';

const harness = createOpenAITestHarness();

afterEach(async () => harness.close());

describe('OpenAI-compatible streaming adapter', () => {
  it('canonicalizes fragmented SSE events and terminal markers', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackSse(reply, [
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hel"}}]}\r',
        '\n\r\ndata: {"id":"chunk-1","choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
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
      stream: true,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_invalid_stream' },
    });
  });

  it('rejects a truncated first SSE event as an HTTP error', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.end('data: {"id":"incomplete"');
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
      stream: true,
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { code: 'upstream_truncated_stream' },
    });
  });

  it('turns a partial truncated stream into a terminal SSE error event', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      hijackSse(reply, [
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      ]);
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
      stream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"content":"Hi"');
    expect(response.body).toContain('"code":"upstream_truncated_stream"');
    expect(response.body.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('turns malformed later SSE data into a terminal error event', async () => {
    const upstream = Fastify();
    upstream.post('/v1/chat/completions', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.write(
        'data: {"id":"chunk-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      );
      setTimeout(() => {
        reply.raw.end('data: not-json\n\n');
      }, 10).unref();
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
      stream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"content":"Hi"');
    expect(response.body).toContain('"code":"upstream_invalid_stream"');
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
    const baseUrl = await harness.listen(upstream);
    const gateway = buildGateway({
      config: gatewayConfig(baseUrl, 1000),
      logger: createNullLogger(),
    });
    const gatewayUrl = await harness.listen(gateway);

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
});
