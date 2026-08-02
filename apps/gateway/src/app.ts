import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { installBearerAuthentication } from './auth.js';
import type { GatewayConfig } from './config.js';
import { installRequestDeadline } from './deadline.js';
import {
  GatewayHttpError,
  normalizeFastifyError,
  sendGatewayError,
} from './errors.js';
import { createJsonLogger, type JsonLogger } from './logger.js';
import {
  OpenAICompatibleClient,
  type OpenAICompatibleProvider,
} from './openai/client.js';
import { parseChatCompletionRequest } from './openai/protocol.js';
import { createRequestAbortContext } from './request-abort.js';
import { GatewayTelemetry } from './telemetry.js';
import { installUiRoutes, type UiProviderMode } from './ui.js';

export interface GatewayModel {
  readonly id: string;
  readonly ownedBy?: string;
  readonly created?: number;
}

export interface BuildGatewayOptions {
  readonly config: GatewayConfig;
  readonly models?: readonly GatewayModel[];
  readonly logger?: JsonLogger;
  readonly provider?: OpenAICompatibleProvider;
}

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '/';
}

function providerMode(
  provider: OpenAICompatibleProvider | undefined,
  models: readonly GatewayModel[],
): UiProviderMode {
  if (provider) return 'openai-compatible';
  if (models.length > 0) return 'static-registry';
  return 'unconfigured';
}

export function buildGateway(options: BuildGatewayOptions): FastifyInstance {
  const { config } = options;
  const sensitiveValues = [
    config.token,
    ...(config.upstream?.apiKey ? [config.upstream.apiKey] : []),
  ];
  const logger = options.logger ?? createJsonLogger({ sensitiveValues });
  const models = [...(options.models ?? [])];
  const provider =
    options.provider ??
    (config.upstream
      ? new OpenAICompatibleClient(config.upstream, logger)
      : undefined);
  const telemetry = new GatewayTelemetry();

  const app = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    genReqId: () => randomUUID(),
  });

  app.addHook('onRequest', (request) => {
    const path = requestPath(request);
    telemetry.start({
      requestId: request.id,
      method: request.method,
      path,
    });
    logger.info('request_started', {
      requestId: request.id,
      method: request.method,
      path,
    });
    return Promise.resolve();
  });

  installRequestDeadline(app, config.requestTimeoutMs, {
    skipPaths: new Set(['/v1/models', '/v1/chat/completions']),
  });
  installBearerAuthentication(app, config.token);

  app.addHook('onSend', (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return Promise.resolve(payload);
  });

  app.addHook('onResponse', (request, reply) => {
    const path = requestPath(request);
    telemetry.complete({
      requestId: request.id,
      statusCode: reply.statusCode,
    });
    logger.info('request_completed', {
      requestId: request.id,
      method: request.method,
      path,
      statusCode: reply.statusCode,
    });
    return Promise.resolve();
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeFastifyError(error);
    logger.error('request_failed', {
      requestId: request.id,
      method: request.method,
      path: requestPath(request),
      statusCode: normalized.statusCode,
      error,
    });
    sendGatewayError(
      reply,
      normalized.statusCode,
      normalized.code,
      normalized.message,
      request.id,
      normalized.headers,
    );
  });

  app.setNotFoundHandler((request, reply) =>
    sendGatewayError(
      reply,
      404,
      'not_found',
      'The requested route does not exist',
      request.id,
    ),
  );

  installUiRoutes(app, {
    telemetry,
    runtime: {
      version: config.version,
      host: config.host,
      port: config.port,
      tokenSource: config.tokenSource,
      provider: {
        mode: providerMode(provider, models),
        ...(config.upstream ? { baseUrl: config.upstream.baseUrl } : {}),
        credentialConfigured: Boolean(config.upstream?.apiKey),
      },
    },
  });

  app.get('/health', () => ({
    status: 'ok',
    service: 'tony-router',
    version: config.version,
  }));

  app.get('/v1/models', async (request, reply) => {
    if (!provider) {
      return {
        object: 'list',
        data: models.map((model) => ({
          id: model.id,
          object: 'model',
          created: model.created ?? 0,
          owned_by: model.ownedBy ?? 'tony-router',
        })),
      };
    }

    const abortContext = createRequestAbortContext(request, reply);
    try {
      return await provider.listModels({
        requestId: request.id,
        signal: abortContext.signal,
      });
    } finally {
      abortContext.cleanup();
    }
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    if (!provider) {
      throw new GatewayHttpError(
        503,
        'provider_not_configured',
        'No OpenAI-compatible upstream is configured',
      );
    }

    const chatRequest = parseChatCompletionRequest(request.body);
    const abortContext = createRequestAbortContext(request, reply);
    let streaming = false;

    try {
      const result = await provider.createChatCompletion(chatRequest, {
        requestId: request.id,
        signal: abortContext.signal,
      });

      if (!result.stream) return result.body;

      const cleanup = (): void => abortContext.cleanup();
      result.body.once('end', cleanup);
      result.body.once('close', cleanup);
      result.body.once('error', cleanup);

      reply.header('content-type', 'text/event-stream; charset=utf-8');
      reply.header('cache-control', 'no-cache, no-transform');
      reply.header('connection', 'keep-alive');
      reply.header('x-accel-buffering', 'no');
      const sent = reply.send(result.body);
      streaming = true;
      return sent;
    } finally {
      if (!streaming) abortContext.cleanup();
    }
  });

  return app;
}
