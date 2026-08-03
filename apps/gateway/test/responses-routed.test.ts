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
    tokenFile: '/tmp/tony-router-responses-routed-token',
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
      vision: false
      structuredOutput: true
      contextTokens: 128000
  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
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

function toolHistoryRouterConfig(): GatewayRouterConfig {
  const registry = parseRoutingConfig(
    ROUTING_YAML.replace(
      'tools: true\n      parallelToolCalls: true',
      'tools: false\n      parallelToolCalls: false',
    ),
  );
  const base = routerConfig();
  return { ...base, registry };
}

function visionRouterConfig(): GatewayRouterConfig {
  const registry = parseRoutingConfig(
    ROUTING_YAML.replace(
      `  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: false`,
      `  backup-model:
    provider: backup
    upstreamModel: backup-upstream
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true`,
    ),
  );
  const base = routerConfig();
  return { ...base, registry };
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

function sse(data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `data: ${payload}\n\n`;
}

function textChunk(
  id: string,
  content: string | null,
  finishReason: string | null = null,
): Readonly<Record<string, unknown>> {
  return {
    id,
    created: 123,
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
      },
    ],
  };
}

function successfulStream(id: string, text: string): ChatCompletionResult {
  return {
    stream: true,
    body: Readable.from([
      sse(textChunk(id, text)),
      sse(textChunk(id, null, 'stop')),
      sse('[DONE]'),
    ]),
  };
}

function successfulFunctionStream(id: string): ChatCompletionResult {
  return {
    stream: true,
    body: Readable.from([
      sse({
        id,
        created: 123,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: '{"path":"a.txt"}',
                  },
                },
              ],
            },
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
            finish_reason: 'tool_calls',
          },
        ],
      }),
      sse('[DONE]'),
    ]),
  };
}

function track(app: FastifyInstance): FastifyInstance {
  apps.push(app);
  return app;
}

async function routedResponse(
  app: FastifyInstance,
  payload: Readonly<Record<string, unknown>> = {
    model: 'tony-auto',
    input: 'hello',
    stream: true,
  },
) {
  return app.inject({
    method: 'POST',
    url: '/v1/responses',
    headers: {
      ...authorization(),
      'content-type': 'application/json',
      'x-tony-router-replay-safe': 'true',
    },
    payload,
  });
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

describe('routed Responses text streaming', () => {
  it('falls back before output and preserves routed identity headers', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup', 'backup output'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-account']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('2');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"model":"tony-auto"');
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(1);
  });

  it('routes self-contained function output continuation with fallback', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup_continuation', 'continued'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      stream: true,
      input: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{"path":"a.txt"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"ok":true}',
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-account']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('2');
    expect(response.body).toContain('event: response.completed');
    expect(response.body).toContain('"model":"tony-auto"');
    expect(primary.requests[0]).toMatchObject({
      model: 'primary-upstream',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{"path":"a.txt"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      ],
    });
    expect(backup.requests[0]).toMatchObject({
      model: 'backup-upstream',
      messages: primary.requests[0]?.messages,
    });
  });

  it('skips models without tool capability for replayed tool history', async () => {
    const primary = new FakeProvider(async () =>
      successfulStream('chatcmpl_primary_incompatible', 'must not run'),
    );
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup_compatible', 'continued'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: toolHistoryRouterConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      stream: true,
      input: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{"path":"a.txt"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"ok":true}',
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('1');
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(1);
  });

  it('routes image input only to a vision-capable model', async () => {
    const primary = new FakeProvider(async () =>
      successfulStream('chatcmpl_primary_incompatible', 'must not run'),
    );
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup_vision', 'a cat'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: visionRouterConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      stream: true,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe this.' },
            {
              type: 'input_image',
              image_url: 'https://images.example.test/cat.png',
              detail: 'high',
            },
          ],
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('1');
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(1);
    expect(backup.requests[0]).toMatchObject({
      model: 'backup-upstream',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this.' },
            {
              type: 'image_url',
              image_url: {
                url: 'https://images.example.test/cat.png',
                detail: 'high',
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects image input before provider invocation when no route supports vision', async () => {
    const primary = new FakeProvider(async () =>
      successfulStream('chatcmpl_primary', 'must not run'),
    );
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup', 'must not run'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      stream: true,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'https://images.example.test/cat.png',
            },
          ],
        },
      ],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'no_compatible_route' },
    });
    expect(primary.requests).toHaveLength(0);
    expect(backup.requests).toHaveLength(0);
  });

  it('routes streaming function tools and preserves public identity', async () => {
    const primary = new FakeProvider(async () => {
      throw new GatewayHttpError(
        502,
        'upstream_authentication_failed',
        'credentials rejected',
      );
    });
    const backup = new FakeProvider(async () =>
      successfulFunctionStream('chatcmpl_backup_function'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      input: 'write a file',
      stream: true,
      parallel_tool_calls: false,
      tools: [
        {
          type: 'function',
          name: 'write_file',
          parameters: { type: 'object', properties: {} },
        },
      ],
      tool_choice: 'required',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('backup-route');
    expect(response.headers['x-tony-router-provider']).toBe('backup');
    expect(response.headers['x-tony-router-account']).toBe('backup');
    expect(response.headers['x-tony-router-attempts']).toBe('2');
    expect(response.body).toContain(
      'event: response.function_call_arguments.delta',
    );
    expect(response.body).toContain('"model":"tony-auto"');
    expect(response.body).toContain('"call_id":"call_1"');
    expect(primary.requests[0]).toMatchObject({
      model: 'primary-upstream',
      tool_choice: 'required',
    });
    expect(backup.requests[0]).toMatchObject({
      model: 'backup-upstream',
      tool_choice: 'required',
    });
  });

  it('never invokes fallback after the primary stream emits output', async () => {
    const primary = new FakeProvider(async () => ({
      stream: true,
      body: Readable.from([
        sse(textChunk('chatcmpl_primary', 'partial')),
        sse('{"broken":'),
      ]),
    }));
    const backup = new FakeProvider(async () =>
      successfulStream('chatcmpl_backup', 'must not run'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('primary-route');
    expect(response.headers['x-tony-router-provider']).toBe('primary');
    expect(response.headers['x-tony-router-account']).toBe('primary');
    expect(response.headers['x-tony-router-attempts']).toBe('1');
    expect(response.body).toContain('event: response.output_text.delta');
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('event: response.completed');
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(0);
  });

  it('never invokes fallback after a primary function-call event', async () => {
    const primary = new FakeProvider(async () => ({
      stream: true,
      body: Readable.from([
        sse({
          id: 'chatcmpl_primary_function',
          created: 123,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
        sse('{"broken":'),
      ]),
    }));
    const backup = new FakeProvider(async () =>
      successfulFunctionStream('chatcmpl_backup_function'),
    );
    const app = track(
      buildGateway({
        config: gatewayConfig(),
        router: routerConfig(),
        routedProviders: { primary, backup },
        logger: createNullLogger(),
      }),
    );

    const response = await routedResponse(app, {
      model: 'tony-auto',
      input: 'write a file',
      stream: true,
      tools: [{ type: 'function', name: 'write_file' }],
      tool_choice: 'required',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-tony-router-route']).toBe('primary-route');
    expect(response.headers['x-tony-router-provider']).toBe('primary');
    expect(response.headers['x-tony-router-attempts']).toBe('1');
    expect(response.body).toContain(
      'event: response.function_call_arguments.delta',
    );
    expect(response.body).toContain('event: error');
    expect(response.body).not.toContain('event: response.completed');
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(0);
  });
});
