import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRoutingConfig } from '@tony-router/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  GatewayHttpError,
  LocalConfigStore,
  RoutedOpenAIProvider,
  type GatewayConfig,
  type GatewayRouterConfig,
  type OpenAICompatibleProvider,
} from '../src/index.js';

const TOKEN = 'control-plane-token-'.padEnd(48, 'x');
const SECRET = 'provider-secret-value';
const directories: string[] = [];
const apps: FastifyInstance[] = [];

const ROUTING_YAML = `version: 2
defaultProfile: tony-auto
providers:
  openai:
    kind: openai-compatible
accounts:
  personal:
    provider: openai
models:
  gpt:
    provider: openai
    upstreamModel: gpt-5
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: false
      structuredOutput: true
      contextTokens: 128000
routes:
  primary:
    model: gpt
    account: personal
profiles:
  tony-auto:
    routes:
      - route: primary
`;

function bindings(baseUrl = 'https://api.openai.example/v1'): string {
  return JSON.stringify({
    version: 2,
    providers: {
      openai: { baseUrl, timeoutMs: 1000 },
    },
    accounts: {
      personal: { provider: 'openai', apiKeyEnv: 'OPENAI_PERSONAL_KEY' },
    },
  });
}

function config(controlDir?: string): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: TOKEN,
    tokenFile: '/tmp/tony-router-control-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 2000,
    shutdownGraceMs: 100,
    ...(controlDir ? { controlDir } : {}),
    version: '0.2.0',
  };
}

function routerConfig(): GatewayRouterConfig {
  return {
    registry: parseRoutingConfig(ROUTING_YAML),
    providers: {
      openai: {
        baseUrl: 'https://api.openai.example/v1',
        timeoutMs: 1000,
      },
    },
    accounts: {
      personal: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: SECRET,
        timeoutMs: 1000,
      },
    },
    fallbackPolicy: {
      maxAttemptsPerRoute: 1,
      maxTotalAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      totalDeadlineMs: 1000,
    },
    circuitBreaker: {
      failureThreshold: 2,
      cooldownMs: 1000,
      halfOpenMaxAttempts: 1,
    },
  };
}

function authorization(): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${TOKEN}` };
}

async function store(): Promise<LocalConfigStore> {
  const directory = await mkdtemp(join(tmpdir(), 'tony-router-control-api-'));
  directories.push(directory);
  return new LocalConfigStore(join(directory, 'managed'), {
    env: { OPENAI_PERSONAL_KEY: SECRET },
  });
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('trusted local control plane', () => {
  it('keeps control operations bearer-protected and explicitly disabled by default', async () => {
    const app = track(
      buildGateway({ config: config(), logger: createNullLogger() }),
    );

    const unauthorized = await app.inject({
      method: 'POST',
      url: '/ui/api/control/validate',
      payload: { routingSource: ROUTING_YAML, bindingSource: bindings() },
    });
    expect(unauthorized.statusCode).toBe(401);

    const disabled = await app.inject({
      method: 'POST',
      url: '/ui/api/control/validate',
      headers: authorization(),
      payload: { routingSource: ROUTING_YAML, bindingSource: bindings() },
    });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json()).toMatchObject({
      error: { code: 'local_control_not_configured' },
    });
  });

  it('validates, applies, lists, and rolls back recoverable generations', async () => {
    const controlStore = await store();
    const app = track(
      buildGateway({
        config: config(controlStore.directory),
        logger: createNullLogger(),
        controlStore,
      }),
    );

    const validate = await app.inject({
      method: 'POST',
      url: '/ui/api/control/validate',
      headers: authorization(),
      payload: { routingSource: ROUTING_YAML, bindingSource: bindings() },
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({
      validation: {
        routingVersion: 2,
        providerCount: 1,
        accountCount: 1,
        restartReady: true,
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/ui/api/control/apply',
      headers: authorization(),
      payload: { routingSource: ROUTING_YAML, bindingSource: bindings() },
    });
    const firstBody = first.json<{
      result: { generation: { generationId: string } };
    }>();
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/ui/api/control/apply',
      headers: authorization(),
      payload: {
        routingSource: ROUTING_YAML,
        bindingSource: bindings('https://backup.openai.example/v1'),
      },
    });
    expect(second.statusCode).toBe(200);

    const generations = await app.inject({
      method: 'GET',
      url: '/ui/api/control/generations',
      headers: authorization(),
    });
    expect(generations.json()).toMatchObject({
      restartRequired: true,
      generations: [
        expect.objectContaining({ active: true, routingVersion: 2 }),
        expect.objectContaining({ active: false, routingVersion: 2 }),
      ],
    });

    const rollback = await app.inject({
      method: 'POST',
      url: '/ui/api/control/rollback',
      headers: authorization(),
      payload: { generationId: firstBody.result.generation.generationId },
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json()).toMatchObject({
      result: {
        changed: true,
        restartRequired: true,
        generation: {
          generationId: firstBody.result.generation.generationId,
          active: true,
        },
      },
    });

    const dashboard = await app.inject({
      method: 'GET',
      url: '/ui/api/dashboard',
      headers: authorization(),
    });
    expect(dashboard.json()).toMatchObject({
      control: {
        enabled: true,
        status: 'ready',
        restartRequired: true,
        generationCount: 2,
        activeGenerationId: firstBody.result.generation.generationId,
      },
    });
    expect(dashboard.body).not.toContain(SECRET);
  });

  it('rejects raw secrets and leaves the previous generation active', async () => {
    const controlStore = await store();
    const first = await controlStore.apply(ROUTING_YAML, bindings());
    const app = track(
      buildGateway({
        config: config(controlStore.directory),
        logger: createNullLogger(),
        controlStore,
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/ui/api/control/apply',
      headers: authorization(),
      payload: {
        routingSource: ROUTING_YAML,
        bindingSource: JSON.stringify({
          version: 2,
          providers: {
            openai: { baseUrl: 'https://api.openai.example/v1' },
          },
          accounts: {
            personal: { provider: 'openai', apiKey: 'raw-secret' },
          },
        }),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_router_configuration' },
    });
    expect(response.body).not.toContain('raw-secret');
    expect((await controlStore.loadActiveSources())?.generationId).toBe(
      first.generation.generationId,
    );
  });

  it('returns bounded secret-safe account health outcomes', async () => {
    const healthy: OpenAICompatibleProvider = {
      listModels: () => Promise.resolve({ object: 'list', data: [] }),
      createChatCompletion: () => Promise.resolve({ stream: false, body: {} }),
    };
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        router: routerConfig(),
        routedAccounts: { personal: healthy },
      }),
    );

    const success = await app.inject({
      method: 'POST',
      url: '/ui/api/providers/personal/health',
      headers: authorization(),
      payload: {},
    });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toMatchObject({
      probe: {
        accountId: 'personal',
        providerId: 'openai',
        status: 'healthy',
      },
    });
    expect(success.body).not.toContain(SECRET);
    expect(success.body).not.toContain('authorization');

    const rejected: OpenAICompatibleProvider = {
      listModels: () =>
        Promise.reject(
          new GatewayHttpError(
            502,
            'upstream_authentication_failed',
            `Rejected ${SECRET}`,
          ),
        ),
      createChatCompletion: () => Promise.resolve({ stream: false, body: {} }),
    };
    const rejectedApp = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        router: routerConfig(),
        routedAccounts: { personal: rejected },
      }),
    );
    const failure = await rejectedApp.inject({
      method: 'POST',
      url: '/ui/api/providers/personal/health',
      headers: authorization(),
      payload: {},
    });
    expect(failure.statusCode).toBe(200);
    expect(failure.json()).toMatchObject({
      probe: {
        status: 'authentication_failed',
        httpStatusClass: '4xx',
      },
    });
    expect(failure.body).not.toContain(SECRET);
    expect(failure.body).not.toContain('Rejected');
  });
  it('bounds health probes even when an account adapter ignores cancellation', async () => {
    const stalled: OpenAICompatibleProvider = {
      listModels: () => new Promise<never>(() => undefined),
      createChatCompletion: () => Promise.resolve({ stream: false, body: {} }),
    };
    const routed = new RoutedOpenAIProvider({
      config: routerConfig(),
      logger: createNullLogger(),
      accounts: { personal: stalled },
      healthProbeTimeoutMs: 10,
    });

    const startedAt = Date.now();
    await expect(
      routed.probeAccount('personal', {
        requestId: 'bounded-health-probe',
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
