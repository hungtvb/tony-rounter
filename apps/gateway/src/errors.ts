import type { FastifyReply } from 'fastify';

export interface GatewayErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly request_id: string;
  };
}

interface ErrorMetadata {
  readonly code?: string;
  readonly statusCode?: number;
}

function errorMetadata(error: unknown): ErrorMetadata {
  if (typeof error !== 'object' || error === null) return {};

  const candidate = error as Readonly<Record<string, unknown>>;
  return {
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    ...(typeof candidate.statusCode === 'number'
      ? { statusCode: candidate.statusCode }
      : {}),
  };
}

export function sendGatewayError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): FastifyReply {
  const payload: GatewayErrorPayload = {
    error: {
      code,
      message,
      request_id: requestId,
    },
  };

  return reply.code(statusCode).send(payload);
}

export function normalizeFastifyError(error: unknown): {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
} {
  const metadata = errorMetadata(error);

  if (
    metadata.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
    metadata.statusCode === 413
  ) {
    return {
      statusCode: 413,
      code: 'payload_too_large',
      message: 'Request body exceeds the configured limit',
    };
  }

  if (
    metadata.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    (error instanceof SyntaxError && metadata.statusCode === 400)
  ) {
    return {
      statusCode: 400,
      code: 'invalid_json',
      message: 'Request body contains invalid JSON',
    };
  }

  if (metadata.statusCode === 415) {
    return {
      statusCode: 415,
      code: 'unsupported_media_type',
      message: 'Unsupported media type',
    };
  }

  if (metadata.statusCode === 400) {
    return {
      statusCode: 400,
      code: 'bad_request',
      message: 'The request is invalid',
    };
  }

  return {
    statusCode: 500,
    code: 'internal_error',
    message: 'An unexpected gateway error occurred',
  };
}
