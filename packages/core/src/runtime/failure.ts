export type ProviderFailureKind =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'timeout'
  | 'connection'
  | 'upstream_5xx'
  | 'invalid_response'
  | 'invalid_stream'
  | 'request_rejected'
  | 'client_abort'
  | 'unknown';

export type CircuitFailureImpact = 'none' | 'count' | 'open_immediately';

export interface ProviderFailure {
  readonly kind: ProviderFailureKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly fallbackable: boolean;
  readonly circuitImpact: CircuitFailureImpact;
  readonly requestMayHaveBeenProcessed: boolean;
  readonly outputVisible: boolean;
  readonly retryAfterMs?: number;
}

export interface ProviderExecutionErrorOptions {
  readonly cause?: unknown;
}

function boundedRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function snapshotFailure(failure: ProviderFailure): ProviderFailure {
  return Object.freeze({
    kind: failure.kind,
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    fallbackable: failure.fallbackable,
    circuitImpact: failure.circuitImpact,
    requestMayHaveBeenProcessed: failure.requestMayHaveBeenProcessed,
    outputVisible: failure.outputVisible,
    ...(failure.retryAfterMs !== undefined
      ? { retryAfterMs: failure.retryAfterMs }
      : {}),
  });
}

export class ProviderExecutionError extends Error {
  override readonly name = 'ProviderExecutionError';
  readonly failure: ProviderFailure;

  constructor(
    failure: ProviderFailure,
    options: ProviderExecutionErrorOptions = {},
  ) {
    super(failure.message, { cause: options.cause });
    this.failure = snapshotFailure(failure);
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function errorRecord(error: unknown): UnknownRecord {
  return typeof error === 'object' && error !== null
    ? (error as UnknownRecord)
    : {};
}

function errorCode(error: unknown): string | undefined {
  const value = errorRecord(error).code;
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 500);
  }
  return 'Provider execution failed';
}

function outputVisible(error: unknown): boolean {
  return errorRecord(error).outputVisible === true;
}

function retryAfterMs(error: unknown): number | undefined {
  return boundedRetryAfter(errorRecord(error).retryAfterMs);
}

function failure(
  kind: ProviderFailureKind,
  code: string,
  message: string,
  options: {
    readonly retryable: boolean;
    readonly fallbackable: boolean;
    readonly circuitImpact: CircuitFailureImpact;
    readonly requestMayHaveBeenProcessed: boolean;
    readonly outputVisible?: boolean;
    readonly retryAfterMs?: number;
  },
): ProviderFailure {
  return snapshotFailure({
    kind,
    code,
    message,
    retryable: options.retryable,
    fallbackable: options.fallbackable,
    circuitImpact: options.circuitImpact,
    requestMayHaveBeenProcessed: options.requestMayHaveBeenProcessed,
    outputVisible: options.outputVisible ?? false,
    ...(options.retryAfterMs !== undefined
      ? { retryAfterMs: options.retryAfterMs }
      : {}),
  });
}

export function classifyProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderExecutionError) return error.failure;

  const code = errorCode(error) ?? 'unknown_provider_failure';
  const message = errorMessage(error);
  const visible = outputVisible(error);
  const retryAfter = retryAfterMs(error);

  switch (code) {
    case 'provider_not_configured':
    case 'provider_configuration_error':
      return failure('configuration', code, message, {
        retryable: false,
        fallbackable: true,
        circuitImpact: 'open_immediately',
        requestMayHaveBeenProcessed: false,
        outputVisible: visible,
      });
    case 'upstream_authentication_failed':
      return failure('authentication', code, message, {
        retryable: false,
        fallbackable: true,
        circuitImpact: 'open_immediately',
        requestMayHaveBeenProcessed: false,
        outputVisible: visible,
      });
    case 'upstream_rate_limited':
      return failure('rate_limit', code, message, {
        retryable: true,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: false,
        outputVisible: visible,
        ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}),
      });
    case 'execution_deadline_exceeded':
    case 'upstream_timeout':
    case 'request_timeout':
      return failure('timeout', code, message, {
        retryable: true,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    case 'upstream_connection_error':
    case 'connection_reset':
      return failure('connection', code, message, {
        retryable: true,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    case 'upstream_unavailable':
      return failure('upstream_5xx', code, message, {
        retryable: true,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    case 'upstream_invalid_response':
      return failure('invalid_response', code, message, {
        retryable: false,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    case 'upstream_invalid_stream':
    case 'upstream_truncated_stream':
    case 'upstream_stream_error':
      return failure('invalid_stream', code, message, {
        retryable: false,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    case 'upstream_invalid_request':
    case 'invalid_request':
      return failure('request_rejected', code, message, {
        retryable: false,
        fallbackable: false,
        circuitImpact: 'none',
        requestMayHaveBeenProcessed: false,
        outputVisible: visible,
      });
    case 'client_closed_request':
    case 'request_aborted':
      return failure('client_abort', code, message, {
        retryable: false,
        fallbackable: false,
        circuitImpact: 'none',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
    default:
      return failure('unknown', code, message, {
        retryable: false,
        fallbackable: false,
        circuitImpact: 'none',
        requestMayHaveBeenProcessed: true,
        outputVisible: visible,
      });
  }
}

export function providerExecutionError(
  failureValue: ProviderFailure,
  cause?: unknown,
): ProviderExecutionError {
  return new ProviderExecutionError(failureValue, {
    ...(cause !== undefined ? { cause } : {}),
  });
}
