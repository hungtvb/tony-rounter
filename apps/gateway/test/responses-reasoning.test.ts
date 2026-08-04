/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

import { Readable } from 'node:stream';

import { parseRoutingConfig } from '@tony-router/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildGateway,
  createNullLogger,
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
    tokenFile: '/tmp/tony-router-responses-reasoning-token',
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

function sse(data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

function reasoningRefusalStream(id: string): ChatCompletionResult {
  return {
    stream: true,
    body: Readable.from([
      sse({
        id,
        created: 123,
        choices: [
          {
            index: 0,
            delta: { reasoning_summary: 'Safety checked.' },
            finish_reason: null,
          },
        ],
      }),
      sse({
        id,
        created: 123,
        choices: [
          {
            index: 0,
            delta: { refusal: 'I cannot help.' },
            finish_reason: null,
          },
        ],
      }),
      sse({
        id,
        created: 123,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      }),
      sse('[DONE]'),
    ]),
  };
}

function directProvider(
  createChatCompletion: OpenAICompatibleProvider['createChatCompletion'],
): OpenAICompatibleProvider {
  return {
    listModels: vi.fn().mockResolvedValue({ object: 'list', data: [] }),
    createChatCompletion,
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
      reasoning: false
      contextTokens: 128000
  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      reasoning: true
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

function routerConfig(allUnsupported = false): GatewayRouterConfig {
  const yaml = allUnsupported
    ? ROUTING_YAML.replace('reasoning: true', 'reasoning: false')
    : ROUTING_YAML;
  return {
    registry: parseRoutingConfig(yaml),
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

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('Responses refusal and reasoning gateway compatibility', () => {
  it('normalizes a non-streaming reasoning summary and refusal', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_refusal',
        created: 123,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              reasoning_summary: 'Safety checked.',
              refusal: 'I cannot help.',
            },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        provider: directProvider(createChatCompletion),
        logger: createNullLogger(),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: 'Unsafe request',
        reasoning: { effort: 'high', summary: 'concise' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      reasoning_effort: 'high',
      reasoning_summary: 'concise',
    });
    expect(response.json()).toMatchObject({
      reasoning: { effort: 'high', summary: 'concise' },
      output: [
        { type: 'reasoning', summary: [{ text: 'Safety checked.' }] },
        {
          type: 'message',
          content: [{ type: 'refusal', refusal: 'I cannot help.' }],
        },
      ],
    });
  });

  it('streams protocol-ordered reasoning summary and refusal events', async () => {
    const createChatCompletion = vi
      .fn()
      .mockResolvedValue(reasoningRefusalStream('chatcmpl_reasoning_stream'));
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        provider: directProvider(createChatCompletion),
        logger: createNullLogger(),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: 'Unsafe request',
        stream: true,
        reasoning: { effort: 'high', summary: 'concise' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      'event: response.reasoning_summary_text.delta',
    );
    expect(response.body).toContain('event: response.refusal.delta');
    expect(response.body).toContain('event: response.refusal.done');
    expect(response.body).toContain('"reasoning_tokens":2');
  });

  it('skips a higher-priority route without reasoning capability', async () => {
    const primary = new FakeProvider(async () =>
      reasoningRefusalStream('chatcmpl_primary_must_not_run'),
    );
    const backup = new FakeProvider(async () =>
      reasoningRefusalStream('chatcmpl_backup_reasoning'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'tony-auto',
        input: 'Think carefully.',
        stream: true,
        reasoning: { effort: 'medium', summary: 'auto' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-account']).toBe('backup');
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(1);
    expect(backup.requests[0]).toMatchObject({
      model: 'backup-upstream',
      reasoning_effort: 'medium',
      reasoning_summary: 'auto',
    });
  });

  it('rejects before provider invocation when all routes lack reasoning', async () => {
    const primary = new FakeProvider(async () =>
      reasoningRefusalStream('chatcmpl_primary_must_not_run'),
    );
    const backup = new FakeProvider(async () =>
      reasoningRefusalStream('chatcmpl_backup_must_not_run'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(true),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'tony-auto',
        input: 'Think carefully.',
        reasoning: { effort: 'high' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'no_compatible_route' },
    });
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(0);
  });
});
