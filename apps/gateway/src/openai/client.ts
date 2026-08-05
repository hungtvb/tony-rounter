import { Readable } from 'node:stream';

import type { OpenAIUpstreamConfig } from '../config.js';
import { GatewayHttpError } from '../errors.js';
import type { JsonLogger } from '../logger.js';
import {
  normalizeDeletedFile,
  normalizeFileList,
  normalizeFileObject,
  normalizeRetrievedFile,
  upstreamFileContentType,
  type CanonicalDeletedFile,
  type CanonicalFileList,
  type CanonicalFileObject,
  type ProviderFileContent,
  type ProviderFileListQuery,
  type ProviderFileUpload,
} from './files.js';
import {
  type CanonicalModelList,
  type ChatCompletionRequest,
  normalizeChatCompletionResponse,
  normalizeModelList,
  upstreamErrorMessage,
} from './protocol.js';
import {
  canonicalizeChatSseData,
  canonicalStreamError,
  type CanonicalSseEvent,
  OpenAISseDecoder,
} from './sse.js';

const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_FILE_CONTENT_BYTES = 16 * 1024 * 1024;

export interface ProviderRequestContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly publicModel?: string;
}

export type ChatCompletionResult =
  | {
      readonly stream: false;
      readonly body: Readonly<Record<string, unknown>>;
    }
  | {
      readonly stream: true;
      readonly body: Readable;
    };

export interface OpenAICompatibleProvider {
  listModels(context: ProviderRequestContext): Promise<CanonicalModelList>;
  createFile?(
    upload: ProviderFileUpload,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileObject>;
  listFiles?(
    query: ProviderFileListQuery,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileList>;
  retrieveFile?(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileObject>;
  retrieveFileContent?(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<ProviderFileContent>;
  deleteFile?(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<CanonicalDeletedFile>;
  createChatCompletion(
    request: ChatCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<ChatCompletionResult>;
}

interface AbortScope {
  readonly signal: AbortSignal;
  readonly parentSignal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly resetTimeout: () => void;
  readonly abort: () => void;
  readonly cleanup: () => void;
}

function byteChunk(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream emitted a non-byte response chunk',
    );
  }
  return value;
}

function redactSensitiveMessage(
  message: string | undefined,
  sensitiveValue: string | undefined,
): string | undefined {
  if (!message || !sensitiveValue) return message;
  return message.split(sensitiveValue).join('[REDACTED]');
}

function createAbortScope(
  parentSignal: AbortSignal,
  timeoutMs: number,
): AbortScope {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  let didTimeOut = false;

  const abortFromParent = (): void => {
    controller.abort(parentSignal.reason);
  };
  const resetTimeout = (): void => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      didTimeOut = true;
      controller.abort(new Error('upstream timeout'));
    }, timeoutMs);
    timeout.unref();
  };
  const cleanup = (): void => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    parentSignal.removeEventListener('abort', abortFromParent);
  };

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  resetTimeout();

  return {
    signal: controller.signal,
    parentSignal,
    timedOut: () => didTimeOut,
    resetTimeout,
    abort: () => controller.abort(new Error('upstream request cancelled')),
    cleanup,
  };
}

function endpoint(
  baseUrl: string,
  resource:
    | 'models'
    | 'files'
    | `files/${string}`
    | `files/${string}/content`
    | 'chat/completions',
): string {
  const url = new URL(`${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = basePath.endsWith('/v1')
    ? `${basePath}/${resource}`
    : `${basePath}/v1/${resource}`;
  return url.toString();
}

function safeUpstreamRequestId(response: Response): string | undefined {
  const candidate =
    response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    undefined;
  return candidate && /^[A-Za-z0-9._:-]{1,200}$/.test(candidate)
    ? candidate
    : undefined;
}

function mappedTransportError(
  error: unknown,
  scope: AbortScope,
): GatewayHttpError {
  if (error instanceof GatewayHttpError) return error;
  if (scope.timedOut()) {
    return new GatewayHttpError(
      504,
      'upstream_timeout',
      'Upstream request exceeded its timeout',
    );
  }
  if (scope.parentSignal.aborted) {
    return new GatewayHttpError(
      499,
      'client_closed_request',
      'Client disconnected before the upstream request completed',
    );
  }
  return new GatewayHttpError(
    502,
    'upstream_connection_error',
    'Unable to communicate with the configured upstream',
  );
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  scope: AbortScope,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new GatewayHttpError(
      502,
      'upstream_response_too_large',
      'Upstream response exceeds the configured safety limit',
    );
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let output = '';

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      scope.resetTimeout();
      const value = byteChunk(chunk.value);
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        throw new GatewayHttpError(
          502,
          'upstream_response_too_large',
          'Upstream response exceeds the configured safety limit',
        );
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new GatewayHttpError(
        502,
        'upstream_invalid_response',
        'Upstream response contains invalid UTF-8',
      );
    }
    throw mappedTransportError(error, scope);
  } finally {
    reader.releaseLock();
  }
}

function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayHttpError(502, 'upstream_invalid_response', message);
  }
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
  scope: AbortScope,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new GatewayHttpError(
      502,
      'upstream_response_too_large',
      'Upstream file content exceeds the configured safety limit',
    );
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      scope.resetTimeout();
      const value = byteChunk(chunk.value);
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        throw new GatewayHttpError(
          502,
          'upstream_response_too_large',
          'Upstream file content exceeds the configured safety limit',
        );
      }
      chunks.push(value);
    }
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch (error) {
    throw mappedTransportError(error, scope);
  } finally {
    reader.releaseLock();
  }
}

async function upstreamFailure(
  response: Response,
  scope: AbortScope,
  apiKey?: string,
): Promise<GatewayHttpError> {
  let parsed: unknown;
  try {
    const text = await readBoundedText(
      response,
      MAX_ERROR_RESPONSE_BYTES,
      scope,
    );
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch (error) {
    if (error instanceof GatewayHttpError) throw error;
  }

  const upstreamMessage = redactSensitiveMessage(
    upstreamErrorMessage(parsed),
    apiKey,
  );
  const upstreamRequestId = safeUpstreamRequestId(response);
  const headers = {
    ...(upstreamRequestId
      ? { 'x-upstream-request-id': upstreamRequestId }
      : {}),
  };

  if (response.status === 401 || response.status === 403) {
    return new GatewayHttpError(
      502,
      'upstream_authentication_failed',
      'Configured upstream credentials were rejected',
      headers,
    );
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    return new GatewayHttpError(
      429,
      'upstream_rate_limited',
      upstreamMessage ?? 'Configured upstream is rate limited',
      {
        ...headers,
        ...(retryAfter && /^\d{1,9}$/.test(retryAfter)
          ? { 'retry-after': retryAfter }
          : {}),
      },
    );
  }
  if (response.status >= 500) {
    return new GatewayHttpError(
      502,
      'upstream_unavailable',
      'Configured upstream is temporarily unavailable',
      headers,
    );
  }
  if (response.status >= 400 && response.status < 500) {
    return new GatewayHttpError(
      response.status,
      'upstream_invalid_request',
      upstreamMessage ?? 'Configured upstream rejected the request',
      headers,
    );
  }

  return new GatewayHttpError(
    502,
    'upstream_invalid_response',
    'Configured upstream returned an unexpected status',
    headers,
  );
}

function canonicalEvents(
  dataEvents: readonly string[],
  state: { done: boolean },
  requestedModel: string,
): readonly CanonicalSseEvent[] {
  const output: CanonicalSseEvent[] = [];
  for (const data of dataEvents) {
    if (state.done) {
      throw new GatewayHttpError(
        502,
        'upstream_invalid_stream',
        'Upstream emitted data after the terminal event',
      );
    }
    const event = canonicalizeChatSseData(data, requestedModel);
    state.done = event.done;
    output.push(event);
  }
  return output;
}

async function prepareStreamingBody(
  response: Response,
  context: ProviderRequestContext,
  scope: AbortScope,
  responseModel: string,
): Promise<Readable> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    scope.cleanup();
    throw new GatewayHttpError(
      502,
      'upstream_invalid_stream',
      'Upstream streaming response is not server-sent events',
    );
  }
  if (!response.body) {
    scope.cleanup();
    throw new GatewayHttpError(
      502,
      'upstream_invalid_stream',
      'Upstream streaming response has no body',
    );
  }

  const reader = response.body.getReader();
  const decoder = new OpenAISseDecoder();
  const state = { done: false };
  let initialEvents: readonly CanonicalSseEvent[] = [];

  try {
    while (initialEvents.length === 0) {
      const chunk = await reader.read();
      if (chunk.done) {
        initialEvents = canonicalEvents(decoder.finish(), state, responseModel);
        if (initialEvents.length === 0 || !state.done) {
          throw new GatewayHttpError(
            502,
            'upstream_truncated_stream',
            'Upstream stream ended before a terminal event',
          );
        }
        break;
      }
      scope.resetTimeout();
      initialEvents = canonicalEvents(
        decoder.push(byteChunk(chunk.value)),
        state,
        responseModel,
      );
    }
  } catch (error) {
    scope.cleanup();
    reader.releaseLock();
    throw mappedTransportError(error, scope);
  }

  const generator = async function* (): AsyncGenerator<string> {
    let emitted = false;
    try {
      for (const event of initialEvents) {
        emitted = true;
        yield event.wire;
      }

      while (!state.done) {
        const chunk = await reader.read();
        if (chunk.done) {
          const finalEvents = canonicalEvents(
            decoder.finish(),
            state,
            responseModel,
          );
          for (const event of finalEvents) {
            emitted = true;
            yield event.wire;
          }
          if (!state.done) {
            throw new GatewayHttpError(
              502,
              'upstream_truncated_stream',
              'Upstream stream ended before a terminal event',
            );
          }
          break;
        }

        scope.resetTimeout();
        for (const event of canonicalEvents(
          decoder.push(byteChunk(chunk.value)),
          state,
          responseModel,
        )) {
          emitted = true;
          yield event.wire;
        }
      }
    } catch (error) {
      const mapped = mappedTransportError(error, scope);
      if (scope.parentSignal.aborted) return;
      if (!emitted) throw mapped;
      yield canonicalStreamError(
        context.requestId,
        mapped.code,
        mapped.publicMessage,
      );
      if (!state.done) yield 'data: [DONE]\n\n';
    } finally {
      scope.cleanup();
      if (!state.done) {
        scope.abort();
        await reader.cancel().catch(() => undefined);
      }
      reader.releaseLock();
    }
  };

  return Readable.from(generator(), { encoding: 'utf8' });
}

export class OpenAICompatibleClient implements OpenAICompatibleProvider {
  constructor(
    private readonly config: OpenAIUpstreamConfig,
    private readonly logger: JsonLogger,
  ) {}

  async listModels(
    context: ProviderRequestContext,
  ): Promise<CanonicalModelList> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'list_models',
    });

    try {
      const response = await fetch(endpoint(this.config.baseUrl, 'models'), {
        method: 'GET',
        headers: this.headers(),
        redirect: 'error',
        signal: scope.signal,
      });
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const models = normalizeModelList(
        parseJson(text, 'Upstream returned malformed model JSON'),
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'list_models',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return models;
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async listFiles(
    query: ProviderFileListQuery,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileList> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'list_files',
    });

    try {
      const url = new URL(endpoint(this.config.baseUrl, 'files'));
      url.searchParams.set('limit', String(query.limit));
      url.searchParams.set('order', query.order);
      url.searchParams.set('purpose', query.purpose);
      if (query.after) url.searchParams.set('after', query.after);
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        redirect: 'error',
        signal: scope.signal,
      });
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const files = normalizeFileList(
        parseJson(text, 'Upstream returned malformed file-list JSON'),
      );
      if (files.data.length > query.limit) {
        throw new GatewayHttpError(
          502,
          'upstream_invalid_response',
          'Upstream returned more files than the requested limit',
        );
      }
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'list_files',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return files;
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async retrieveFile(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileObject> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'retrieve_file',
    });

    try {
      const response = await fetch(
        endpoint(this.config.baseUrl, `files/${encodeURIComponent(fileId)}`),
        {
          method: 'GET',
          headers: this.headers(),
          redirect: 'error',
          signal: scope.signal,
        },
      );
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const file = normalizeRetrievedFile(
        parseJson(text, 'Upstream returned malformed file metadata JSON'),
        fileId,
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'retrieve_file',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return file;
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async retrieveFileContent(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<ProviderFileContent> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'retrieve_file_content',
    });

    try {
      const response = await fetch(
        endpoint(
          this.config.baseUrl,
          `files/${encodeURIComponent(fileId)}/content`,
        ),
        {
          method: 'GET',
          headers: { ...this.headers(), accept: '*/*' },
          redirect: 'error',
          signal: scope.signal,
        },
      );
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const contentType = upstreamFileContentType(
        response.headers.get('content-type'),
      );
      const bytes = await readBoundedBytes(
        response,
        MAX_FILE_CONTENT_BYTES,
        scope,
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'retrieve_file_content',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return Object.freeze({ bytes, contentType });
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async createFile(
    upload: ProviderFileUpload,
    context: ProviderRequestContext,
  ): Promise<CanonicalFileObject> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'create_file',
      bytes: upload.bytes.byteLength,
      purpose: upload.purpose,
    });

    try {
      const form = new FormData();
      form.append('purpose', upload.purpose);
      form.append(
        'file',
        new Blob([Buffer.from(upload.bytes)], { type: upload.contentType }),
        upload.filename,
      );
      const response = await fetch(endpoint(this.config.baseUrl, 'files'), {
        method: 'POST',
        headers: this.headers(),
        body: form,
        redirect: 'error',
        signal: scope.signal,
      });
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const file = normalizeFileObject(
        parseJson(text, 'Upstream returned malformed file JSON'),
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'create_file',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return file;
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async deleteFile(
    fileId: string,
    context: ProviderRequestContext,
  ): Promise<CanonicalDeletedFile> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'delete_file',
    });

    try {
      const response = await fetch(
        endpoint(this.config.baseUrl, `files/${encodeURIComponent(fileId)}`),
        {
          method: 'DELETE',
          headers: this.headers(),
          redirect: 'error',
          signal: scope.signal,
        },
      );
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }
      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const deleted = normalizeDeletedFile(
        parseJson(text, 'Upstream returned malformed file deletion JSON'),
        fileId,
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'delete_file',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return deleted;
    } catch (error) {
      throw mappedTransportError(error, scope);
    } finally {
      scope.cleanup();
    }
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
    context: ProviderRequestContext,
  ): Promise<ChatCompletionResult> {
    const scope = createAbortScope(context.signal, this.config.timeoutMs);
    const startedAt = Date.now();
    this.logger.info('upstream_request_started', {
      requestId: context.requestId,
      operation: 'chat_completions',
      stream: request.stream === true,
      model: request.model,
    });

    try {
      const responseModel = context.publicModel ?? request.model;
      const response = await fetch(
        endpoint(this.config.baseUrl, 'chat/completions'),
        {
          method: 'POST',
          headers: {
            ...this.headers(),
            'content-type': 'application/json',
          },
          body: JSON.stringify(request),
          redirect: 'error',
          signal: scope.signal,
        },
      );
      if (!response.ok) {
        throw await upstreamFailure(response, scope, this.config.apiKey);
      }

      if (request.stream === true) {
        const body = await prepareStreamingBody(
          response,
          context,
          scope,
          responseModel,
        );
        this.logger.info('upstream_stream_started', {
          requestId: context.requestId,
          operation: 'chat_completions',
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
        });
        return { stream: true, body };
      }

      const text = await readBoundedText(
        response,
        MAX_JSON_RESPONSE_BYTES,
        scope,
      );
      const body = normalizeChatCompletionResponse(
        parseJson(text, 'Upstream returned malformed chat completion JSON'),
        responseModel,
      );
      this.logger.info('upstream_request_completed', {
        requestId: context.requestId,
        operation: 'chat_completions',
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return { stream: false, body };
    } catch (error) {
      scope.cleanup();
      throw mappedTransportError(error, scope);
    } finally {
      if (request.stream !== true) scope.cleanup();
    }
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      accept: 'application/json, text/event-stream',
      ...(this.config.apiKey
        ? { authorization: `Bearer ${this.config.apiKey}` }
        : {}),
    };
  }
}
