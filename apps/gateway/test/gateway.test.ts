import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createJsonLogger,
  createNullLogger,
  type GatewayConfig,
} from '../src/index.js';

const TOKEN = 'test-token-'.padEnd(48, 'x');
const apps: FastifyInstance[] = [];

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: TOKEN,
    tokenFile: '/tmp/tony-router-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024,
    requestTimeoutMs: 100,
    shutdownGraceMs: 100,
    version: '0.1.0',
    ...overrides,
  };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

function authorization(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${TOKEN}` };
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('secure gateway transport', () => {
  it('exposes a public health endpoint with a generated request ID', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'tony-router',
      version: '0.1.0',
    });
  });

  it('rejects unauthenticated requests regardless of proxy-like headers', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const headerSets = [
      { host: '127.0.0.1' },
      { origin: 'http://localhost:8787' },
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-forwarded-host': 'localhost' },
      { 'x-forwarded-authorization': `Bearer ${TOKEN}` },
    ];

    for (const headers of headerSets) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'unauthorized' },
      });
    }
  });

  it('returns configured models for a valid bearer token', async () => {
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        models: [{ id: 'tony-auto', ownedBy: 'tony-router' }],
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: 'list',
      data: [
        {
          id: 'tony-auto',
          object: 'model',
          created: 0,
          owned_by: 'tony-router',
        },
      ],
    });
  });

  it('normalizes malformed JSON errors', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );
    app.post('/echo', async (request) => request.body);

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        ...authorization(),
        'content-type': 'application/json',
      },
      payload: '{"broken":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_json' },
    });
  });

  it('rejects request bodies over the configured limit', async () => {
    const app = track(
      buildGateway({
        config: config({ bodyLimitBytes: 128 }),
        logger: createNullLogger(),
      }),
    );
    app.post('/echo', async (request) => request.body);

    const response = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: {
        ...authorization(),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ value: 'x'.repeat(512) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: 'payload_too_large' },
    });
  });

  it('terminates handlers that exceed the gateway deadline', async () => {
    const app = track(
      buildGateway({
        config: config({ requestTimeoutMs: 10 }),
        logger: createNullLogger(),
      }),
    );
    app.get('/slow', async (_request, reply) => {
      await delay(40);
      return reply.sent ? reply : { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/slow',
      headers: authorization(),
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: { code: 'request_timeout' },
    });
  });

  it('keeps bearer tokens out of structured logs and internal errors', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createJsonLogger({
      stream,
      sensitiveValues: [TOKEN],
      now: () => new Date('2026-08-02T00:00:00.000Z'),
    });
    const app = track(buildGateway({ config: config(), logger }));
    app.get('/explode', async () => {
      throw new Error(`upstream credential ${TOKEN} failed`);
    });

    const response = await app.inject({
      method: 'GET',
      url: '/explode?token=also-hidden-from-path-logs',
      headers: authorization(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(TOKEN);
    expect(output).not.toContain(TOKEN);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('also-hidden-from-path-logs');
  });
});
