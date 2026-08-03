/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

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
      vision: true
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
        priority: 20
      - route: work-route
        priority: 10
`;

function gatewayConfig(): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: GATEWAY_TOKEN,
    tokenFile: '/tmp/tony-router-account-test-token',
    tokenSource: 'environment',
    bodyLimitBytes: 1024 * 1024,
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
    version: '0.2.0',
  };
}

function routerConfig(): GatewayRouterConfig {
  return {
    registry: parseRoutingConfig(ROUTING_YAML),
    providers: {
      openai: { baseUrl: 'https://api.openai.test/v1', timeoutMs: 500 },
    },
    accounts: {
      personal: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.test/v1',
        timeoutMs: 500,
      },
      work: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.test/v1',
        timeoutMs: 500,
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
    const result = await this.handler(request, context);
    if (result.stream || !context.publicModel) return result;
    return {
      stream: false,
      body: { ...result.body, model: context.publicModel },
    };
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

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('provider account routing', () => {
  it('falls back between sibling accounts and isolates circuit state by account', async () => {
    const personal = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'personal credential rejected',
      );
    });
    const work = new FakeProvider(async (request) => jsonResult(request.model));
    const app = buildGateway({
      config: gatewayConfig(),
      router: routerConfig(),
      routedAccounts: { personal, work },
      logger: createNullLogger(),
    });
    apps.push(app);

    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { ...authorization(), 'content-type': 'application/json' },
        payload: { model: 'tony-auto', messages: [] },
      });

    const first = await send();
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-tony-router-provider']).toBe('openai');
    expect(first.headers['x-tony-router-account']).toBe('work');
    expect(first.headers['x-tony-router-route']).toBe('work-route');
    expect(first.headers['x-tony-router-attempts']).toBe('2');
    expect(first.json()).toMatchObject({ model: 'tony-auto' });
    expect(personal.requests[0]?.model).toBe('gpt-5');
    expect(work.requests[0]?.model).toBe('gpt-5');

    const second = await send();
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-tony-router-account']).toBe('work');
    expect(personal.requests).toHaveLength(1);
    expect(work.requests).toHaveLength(2);
  });
});
