import { randomUUID } from 'node:crypto';

import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';

import { installBearerAuthentication } from './auth.js';
import type { GatewayConfig } from './config.js';
import { installRequestDeadline } from './deadline.js';
import {
  normalizeFastifyError,
  sendGatewayError,
} from './errors.js';
import {
  createJsonLogger,
  type JsonLogger,
} from './logger.js';

export interface GatewayModel {
  readonly id: string;
  readonly ownedBy?: string;
  readonly created?: number;
}

export interface BuildGatewayOptions {
  readonly config: GatewayConfig;
  readonly models?: readonly GatewayModel[];
  readonly logger?: JsonLogger;
}

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '/';
}

export function buildGateway(options: BuildGatewayOptions): FastifyInstance {
  const { config } = options;
  const logger =
    options.logger ??
    createJsonLogger({ sensitiveValues: [config.token] });
  const models = [...(options.models ?? [])];

  const app = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    genReqId: () => randomUUID(),
  });

  app.addHook('onRequest', async (request) => {
    logger.info('request_started', {
      requestId: request.id,
      method: request.method,
      path: requestPath(request),
    });
  });

  installRequestDeadline(app, config.requestTimeoutMs);
  installBearerAuthentication(app, config.token);

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info('request_completed', {
      requestId: request.id,
      method: request.method,
      path: requestPath(request),
      statusCode: reply.statusCode,
    });
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

  app.get('/health', async () => ({
    status: 'ok',
    service: 'tony-router',
    version: config.version,
  }));

  app.get('/v1/models', async () => ({
    object: 'list',
    data: models.map((model) => ({
      id: model.id,
      object: 'model',
      created: model.created ?? 0,
      owned_by: model.ownedBy ?? 'tony-router',
    })),
  }));

  return app;
}
