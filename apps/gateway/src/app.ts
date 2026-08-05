import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { installBearerAuthentication } from './auth.js';
import type { LocalConfigStore } from './control/config-store.js';
import { installControlRoutes } from './control/routes.js';
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
import {
  filePurpose,
  uploadContentType,
  uploadedFilename,
  type CanonicalFileObject,
  type ProviderFileUpload,
} from './openai/files.js';
import { parseChatCompletionRequest } from './openai/protocol.js';
import { prepareResponsesStream } from './openai/responses-stream-adapter.js';
import {
  chatCompletionToResponse,
  parseResponsesRequest,
  responsesToChatCompletion,
} from './openai/responses.js';
import {
  resolveVirtualFileIds,
  VirtualFileIdCodec,
  type VirtualFileOwner,
} from './openai/virtual-file-id.js';
import { createRequestAbortContext } from './request-abort.js';
import type { GatewayRouterConfig } from './routing/config.js';
import { routerSensitiveValues } from './routing/config.js';
import { RoutedOpenAIProvider } from './routing/provider.js';
import { GatewayTelemetry } from './telemetry.js';
import {
  buildUiRoutingInventory,
  installUiRoutes,
  type UiProviderMode,
} from './ui.js';

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
  readonly router?: GatewayRouterConfig;
  readonly routedAccounts?: Readonly<Record<string, OpenAICompatibleProvider>>;
  /** @deprecated Use routedAccounts. Preserved for version 1 integrations. */
  readonly routedProviders?: Readonly<Record<string, OpenAICompatibleProvider>>;
  readonly controlStore?: LocalConfigStore;
}

const MAX_FILE_UPLOAD_BYTES = 16 * 1024 * 1024;

function multipartFailure(error: unknown): never {
  const candidate =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = typeof candidate === 'string' ? candidate : '';
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    throw new GatewayHttpError(
      413,
      'file_too_large',
      `Uploaded file must not exceed ${MAX_FILE_UPLOAD_BYTES} bytes`,
    );
  }
  if (
    code === 'FST_FILES_LIMIT' ||
    code === 'FST_FIELDS_LIMIT' ||
    code === 'FST_PARTS_LIMIT'
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'File upload must contain exactly one file and one purpose field',
    );
  }
  if (
    code === 'FST_INVALID_MULTIPART_CONTENT_TYPE' ||
    code === 'FST_MP_PREMATURE_CLOSE'
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'Request must contain complete multipart form data',
    );
  }
  throw error;
}

async function parseFileUpload(
  request: FastifyRequest,
): Promise<ProviderFileUpload> {
  let bytes: Buffer | undefined;
  let filename: string | undefined;
  let contentType: string | undefined;
  let purpose: unknown;

  try {
    for await (const part of request.parts({
      limits: {
        fileSize: MAX_FILE_UPLOAD_BYTES,
        files: 1,
        fields: 1,
        parts: 2,
        fieldNameSize: 100,
        fieldSize: 100,
        headerPairs: 50,
      },
    })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || bytes !== undefined) {
          throw new GatewayHttpError(
            400,
            'invalid_file_upload',
            'File upload must contain exactly one file field named file',
          );
        }
        filename = uploadedFilename(part.filename);
        contentType = uploadContentType(part.mimetype);
        bytes = await part.toBuffer();
        if (part.file.truncated) {
          throw new GatewayHttpError(
            413,
            'file_too_large',
            `Uploaded file must not exceed ${MAX_FILE_UPLOAD_BYTES} bytes`,
          );
        }
        continue;
      }
      if (part.fieldname !== 'purpose' || purpose !== undefined) {
        throw new GatewayHttpError(
          400,
          'invalid_file_upload',
          'File upload must contain exactly one purpose field',
        );
      }
      purpose = part.value;
    }
  } catch (error) {
    if (error instanceof GatewayHttpError) throw error;
    return multipartFailure(error);
  }

  if (!bytes || bytes.byteLength === 0 || !filename || !contentType) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'File upload must contain one non-empty file and purpose=user_data',
    );
  }
  return Object.freeze({
    bytes,
    filename,
    contentType,
    purpose: filePurpose(purpose),
  });
}

function publicFileObject(
  file: CanonicalFileObject,
  publicId: string,
): CanonicalFileObject {
  return Object.freeze({ ...file, id: publicId });
}

function requireOwnerMode<TMode extends VirtualFileOwner['mode']>(
  owner: VirtualFileOwner,
  mode: TMode,
): asserts owner is Extract<VirtualFileOwner, Readonly<{ mode: TMode }>> {
  if (owner.mode !== mode) {
    throw new GatewayHttpError(
      400,
      'invalid_file_id',
      'The supplied file ID is invalid for this Tony Router instance',
    );
  }
}

function requireDirectBinding(
  owner: Extract<VirtualFileOwner, Readonly<{ mode: 'direct' }>>,
  expectedBindingId: string,
): void {
  if (owner.bindingId !== expectedBindingId) {
    throw new GatewayHttpError(
      400,
      'invalid_file_id',
      'The supplied file ID is invalid for this Tony Router instance',
    );
  }
}

function requestPath(request: FastifyRequest): string {
  const routePath = request.routeOptions.url;
  if (routePath) return routePath;
  return request.url.split('?', 1)[0] ?? '/';
}

function providerMode(
  routed: RoutedOpenAIProvider | undefined,
  provider: OpenAICompatibleProvider | undefined,
  models: readonly GatewayModel[],
): UiProviderMode {
  if (routed) return 'routed';
  if (provider) return 'openai-compatible';
  if (models.length > 0) return 'static-registry';
  return 'unconfigured';
}

function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new GatewayHttpError(
      400,
      'invalid_router_header',
      `${name} must be supplied at most once`,
    );
  }
  return value;
}

function replaySafe(request: FastifyRequest): boolean {
  const value = singleHeader(request, 'x-tony-router-replay-safe');
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new GatewayHttpError(
    400,
    'invalid_router_header',
    'x-tony-router-replay-safe must be either true or false',
  );
}

export function buildGateway(options: BuildGatewayOptions): FastifyInstance {
  const { config } = options;
  if (config.fileIdKey !== undefined && config.fileIdKey === config.token) {
    throw new GatewayHttpError(
      500,
      'invalid_file_id_key',
      'Virtual file IDs require a server-only key distinct from the client bearer token',
    );
  }
  if (options.router && (options.provider || config.upstream)) {
    throw new GatewayHttpError(
      500,
      'conflicting_provider_configuration',
      'Routed and legacy provider modes cannot be enabled together',
    );
  }

  if (Boolean(config.controlDir) !== Boolean(options.controlStore)) {
    throw new GatewayHttpError(
      500,
      'invalid_local_control_configuration',
      'Local control directory and store must be configured together',
    );
  }
  if (
    options.controlStore &&
    config.host !== '127.0.0.1' &&
    config.host !== '::1'
  ) {
    throw new GatewayHttpError(
      500,
      'unsafe_local_control_binding',
      'Local control APIs require a loopback gateway binding',
    );
  }
  if (
    config.controlDir &&
    options.controlStore &&
    config.controlDir !== options.controlStore.directory
  ) {
    throw new GatewayHttpError(
      500,
      'mismatched_local_control_directory',
      'Local control store does not match the configured directory',
    );
  }

  if (options.routedAccounts && options.routedProviders) {
    throw new GatewayHttpError(
      500,
      'conflicting_account_configuration',
      'Routed clients cannot be supplied through both routedAccounts and routedProviders',
    );
  }

  const sensitiveValues = [
    config.token,
    ...(config.fileIdKey ? [config.fileIdKey] : []),
    ...(config.upstream?.apiKey ? [config.upstream.apiKey] : []),
    ...routerSensitiveValues(options.router),
  ];
  const logger = options.logger ?? createJsonLogger({ sensitiveValues });
  const models = [...(options.models ?? [])];
  const routedAccountClients =
    options.routedAccounts ?? options.routedProviders;
  const provider =
    options.provider ??
    (config.upstream
      ? new OpenAICompatibleClient(config.upstream, logger)
      : undefined);
  const routed = options.router
    ? new RoutedOpenAIProvider({
        config: options.router,
        logger,
        ...(routedAccountClients ? { accounts: routedAccountClients } : {}),
      })
    : undefined;
  const telemetry = new GatewayTelemetry();

  const app = Fastify({
    logger: false,
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    routerOptions: { maxParamLength: 4096 },
    genReqId: () => randomUUID(),
  });

  void app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: MAX_FILE_UPLOAD_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
    },
  });
  const fileIdSecret =
    config.fileIdKey ?? randomBytes(32).toString('base64url');
  const fileIds = new VirtualFileIdCodec(fileIdSecret);
  const directFileBindingId = createHmac('sha256', fileIdSecret)
    .update(
      config.upstream
        ? `${config.upstream.baseUrl}\0${config.upstream.apiKey ?? ''}`
        : `injected-provider\0${randomBytes(16).toString('base64url')}`,
      'utf8',
    )
    .digest('base64url');

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
    skipPaths: new Set(['/v1/models', '/v1/chat/completions', '/v1/responses']),
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

  const routedProviderCount = options.router
    ? Object.keys(options.router.registry.providers).length
    : undefined;
  const routedAccountCount = options.router
    ? Object.keys(options.router.registry.accounts).length
    : undefined;
  const routingInventory = buildUiRoutingInventory(options.router);
  installUiRoutes(app, {
    telemetry,
    runtime: {
      version: config.version,
      host: config.host,
      port: config.port,
      tokenSource: config.tokenSource,
      provider: {
        mode: providerMode(routed, provider, models),
        ...(config.upstream ? { baseUrl: config.upstream.baseUrl } : {}),
        ...(routedProviderCount !== undefined
          ? { providerCount: routedProviderCount }
          : {}),
        ...(routedAccountCount !== undefined
          ? { accountCount: routedAccountCount }
          : {}),
        credentialConfigured: Boolean(
          config.upstream?.apiKey ||
          routerSensitiveValues(options.router).length,
        ),
      },
      ...(routingInventory ? { routing: routingInventory } : {}),
    },
    ...(options.controlStore ? { controlStore: options.controlStore } : {}),
  });
  installControlRoutes(app, {
    ...(options.controlStore ? { store: options.controlStore } : {}),
    ...(routed ? { routed } : {}),
  });

  app.get('/health', () => ({
    status: 'ok',
    service: 'tony-router',
    version: config.version,
  }));

  app.get('/v1/models', async (request, reply) => {
    if (routed) return routed.listModels();
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

  app.post('/v1/files', async (request, reply) => {
    if (!provider && !routed) {
      throw new GatewayHttpError(
        503,
        'provider_not_configured',
        'No OpenAI-compatible upstream is configured',
      );
    }

    const accountId = routed
      ? singleHeader(request, 'x-tony-router-account')
      : undefined;
    if (routed && !accountId) {
      throw new GatewayHttpError(
        400,
        'file_account_required',
        'x-tony-router-account is required for routed file uploads',
      );
    }
    if (
      !routed &&
      singleHeader(request, 'x-tony-router-account') !== undefined
    ) {
      throw new GatewayHttpError(
        400,
        'invalid_router_header',
        'x-tony-router-account is available only in routed mode',
      );
    }
    if (!routed && (!provider || typeof provider.createFile !== 'function')) {
      throw new GatewayHttpError(
        501,
        'files_api_not_supported',
        'The configured provider does not support the Files API',
      );
    }

    const upload = await parseFileUpload(request);
    const abortContext = createRequestAbortContext(request, reply);
    try {
      if (routed) {
        const uploaded = await routed.createFile(accountId!, upload, {
          requestId: request.id,
          signal: abortContext.signal,
        });
        const publicId = fileIds.encode({
          owner: {
            mode: 'routed',
            accountId: uploaded.accountId,
            providerId: uploaded.providerId,
          },
          upstreamFileId: uploaded.result.id,
          ...(uploaded.result.expires_at !== undefined
            ? { expiresAt: uploaded.result.expires_at }
            : {}),
        });
        reply.header('x-tony-router-provider', uploaded.providerId);
        reply.header('x-tony-router-account', uploaded.accountId);
        return publicFileObject(uploaded.result, publicId);
      }

      const uploaded = await provider!.createFile!(upload, {
        requestId: request.id,
        signal: abortContext.signal,
      });
      const publicId = fileIds.encode({
        owner: { mode: 'direct', bindingId: directFileBindingId },
        upstreamFileId: uploaded.id,
        ...(uploaded.expires_at !== undefined
          ? { expiresAt: uploaded.expires_at }
          : {}),
      });
      return publicFileObject(uploaded, publicId);
    } finally {
      abortContext.cleanup();
    }
  });

  app.delete('/v1/files/:fileId', async (request, reply) => {
    if (!provider && !routed) {
      throw new GatewayHttpError(
        503,
        'provider_not_configured',
        'No OpenAI-compatible upstream is configured',
      );
    }
    const params = request.params as Readonly<{ fileId?: unknown }>;
    if (typeof params.fileId !== 'string') {
      throw new GatewayHttpError(400, 'invalid_file_id', 'File ID is required');
    }
    const identity = fileIds.decode(params.fileId);
    const abortContext = createRequestAbortContext(request, reply);
    try {
      if (routed) {
        requireOwnerMode(identity.owner, 'routed');
        const owner = identity.owner;
        const deleted = await routed.deleteFile(
          owner.accountId,
          owner.providerId,
          identity.upstreamFileId,
          { requestId: request.id, signal: abortContext.signal },
        );
        reply.header('x-tony-router-provider', deleted.providerId);
        reply.header('x-tony-router-account', deleted.accountId);
        return Object.freeze({
          id: params.fileId,
          object: 'file',
          deleted: true,
        });
      }

      requireOwnerMode(identity.owner, 'direct');
      requireDirectBinding(identity.owner, directFileBindingId);
      if (!provider || typeof provider.deleteFile !== 'function') {
        throw new GatewayHttpError(
          501,
          'files_api_not_supported',
          'The configured provider does not support the Files API',
        );
      }
      await provider.deleteFile(identity.upstreamFileId, {
        requestId: request.id,
        signal: abortContext.signal,
      });
      return Object.freeze({
        id: params.fileId,
        object: 'file',
        deleted: true,
      });
    } finally {
      abortContext.cleanup();
    }
  });

  app.post('/v1/responses', async (request, reply) => {
    if (!provider && !routed) {
      throw new GatewayHttpError(
        503,
        'provider_not_configured',
        'No OpenAI-compatible upstream is configured',
      );
    }

    const responsesRequest = parseResponsesRequest(request.body);
    const resolvedFiles = resolveVirtualFileIds(
      responsesToChatCompletion(responsesRequest),
      fileIds,
    );
    const chatRequest = resolvedFiles.request;
    if (resolvedFiles.owner) {
      if (routed) {
        requireOwnerMode(resolvedFiles.owner, 'routed');
      } else {
        requireOwnerMode(resolvedFiles.owner, 'direct');
        requireDirectBinding(resolvedFiles.owner, directFileBindingId);
      }
    }
    const abortContext = createRequestAbortContext(request, reply);
    let streaming = false;

    try {
      const sessionId = singleHeader(request, 'x-tony-router-session');
      const routedResult = routed
        ? await routed.createChatCompletion(chatRequest, {
            requestId: request.id,
            signal: abortContext.signal,
            replaySafe: replaySafe(request),
            ...(sessionId ? { sessionId } : {}),
            ...(resolvedFiles.owner?.mode === 'routed'
              ? {
                  requiredFileOwner: {
                    accountId: resolvedFiles.owner.accountId,
                    providerId: resolvedFiles.owner.providerId,
                  },
                }
              : {}),
          })
        : undefined;
      const result = routedResult
        ? routedResult.result
        : await provider!.createChatCompletion(chatRequest, {
            requestId: request.id,
            signal: abortContext.signal,
          });

      if (routedResult) {
        reply.header('x-tony-router-route', routedResult.route.routeId);
        reply.header('x-tony-router-provider', routedResult.route.providerId);
        reply.header('x-tony-router-account', routedResult.route.accountId);
        reply.header('x-tony-router-attempts', routedResult.attempts);
      }

      if (responsesRequest.stream === true) {
        if (!result.stream) {
          throw new GatewayHttpError(
            502,
            'upstream_protocol_mismatch',
            'Upstream unexpectedly returned JSON for a streaming response',
          );
        }

        const body = await prepareResponsesStream(result.body, {
          model: responsesRequest.model,
          ...(responsesRequest.instructions !== undefined
            ? { instructions: responsesRequest.instructions }
            : {}),
          ...(responsesRequest.max_output_tokens !== undefined
            ? { maxOutputTokens: responsesRequest.max_output_tokens }
            : {}),
          ...(responsesRequest.parallel_tool_calls !== undefined
            ? { parallelToolCalls: responsesRequest.parallel_tool_calls }
            : {}),
          ...(responsesRequest.temperature !== undefined
            ? { temperature: responsesRequest.temperature }
            : {}),
          ...(responsesRequest.top_p !== undefined
            ? { topP: responsesRequest.top_p }
            : {}),
          ...(responsesRequest.tools !== undefined
            ? { tools: responsesRequest.tools }
            : {}),
          ...(responsesRequest.tool_choice !== undefined
            ? { toolChoice: responsesRequest.tool_choice }
            : {}),
          ...(responsesRequest.text?.format !== undefined
            ? { textFormat: responsesRequest.text.format }
            : {}),
          ...(responsesRequest.reasoning !== undefined
            ? { reasoning: responsesRequest.reasoning }
            : {}),
        });
        const cleanup = (): void => abortContext.cleanup();
        body.once('end', cleanup);
        body.once('close', cleanup);
        body.once('error', cleanup);

        reply.header('content-type', 'text/event-stream; charset=utf-8');
        reply.header('cache-control', 'no-cache, no-transform');
        reply.header('connection', 'keep-alive');
        reply.header('x-accel-buffering', 'no');
        const sent = reply.send(body);
        streaming = true;
        return sent;
      }

      if (result.stream) {
        result.body.destroy();
        throw new GatewayHttpError(
          502,
          'upstream_protocol_mismatch',
          'Upstream unexpectedly returned a stream for a non-streaming response',
        );
      }

      return chatCompletionToResponse(
        result.body,
        responsesRequest.model,
        responsesRequest.text?.format,
        responsesRequest.reasoning,
      );
    } finally {
      if (!streaming) abortContext.cleanup();
    }
  });

  app.post('/v1/chat/completions', async (request, reply) => {
    if (!provider && !routed) {
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
      const sessionId = singleHeader(request, 'x-tony-router-session');
      const routedResult = routed
        ? await routed.createChatCompletion(chatRequest, {
            requestId: request.id,
            signal: abortContext.signal,
            replaySafe: replaySafe(request),
            ...(sessionId ? { sessionId } : {}),
          })
        : undefined;
      const result = routedResult
        ? routedResult.result
        : await provider!.createChatCompletion(chatRequest, {
            requestId: request.id,
            signal: abortContext.signal,
          });

      if (routedResult) {
        reply.header('x-tony-router-route', routedResult.route.routeId);
        reply.header('x-tony-router-provider', routedResult.route.providerId);
        reply.header('x-tony-router-account', routedResult.route.accountId);
        reply.header('x-tony-router-attempts', routedResult.attempts);
      }

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
