import { GatewayHttpError } from '../errors.js';

export interface ChatCompletionRequest extends Readonly<
  Record<string, unknown>
> {
  readonly model: string;
  readonly messages: readonly unknown[];
  readonly stream?: boolean;
}

export interface CanonicalModel {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: string;
}

export interface CanonicalModelList {
  readonly object: 'list';
  readonly data: readonly CanonicalModel[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizedUsage(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined;

  const promptTokens =
    nonNegativeInteger(value.prompt_tokens) ??
    nonNegativeInteger(value.input_tokens);
  const completionTokens =
    nonNegativeInteger(value.completion_tokens) ??
    nonNegativeInteger(value.output_tokens);
  const totalTokens =
    nonNegativeInteger(value.total_tokens) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...value,
    ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
    ...(completionTokens !== undefined
      ? { completion_tokens: completionTokens }
      : {}),
    ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
  };
}

export function parseChatCompletionRequest(
  value: unknown,
): ChatCompletionRequest {
  if (!isRecord(value)) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'Request body must be a JSON object',
    );
  }
  if (typeof value.model !== 'string' || value.model.trim().length === 0) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'model must be a non-empty string',
    );
  }
  if (!Array.isArray(value.messages)) {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'messages must be an array',
    );
  }
  if (value.stream !== undefined && typeof value.stream !== 'boolean') {
    throw new GatewayHttpError(
      400,
      'invalid_request',
      'stream must be a boolean when provided',
    );
  }

  return value as ChatCompletionRequest;
}

export function normalizeModelList(value: unknown): CanonicalModelList {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream returned an invalid model list',
    );
  }

  const data = value.data.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      throw new GatewayHttpError(
        502,
        'upstream_invalid_response',
        'Upstream returned an invalid model entry',
      );
    }

    return {
      id: entry.id,
      object: 'model' as const,
      created: nonNegativeInteger(entry.created) ?? 0,
      owned_by:
        typeof entry.owned_by === 'string' ? entry.owned_by : 'upstream',
    };
  });

  return { object: 'list', data };
}

export function normalizeChatCompletionResponse(
  value: unknown,
  requestedModel: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream returned an invalid chat completion response',
    );
  }
  if (!Array.isArray(value.choices) || !value.choices.every(isRecord)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream chat completion choices are invalid',
    );
  }

  const usage = normalizedUsage(value.usage);
  return {
    ...value,
    id: value.id,
    object: typeof value.object === 'string' ? value.object : 'chat.completion',
    model: typeof value.model === 'string' ? value.model : requestedModel,
    choices: value.choices,
    ...(usage ? { usage } : {}),
  };
}

export function normalizeChatCompletionChunk(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_stream',
      'Upstream emitted a non-object streaming event',
    );
  }
  if ('error' in value) {
    throw new GatewayHttpError(
      502,
      'upstream_stream_error',
      'Upstream emitted an error during streaming',
    );
  }
  if (!Array.isArray(value.choices) || !value.choices.every(isRecord)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_stream',
      'Upstream emitted an invalid chat completion chunk',
    );
  }

  return {
    ...value,
    object:
      typeof value.object === 'string' ? value.object : 'chat.completion.chunk',
    choices: value.choices,
  };
}

export function upstreamErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  const message = value.error.message;
  if (typeof message !== 'string') return undefined;
  const normalized = message.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized.slice(0, 500) : undefined;
}
