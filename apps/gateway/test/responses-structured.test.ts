/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally implement asynchronous interfaces */

import { readFileSync } from 'node:fs';
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
const structuredFixture = fixture('codex-structured.json');
const structuredStreamFixture = fixture('codex-structured-stream.json');

function fixture(name: string): Readonly<Record<string, unknown>> {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/responses/${name}`, import.meta.url),
      'utf8',
    ),
  ) as Readonly<Record<string, unknown>>;
}

function gatewayConfig(): GatewayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowNonLoopback: false,
    token: GATEWAY_TOKEN,
    tokenFile: '/tmp/tony-router-responses-structured-token',
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

function successfulStream(id: string, text: string): ChatCompletionResult {
  return {
    stream: true,
    body: Readable.from([
      sse({
        id,
        created: 123,
        choices: [
          {
            index: 0,
            delta: { content: text },
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
            delta: {},
            finish_reason: 'stop',
          },
        ],
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
      structuredOutput: false
      contextTokens: 128000
  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
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

function routerConfig(allUnsupported = false): GatewayRouterConfig {
  const yaml = allUnsupported
    ? ROUTING_YAML.replace('structuredOutput: true', 'structuredOutput: false')
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

describe('Responses structured output gateway compatibility', () => {
  it('forwards the Codex-style JSON fixture losslessly', async () => {
    const createChatCompletion = vi.fn().mockResolvedValue({
      stream: false,
      body: {
        id: 'chatcmpl_structured_json',
        created: 123,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '{"summary":"safe","files":["src/index.ts"]}',
            },
            finish_reason: 'stop',
          },
        ],
      },
    });
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        logger: createNullLogger(),
        provider: directProvider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: structuredFixture,
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      model: 'coding',
      messages: [
        { role: 'developer', content: 'Return a deterministic edit plan.' },
        {
          role: 'user',
          content: 'Plan the smallest safe patch for src/index.ts.',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            strict: true,
          },
        },
      ],
      tool_choice: 'auto',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'edit_plan',
          description: 'A bounded source-edit plan.',
          strict: true,
          schema: structuredSchema(structuredFixture),
        },
      },
      stream: false,
    });
    expect(response.json()).toMatchObject({
      object: 'response',
      model: 'coding',
      text: {
        format: {
          type: 'json_schema',
          name: 'edit_plan',
          strict: true,
          schema: structuredSchema(structuredFixture),
        },
      },
    });
  });

  it('forwards the Codex-style image + structured SSE fixture', async () => {
    const createChatCompletion = vi
      .fn()
      .mockResolvedValue(
        successfulStream(
          'chatcmpl_structured_stream',
          '{"status":"ready","confidence":0.99}',
        ),
      );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        logger: createNullLogger(),
        provider: directProvider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: structuredStreamFixture,
    });

    expect(response.statusCode).toBe(200);
    expect(createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
      model: 'tony-auto',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        {
          role: 'developer',
          content: 'Inspect the screenshot and return JSON only.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify the visible status.' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://images.example.test/status.png',
                detail: 'low',
              },
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'status_result',
          strict: true,
          schema: structuredSchema(structuredStreamFixture),
        },
      },
    });
    expect(response.body).toContain('event: response.created');
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"type":"json_schema"');
    expect(response.body).toContain('"name":"status_result"');
  });

  it('rejects malformed structured output before invoking the provider', async () => {
    const createChatCompletion = vi.fn();
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        logger: createNullLogger(),
        provider: directProvider(createChatCompletion),
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: authorization(),
      payload: {
        model: 'coding',
        input: 'hello',
        text: {
          format: {
            type: 'json_schema',
            name: 'bad name',
            schema: {},
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'invalid_request' },
    });
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('skips a higher-priority model without structured output capability', async () => {
    const primary = new FakeProvider(async () =>
      successfulStream('chatcmpl_primary_incompatible', 'must not run'),
    );
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup_structured', '{"status":"ready"}'),
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
      headers: {
        ...authorization(),
        'x-tony-router-replay-safe': 'true',
      },
      payload: structuredStreamFixture,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-account']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('1');
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(1);
    expect(backup.requests[0]).toMatchObject({
      model: 'backup-upstream',
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'status_result', strict: true },
      },
    });
  });

  it('rejects before provider invocation when every route lacks structured output', async () => {
    const primary = new FakeProvider(async () =>
      successfulStream('chatcmpl_primary', 'must not run'),
    );
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup', 'must not run'),
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
      payload: structuredStreamFixture,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'no_compatible_route' },
    });
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(0);
  });
});

function structuredSchema(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const text = value.text as Readonly<Record<string, unknown>>;
  const format = text.format as Readonly<Record<string, unknown>>;
  return format.schema as Readonly<Record<string, unknown>>;
}
