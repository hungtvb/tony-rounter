import type { FastifyInstance, FastifyReply } from 'fastify';

import type { GatewayConfig } from '../../src/index.js';

export const GATEWAY_TOKEN = 'gateway-token-'.padEnd(48, 'g');
export const UPSTREAM_KEY = 'upstream-key-'.padEnd(48, 'u');

export interface InjectedTestResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
  json(): unknown;
}

export function authorization(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${GATEWAY_TOKEN}` };
}

export function gatewayConfig(baseUrl: string, timeoutMs = 500): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: GATEWAY_TOKEN,
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

export interface OpenAITestHarness {
  readonly listen: (app: FastifyInstance) => Promise<string>;
  readonly track: (app: FastifyInstance) => FastifyInstance;
  readonly close: () => Promise<void>;
}

export function createOpenAITestHarness(): OpenAITestHarness {
  const apps: FastifyInstance[] = [];

  return {
    async listen(app) {
      apps.push(app);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('Expected a TCP address');
      }
      return `http://127.0.0.1:${address.port}`;
    },
    track(app) {
      apps.push(app);
      return app;
    },
    async close() {
      await Promise.allSettled(apps.splice(0).map((app) => app.close()));
    },
  };
}

export async function chat(
  app: FastifyInstance,
  payload: Readonly<Record<string, unknown>>,
): Promise<InjectedTestResponse> {
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

export function hijackJson(reply: FastifyReply, body: string): void {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'application/json' });
  reply.raw.end(body);
}

export function hijackSse(
  reply: FastifyReply,
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
