/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

import { Readable } from 'node:stream';

import { parseRoutingConfig } from '@tony-router/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildGateway,
  createNullLogger,
  GatewayHttpError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type GatewayConfig,
  type OpenAICompatibleProvider,
  type ProviderRequestContext,
} from '../src/index.js';
import type { GatewayRouterConfig } from '../src/routing/config.js';
import { authorization, GATEWAY_TOKEN } from './helpers/openai-harness.js';

const apps: FastifyInstance[] = [];

function gatewayConfig(): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: GATEWAY_TOKEN,
    tokenFile: '/tmp/tony-router-routed-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
    version: '0.2.0',
  };
}

const ROUTING_YAML = `version: 1
defaultProfile: tony-auto
providers:
  primary:
    kind: openai-compatible
  backup:
    kind: openai-compatible
models:
  primary-model:
    provider: primary
    upstreamModel: primary-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      contextTokens: 128000
  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: false
      parallelToolCalls: false
      vision: false
      structuredOutput: true
      contextTokens: 128000
routes:
  primary-route:
    model: primary-model
    priority: 10
  backup-route:
    model: backup-model
    priority: 0
profiles:
  tony-auto:
    routes:
      - route: primary-route
        priority: 10
      - route: backup-route
        priority: 0
`;

function routerConfig(): GatewayRouterConfig {
  return {
    registry: parseRoutingConfig(ROUTING_YAML),
    providers: {
      primary: { baseUrl: 'https://primary.example.test', timeoutMs: 500 },
      backup: { baseUrl: 'https://backup.example.test', timeoutMs: 500 },
    },
    fallbackPolicy: {
      maxAttemptsPerRoute: 1,
      maxTotalAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      totalDeadlineMs: 1000,
    },
    circuitBreaker: {
      failureThreshold: 1,
      cooldownMs: 60_000,
      halfOpenMaxAttempts: 1,
    },
  };
}

class FakeProvider implements OpenAICompatibleProvider {
  readonly requests: ChatCompletionRequest[] = [];

  constructor(
    private readonly handler: (
      request: ChatCompletionRequest,
      context: ProviderRequestContext,
    ) => Promise<ChatCompletionResult>,
  ) {}

  async listModels() {
    return { object: 'list' as const, data: [] };
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<ChatCompletionResult> {
    this.requests.push(request);
    return this.handler(request, context);
  }
}

function jsonResult(model: string): ChatCompletionResult {
  return {
    stream: false,
    body: {
      id: `completion-${model}`,
      object: 'chat.completion',
      model,
      choices: [],
    },
  };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

async function routedChat(
  app: FastifyInstance,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: {
      ...authorization(),
      'content-type': 'application/json',
      ...headers,
    },
    payload: body,
  });
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('multi-provider routed gateway', () => {
  it('exposes routing profiles as OpenAI-compatible models', async () => {
    const primary = new FakeProvider(async () =>
      jsonResult('primary-upstream'),
    );
    const backup = new FakeProvider(async () => jsonResult('backup-upstream'));
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
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

  it('rewrites the public profile ID and falls back after auth rejection', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async (request) =>
      jsonResult(request.model),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedChat(app, {
      model: 'tony-auto',
      messages: [],
    });

    expect(response.statusCode).toBe(200);
    expect(primary.requests[0]?.model).toBe('primary-upstream');
    expect(backup.requests[0]?.model).toBe('backup-upstream');
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('2');
  });

  it('blocks ambiguous fallback unless replay is explicitly authorized', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_unavailable',
        'temporarily unavailable',
      );
    });
    const backup = new FakeProvider(async (request) =>
      jsonResult(request.model),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const blocked = await routedChat(app, {
      model: 'tony-auto',
      messages: [],
    });
    expect(blocked.statusCode).toBe(502);
    expect(blocked.json()).toMatchObject({
      error: { code: 'unsafe_replay_blocked' },
    });
    expect(backup.requests).toHaveLength(0);

    const replayed = await routedChat(
      app,
      { model: 'tony-auto', messages: [] },
      { 'x-tony-router-replay-safe': 'true' },
    );
    expect(replayed.statusCode).toBe(200);
    expect(backup.requests).toHaveLength(1);
  });

  it('never selects a fallback that lacks required tools', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async (request) =>
      jsonResult(request.model),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedChat(app, {
      model: 'tony-auto',
      messages: [],
      tools: [{ type: 'function', function: { name: 'search' } }],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'no_compatible_route' },
    });
    expect(backup.requests).toHaveLength(0);
  });

  it('keeps an opened primary circuit out of later requests', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async (request) =>
      jsonResult(request.model),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    await routedChat(app, { model: 'tony-auto', messages: [] });
    const second = await routedChat(app, {
      model: 'tony-auto',
      messages: [],
    });

    expect(second.statusCode).toBe(200);
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(2);
  });

  it('falls back before streaming output and does not replay an accepted stream', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async () => ({
      stream: true,
      body: Readable.from([
        'data: {"id":"chunk","choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    }));
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedChat(app, {
      model: 'tony-auto',
      messages: [],
      stream: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"content":"ok"');
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(1);
  });
});
