import { setTimeout as delay } from 'node:timers/promises';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildGateway, createNullLogger } from '../src/index.js';
import {
  authorization,
  createOpenAITestHarness,
  gatewayConfig,
} from './helpers/openai-harness.js';

const harness = createOpenAITestHarness();

afterEach(async () => harness.close());

describe('Responses streaming transport', () => {
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
        'data: {"id":"chunk-1","created":123,"choices":[{"index":0,"delta":{"content":"first"},"finish_reason":null}]}\n\n',
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

    const response = await fetch(`${gatewayUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        ...authorization(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'model-a', input: 'hello', stream: true }),
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    expect(first?.done).toBe(false);
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
