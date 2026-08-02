import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  type GatewayConfig,
} from '../src/index.js';

const TOKEN = 'ui-test-token-'.padEnd(48, 'x');
const apps: FastifyInstance[] = [];

function config(): GatewayConfig {
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
  };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('local dashboard', () => {
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
    expect(response.body).toContain('/ui/styles.css');
    expect(response.body).toContain('/ui/app.js');
    expect(response.body).not.toContain(TOKEN);
  });

  it('serves dashboard assets without exposing the gateway token', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const [styles, script] = await Promise.all([
      app.inject({ method: 'GET', url: '/ui/styles.css' }),
      app.inject({ method: 'GET', url: '/ui/app.js' }),
    ]);

    expect(styles.statusCode).toBe(200);
    expect(styles.headers['content-type']).toContain('text/css');
    expect(styles.body).toContain('.app-shell');
    expect(styles.body).not.toContain(TOKEN);

    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body).toContain("sessionStorage.getItem('tony-router-token')");
    expect(script.body).toContain("fetch('/v1/models'");
    expect(script.body).toContain("fetch('/v1/chat/completions'");
    expect(script.body).not.toContain(TOKEN);
  });

  it('keeps protected APIs locked even though the dashboard is public', async () => {
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        models: [{ id: 'tony-auto' }],
      }),
    );

    const response = await app.inject({ method: 'GET', url: '/v1/models' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
  });
});
