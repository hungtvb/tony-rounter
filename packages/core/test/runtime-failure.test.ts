import { describe, expect, it } from 'vitest';

import {
  classifyProviderFailure,
  ProviderExecutionError,
  providerExecutionError,
} from '../src/index.js';

function codedError(
  code: string,
  options: {
    readonly outputVisible?: boolean;
    readonly retryAfterMs?: number;
  } = {},
): Error & {
  code: string;
  outputVisible?: boolean;
  retryAfterMs?: number;
} {
  return Object.assign(new Error(code), { code, ...options });
}

describe('classifyProviderFailure', () => {
  it('classifies authentication and configuration as immediate-open fallback failures', () => {
    expect(
      classifyProviderFailure(codedError('upstream_authentication_failed')),
    ).toMatchObject({
      kind: 'authentication',
      retryable: false,
      fallbackable: true,
      circuitImpact: 'open_immediately',
      requestMayHaveBeenProcessed: false,
    });

    expect(
      classifyProviderFailure(codedError('provider_not_configured')),
    ).toMatchObject({
      kind: 'configuration',
      circuitImpact: 'open_immediately',
      requestMayHaveBeenProcessed: false,
    });
  });

  it('classifies timeout, connection, and 5xx as replay-sensitive transient failures', () => {
    for (const code of [
      'upstream_timeout',
      'upstream_connection_error',
      'upstream_unavailable',
    ]) {
      expect(classifyProviderFailure(codedError(code))).toMatchObject({
        retryable: true,
        fallbackable: true,
        circuitImpact: 'count',
        requestMayHaveBeenProcessed: true,
        outputVisible: false,
      });
    }
  });

  it('preserves valid rate-limit delay metadata and rejects malformed values', () => {
    expect(
      classifyProviderFailure(
        codedError('upstream_rate_limited', { retryAfterMs: 750 }),
      ),
    ).toMatchObject({
      kind: 'rate_limit',
      retryAfterMs: 750,
      requestMayHaveBeenProcessed: false,
    });

    expect(
      classifyProviderFailure(
        codedError('upstream_rate_limited', { retryAfterMs: -1 }),
      ).retryAfterMs,
    ).toBeUndefined();
  });

  it('marks partial streaming failures as output-visible', () => {
    expect(
      classifyProviderFailure(
        codedError('upstream_truncated_stream', { outputVisible: true }),
      ),
    ).toMatchObject({
      kind: 'invalid_stream',
      fallbackable: true,
      requestMayHaveBeenProcessed: true,
      outputVisible: true,
    });
  });

  it('does not retry client aborts, rejected requests, or unknown errors', () => {
    for (const error of [
      codedError('client_closed_request'),
      codedError('upstream_invalid_request'),
      new Error('unknown'),
    ]) {
      expect(classifyProviderFailure(error)).toMatchObject({
        retryable: false,
        fallbackable: false,
        circuitImpact: 'none',
      });
    }
  });

  it('preserves an explicitly constructed immutable provider failure', () => {
    const explicit = new ProviderExecutionError({
      kind: 'timeout',
      code: 'custom_timeout',
      message: 'Timed out',
      retryable: true,
      fallbackable: true,
      circuitImpact: 'count',
      requestMayHaveBeenProcessed: false,
      outputVisible: false,
      retryAfterMs: 25,
    });

    const classified = classifyProviderFailure(explicit);
    expect(classified).toEqual(explicit.failure);
    expect(Object.isFrozen(classified)).toBe(true);

    const wrapped = providerExecutionError(classified, new Error('cause'));
    expect(wrapped).toBeInstanceOf(ProviderExecutionError);
    expect(wrapped.cause).toBeInstanceOf(Error);
  });
});
