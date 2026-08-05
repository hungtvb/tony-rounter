import { parseRoutingConfig } from '@tony-router/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  type GatewayConfig,
  type GatewayRouterConfig,
} from '../src/index.js';

const TOKEN = 'ui-test-token-'.padEnd(48, 'x');
const UPSTREAM_API_KEY = 'upstream-secret-key';
const apps: FastifyInstance[] = [];

const ROUTED_SECRET = 'routed-provider-secret';
const ROUTING_YAML = `version: 2
defaultProfile: tony-auto
providers:
  openai:
    kind: openai-compatible
accounts:
  personal:
    provider: openai
  work:
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
  personal-route:
    model: gpt
    account: personal
    priority: 20
  work-route:
    model: gpt
    account: work
    priority: 10
profiles:
  tony-auto:
    routes:
      - route: personal-route
      - route: work-route
`;

function routedConfig(): GatewayRouterConfig {
  return {
    registry: parseRoutingConfig(ROUTING_YAML),
    providers: {
      openai: {
        baseUrl: 'https://api.openai.example/v1',
        timeoutMs: 60_000,
      },
    },
    accounts: {
      personal: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: ROUTED_SECRET,
        timeoutMs: 60_000,
      },
      work: {
        providerId: 'openai',
        baseUrl: 'https://work.openai.example/v1',
        timeoutMs: 90_000,
      },
    },
    fallbackPolicy: {
      maxAttemptsPerRoute: 1,
      maxTotalAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      totalDeadlineMs: 1000,
    },
    circuitBreaker: {
      failureThreshold: 2,
      cooldownMs: 60_000,
      halfOpenMaxAttempts: 1,
    },
  };
}

interface DashboardTestResponse {
  readonly routing?: {
    readonly version: 1 | 2;
    readonly defaultProfileId: string;
    readonly providers: readonly {
      readonly id: string;
      readonly accountCount: number;
      readonly modelCount: number;
      readonly routeCount: number;
    }[];
    readonly accounts: readonly {
      readonly id: string;
      readonly providerId: string;
      readonly credentialConfigured: boolean;
      readonly modelCount: number;
      readonly routeCount: number;
    }[];
    readonly profiles: readonly {
      readonly id: string;
      readonly accountCount: number;
      readonly routeCount: number;
    }[];
    readonly models: readonly {
      readonly id: string;
      readonly providerId: string;
      readonly upstreamModel: string;
      readonly capabilities: {
        readonly tools: boolean;
        readonly parallelToolCalls: boolean;
        readonly vision: boolean;
        readonly structuredOutput: boolean;
        readonly fileInput: boolean;
        readonly reasoning: boolean;
        readonly contextTokens: number;
      };
    }[];
    readonly routes: readonly {
      readonly id: string;
      readonly modelId: string;
      readonly providerId: string;
      readonly accountId: string;
      readonly profileIds: readonly string[];
      readonly enabled: boolean;
      readonly priority: number;
    }[];
  };
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
    expect(response.body).toContain('Request traces');
    expect(response.body).toContain('Providers and accounts');
    expect(response.body).toContain('Active routing plan');
    expect(response.body).toContain('Needs attention');
    expect(response.body).toContain('data-view="overview"');
    expect(response.body).toContain('data-api-mode="responses"');
    expect(response.body).toContain('Environment-only setup');
    expect(response.body).toContain('routingConfigOutput');
    expect(response.body).toContain('validateSetupButton');
    expect(response.body).toContain('applySetupButton');
    expect(response.body).toContain('generationList');
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
    expect(styles.body).toContain('--font-sans: Inter');
    expect(styles.body).toContain('--font-mono: "JetBrains Mono"');
    expect(styles.body).toContain('--tony-lime-400: #c8f500');
    expect(styles.body).toContain('.overview-grid');
    expect(styles.body).toContain('.routing-list');
    expect(styles.body).toContain('.providers-layout');
    expect(styles.body).toContain('.provider-table');
    expect(styles.body).toContain('.mobile-nav');
    expect(styles.body).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles.body).toContain('.control-history');
    expect(styles.body).toContain('.generation-row');
    expect(styles.body).not.toContain(TOKEN);

    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body).toContain(
      "sessionStorage.getItem('tony-router-token')",
    );
    expect(script.body).toContain("fetch('/ui/api/dashboard'");
    expect(script.body).toContain("fetch('/v1/models'");
    expect(script.body).toContain("fetch('/v1/chat/completions'");
    expect(script.body).toContain("'/v1/responses'");
    expect(script.body).toContain('function renderRoutingPlan()');
    expect(script.body).toContain('function renderAttention()');
    expect(script.body).toContain('function runPlayground()');
    expect(script.body).toContain('function applyTheme(theme)');
    expect(script.body).toContain('function renderProviders()');
    expect(script.body).toContain('function generateSetupConfiguration()');
    expect(script.body).toContain('data-setup-provider');
    expect(script.body).toContain('function validateSetupLocally()');
    expect(script.body).toContain('function applySetupLocally()');
    expect(script.body).toContain('function loadControlGenerations()');
    expect(script.body).toContain('data-health-account');
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
      control: {
        enabled: false,
        status: 'disabled',
        restartRequired: false,
        generationCount: 0,
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

  it('returns a safe routed provider inventory with sibling accounts', async () => {
    const app = track(
      buildGateway({
        config: config(),
        logger: createNullLogger(),
        router: routedConfig(),
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/ui/api/dashboard',
      headers: authorization(),
    });
    const body = response.json<DashboardTestResponse>();

    expect(response.statusCode).toBe(200);
    expect(body.routing).toMatchObject({
      version: 2,
      defaultProfileId: 'tony-auto',
      providers: [
        expect.objectContaining({
          id: 'openai',
          accountCount: 2,
          modelCount: 1,
          routeCount: 2,
        }),
      ],
      accounts: [
        expect.objectContaining({
          id: 'personal',
          providerId: 'openai',
          credentialConfigured: true,
          modelCount: 1,
          routeCount: 1,
        }),
        expect.objectContaining({
          id: 'work',
          providerId: 'openai',
          credentialConfigured: false,
          modelCount: 1,
          routeCount: 1,
        }),
      ],
      profiles: [
        expect.objectContaining({
          id: 'tony-auto',
          accountCount: 2,
          routeCount: 2,
        }),
      ],
      models: [
        expect.objectContaining({
          id: 'gpt',
          providerId: 'openai',
          upstreamModel: 'gpt-5',
        }),
      ],
      routes: [
        expect.objectContaining({
          id: 'personal-route',
          modelId: 'gpt',
          providerId: 'openai',
          accountId: 'personal',
          profileIds: ['tony-auto'],
          enabled: true,
          priority: 20,
        }),
        expect.objectContaining({
          id: 'work-route',
          modelId: 'gpt',
          providerId: 'openai',
          accountId: 'work',
          profileIds: ['tony-auto'],
          enabled: true,
          priority: 10,
        }),
      ],
    });
    expect(body.routing?.models[0]?.capabilities).toEqual({
      tools: true,
      parallelToolCalls: true,
      vision: false,
      structuredOutput: true,
      fileInput: false,
      reasoning: false,
      contextTokens: 128000,
    });
    expect(response.body).toContain('https://work.openai.example/v1');
    expect(response.body).not.toContain(ROUTED_SECRET);
    expect(response.body).not.toContain('authorization');
    expect(response.body).not.toContain('apiKey');
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
