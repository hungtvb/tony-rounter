import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  type GatewayConfig,
} from '../src/index.js';

const TOKEN = 'ui-test-token-'.padEnd(48, 'x');
const UPSTREAM_API_KEY = 'upstream-secret-key';
const apps: FastifyInstance[] = [];

interface DashboardTestResponse {
  readonly telemetry: {
    readonly requestsSinceStart: number;
    readonly successfulRequestsSinceStart: number;
    readonly successRate: number | null;
    readonly inFlightRequests: number;
    readonly recentRequests: readonly {
      readonly path: string;
      readonly statusCode: number;
    }[];
  };
}

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: TOKEN,
    tokenFile: '/tmp/tony-router-ui-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
    version: '0.2.0',
    ...overrides,
  };
}

function authorization(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${TOKEN}` };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('local runtime dashboard', () => {
  it('redirects the gateway root to the dashboard', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/ui');
  });

  it('serves a public dashboard shell with restrictive browser headers', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const response = await app.inject({ method: 'GET', url: '/ui' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(response.headers['content-security-policy']).toContain(
      "connect-src 'self'",
    );
    expect(response.body).toContain('Tony Router');
    expect(response.body).toContain('Request Traces');
    expect(response.body).toContain('/ui/styles.css');
    expect(response.body).toContain('/ui/app.js');
    expect(response.body).not.toContain(TOKEN);
  });

  it('serves dashboard assets without exposing gateway credentials', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const [styles, script] = await Promise.all([
      app.inject({ method: 'GET', url: '/ui/styles.css' }),
      app.inject({ method: 'GET', url: '/ui/app.js' }),
    ]);

    expect(styles.statusCode).toBe(200);
    expect(styles.headers['content-type']).toContain('text/css');
    expect(styles.body).toContain('.dashboard-grid');
    expect(styles.body).not.toContain(TOKEN);

    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body).toContain(
      "sessionStorage.getItem('tony-router-token')",
    );
    expect(script.body).toContain("fetch('/ui/api/dashboard'");
    expect(script.body).toContain("fetch('/v1/models'");
    expect(script.body).toContain("fetch('/v1/chat/completions'");
    expect(script.body).not.toContain(TOKEN);
  });

  it('keeps runtime metadata and provider APIs behind bearer auth', async () => {
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        models: [{ id: 'tony-auto' }],
      }),
    );

    const [dashboard, models] = await Promise.all([
      app.inject({ method: 'GET', url: '/ui/api/dashboard' }),
      app.inject({ method: 'GET', url: '/v1/models' }),
    ]);

    expect(dashboard.statusCode).toBe(401);
    expect(models.statusCode).toBe(401);
    expect(dashboard.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('returns safe runtime metadata without local or upstream secrets', async () => {
    const app = track(
      buildGateway({
        config: config({
          upstream: {
            baseUrl: 'https://api.example.test/v1',
            apiKey: UPSTREAM_API_KEY,
            timeoutMs: 1000,
          },
        }),
        logger: createNullLogger(),
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/ui/api/dashboard',
      headers: authorization(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      gateway: {
        version: '0.2.0',
        host: '127.0.0.1',
        port: 0,
        tokenSource: 'environment',
      },
      provider: {
        mode: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        credentialConfigured: true,
      },
      telemetry: {
        requestsSinceStart: 0,
        inFlightRequests: 0,
        recentRequests: [],
      },
    });
    expect(response.body).not.toContain(TOKEN);
    expect(response.body).not.toContain(UPSTREAM_API_KEY);
  });

  it('reports real bounded request metadata while excluding dashboard polling', async () => {
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        models: [{ id: 'tony-auto' }],
      }),
    );

    await app.inject({
      method: 'GET',
      url: '/ui/api/dashboard',
      headers: authorization(),
    });
    await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: authorization(),
    });
    await app.inject({ method: 'GET', url: '/v1/models' });

    const response = await app.inject({
      method: 'GET',
      url: '/ui/api/dashboard',
      headers: authorization(),
    });
    const body = response.json<DashboardTestResponse>();

    expect(body.telemetry).toMatchObject({
      requestsSinceStart: 2,
      successfulRequestsSinceStart: 1,
      successRate: 50,
      inFlightRequests: 0,
    });
    expect(body.telemetry.recentRequests).toHaveLength(2);
    expect(body.telemetry.recentRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/v1/models', statusCode: 200 }),
        expect.objectContaining({ path: '/v1/models', statusCode: 401 }),
      ]),
    );
    expect(JSON.stringify(body.telemetry)).not.toContain('authorization');
  });
});
