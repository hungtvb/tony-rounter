import {
  CircuitBreakerRegistry,
  deriveChatRequestCapabilities,
  executeRoutedRequest,
  InMemorySessionAffinityStore,
  RoutedExecutionError,
  RoutingSelectionError,
  type ExecutionTraceEvent,
  type ProviderFailure,
  type SelectedRoute,
} from '@tony-router/core';

import { GatewayHttpError } from '../errors.js';
import type { JsonLogger } from '../logger.js';
import {
  OpenAICompatibleClient,
  type ChatCompletionResult,
  type OpenAICompatibleProvider,
  type ProviderRequestContext,
} from '../openai/client.js';
import type {
  CanonicalModelList,
  ChatCompletionRequest,
} from '../openai/protocol.js';
import type { GatewayRouterConfig, RoutedAccountConfig } from './config.js';

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEALTH_PROBE_TIMEOUT_MS = 10_000;

function compareIdentifier(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface RoutedChatRequestContext extends ProviderRequestContext {
  readonly replaySafe: boolean;
  readonly sessionId?: string;
}

export interface RoutedChatCompletionResult {
  readonly result: ChatCompletionResult;
  readonly route: SelectedRoute;
  readonly attempts: number;
  readonly trace: readonly ExecutionTraceEvent[];
}

export type AccountHealthStatus =
  | 'healthy'
  | 'authentication_failed'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'invalid_response';

export interface AccountHealthProbeResult {
  readonly accountId: string;
  readonly providerId: string;
  readonly status: AccountHealthStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly httpStatusClass?: '4xx' | '5xx';
}

export interface RoutedOpenAIProviderOptions {
  readonly config: GatewayRouterConfig;
  readonly logger: JsonLogger;
  readonly accounts?: Readonly<Record<string, OpenAICompatibleProvider>>;
  /** @deprecated Use accounts. Preserved for version 1 integrations. */
  readonly providers?: Readonly<Record<string, OpenAICompatibleProvider>>;
  readonly healthProbeTimeoutMs?: number;
}

function outputReserve(request: ChatCompletionRequest): number | undefined {
  const candidate = request.max_completion_tokens ?? request.max_tokens;
  return typeof candidate === 'number' &&
    Number.isSafeInteger(candidate) &&
    candidate >= 0
    ? candidate
    : undefined;
}

function enrichedProviderError(error: unknown): unknown {
  if (!(error instanceof GatewayHttpError)) return error;
  const retryAfter = error.headers?.['retry-after'];
  if (!retryAfter || !/^\d{1,9}$/.test(retryAfter)) return error;
  return Object.assign(error, { retryAfterMs: Number(retryAfter) * 1_000 });
}

function statusForFailure(failure: ProviderFailure | undefined): number {
  switch (failure?.kind) {
    case 'rate_limit':
      return 429;
    case 'timeout':
      return 504;
    case 'request_rejected':
      return 400;
    case 'configuration':
      return 503;
    case 'client_abort':
      return 499;
    default:
      return 502;
  }
}

function gatewayError(error: unknown): GatewayHttpError {
  if (error instanceof RoutingSelectionError) {
    return new GatewayHttpError(400, 'unknown_routing_profile', error.message);
  }
  if (!(error instanceof RoutedExecutionError)) {
    return error instanceof GatewayHttpError
      ? error
      : new GatewayHttpError(
          500,
          'routing_internal_error',
          'The routed provider failed unexpectedly',
        );
  }

  switch (error.code) {
    case 'request_aborted':
      return new GatewayHttpError(
        499,
        'client_closed_request',
        'Client disconnected before routed execution completed',
      );
    case 'deadline_exceeded':
      return new GatewayHttpError(
        504,
        'routing_deadline_exceeded',
        'Routed execution exceeded its total deadline',
      );
    case 'no_compatible_route':
      return new GatewayHttpError(
        400,
        'no_compatible_route',
        'No configured route satisfies the request capabilities',
      );
    case 'unsafe_replay_blocked':
      return new GatewayHttpError(
        502,
        'unsafe_replay_blocked',
        'The failed request may have been processed; fallback requires x-tony-router-replay-safe: true',
      );
    case 'output_already_visible':
      return new GatewayHttpError(
        502,
        'output_already_visible',
        'Provider failed after output became visible and was not replayed',
      );
    case 'attempt_limit_exceeded':
      return new GatewayHttpError(
        statusForFailure(error.failure),
        'routing_attempt_limit_exceeded',
        'Routed execution exhausted its bounded attempts',
      );
    case 'provider_failure':
      return new GatewayHttpError(
        statusForFailure(error.failure),
        error.failure?.code ?? 'provider_failure',
        error.failure?.message ?? 'The selected provider failed',
      );
  }
}

function healthStatus(error: unknown): {
  readonly status: Exclude<AccountHealthStatus, 'healthy'>;
  readonly httpStatusClass?: '4xx' | '5xx';
} {
  if (!(error instanceof GatewayHttpError)) {
    return { status: 'unavailable' };
  }
  switch (error.code) {
    case 'upstream_authentication_failed':
      return { status: 'authentication_failed', httpStatusClass: '4xx' };
    case 'upstream_rate_limited':
      return { status: 'rate_limited', httpStatusClass: '4xx' };
    case 'upstream_timeout':
      return { status: 'timeout' };
    case 'upstream_invalid_request':
      return { status: 'invalid_response', httpStatusClass: '4xx' };
    case 'upstream_unavailable':
      return { status: 'unavailable', httpStatusClass: '5xx' };
    case 'upstream_invalid_response':
    case 'upstream_response_too_large':
      return { status: 'invalid_response' };
    default:
      return { status: 'unavailable' };
  }
}

function validateAccountMap(
  config: GatewayRouterConfig,
  accounts: Readonly<Record<string, OpenAICompatibleProvider>>,
): void {
  for (const accountId of Object.keys(config.registry.accounts)) {
    if (!accounts[accountId]) {
      throw new GatewayHttpError(
        503,
        'account_not_configured',
        `Routing account ${accountId} has no runtime client`,
      );
    }
  }
}

function accountConfigs(
  config: GatewayRouterConfig,
): Readonly<Record<string, RoutedAccountConfig>> {
  if (config.accounts) return config.accounts;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(config.providers).map(([providerId, provider]) => [
        providerId,
        Object.freeze({ providerId, ...provider }),
      ]),
    ),
  );
}

export class RoutedOpenAIProvider {
  readonly #config: GatewayRouterConfig;
  readonly #accounts: Readonly<Record<string, OpenAICompatibleProvider>>;
  readonly #circuits: CircuitBreakerRegistry;
  readonly #healthProbeTimeoutMs: number;
  readonly #affinity = new InMemorySessionAffinityStore(10_000);

  constructor(options: RoutedOpenAIProviderOptions) {
    this.#config = options.config;
    if (options.accounts && options.providers) {
      throw new GatewayHttpError(
        500,
        'conflicting_account_configuration',
        'Routed account clients cannot be supplied through both accounts and providers',
      );
    }
    this.#accounts =
      options.accounts ??
      options.providers ??
      Object.freeze(
        Object.fromEntries(
          Object.entries(accountConfigs(options.config)).map(
            ([accountId, account]) => [
              accountId,
              new OpenAICompatibleClient(account, options.logger),
            ],
          ),
        ),
      );
    validateAccountMap(options.config, this.#accounts);
    const healthProbeTimeoutMs =
      options.healthProbeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(healthProbeTimeoutMs) ||
      healthProbeTimeoutMs < 10 ||
      healthProbeTimeoutMs > HEALTH_PROBE_TIMEOUT_MS
    ) {
      throw new GatewayHttpError(
        500,
        'invalid_health_probe_timeout',
        'Health probe timeout must be between 10 and 10000 milliseconds',
      );
    }
    this.#healthProbeTimeoutMs = healthProbeTimeoutMs;
    this.#circuits = new CircuitBreakerRegistry(options.config.circuitBreaker);
  }

  listModels(): CanonicalModelList {
    return Object.freeze({
      object: 'list',
      data: Object.values(this.#config.registry.profiles)
        .sort((left, right) => compareIdentifier(left.id, right.id))
        .map((profile) =>
          Object.freeze({
            id: profile.id,
            object: 'model' as const,
            created: 0,
            owned_by: 'tony-router',
          }),
        ),
    });
  }

  async probeAccount(
    accountId: string,
    context: ProviderRequestContext,
  ): Promise<AccountHealthProbeResult> {
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      throw new GatewayHttpError(
        400,
        'invalid_account_id',
        'Account ID is invalid',
      );
    }
    const account = this.#config.registry.accounts[accountId];
    const provider = this.#accounts[accountId];
    if (!account || !provider) {
      throw new GatewayHttpError(
        404,
        'account_not_found',
        'The requested routing account does not exist',
      );
    }

    const controller = new AbortController();
    let probeTimedOut = false;
    let rejectCancellation: (error: GatewayHttpError) => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const abortFromCaller = (): void => {
      controller.abort(context.signal.reason);
      rejectCancellation(
        new GatewayHttpError(
          499,
          'client_closed_request',
          'Client disconnected before the account probe completed',
        ),
      );
    };
    const timeout = setTimeout(() => {
      probeTimedOut = true;
      controller.abort(new Error('health probe timeout'));
      rejectCancellation(
        new GatewayHttpError(
          504,
          'upstream_timeout',
          'Account health probe exceeded its timeout',
        ),
      );
    }, this.#healthProbeTimeoutMs);
    timeout.unref();
    if (context.signal.aborted) abortFromCaller();
    else
      context.signal.addEventListener('abort', abortFromCaller, { once: true });
    const startedAt = Date.now();

    try {
      await Promise.race([
        provider.listModels({
          requestId: context.requestId,
          signal: controller.signal,
        }),
        cancellation,
      ]);
      return Object.freeze({
        accountId,
        providerId: account.providerId,
        status: 'healthy',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (context.signal.aborted && !probeTimedOut) {
        throw new GatewayHttpError(
          499,
          'client_closed_request',
          'Client disconnected before the account probe completed',
        );
      }
      const classified = probeTimedOut
        ? { status: 'timeout' as const }
        : healthStatus(error);
      return Object.freeze({
        accountId,
        providerId: account.providerId,
        ...classified,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener('abort', abortFromCaller);
    }
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
    context: RoutedChatRequestContext,
  ): Promise<RoutedChatCompletionResult> {
    if (!this.#config.registry.profiles[request.model]) {
      throw new GatewayHttpError(
        400,
        'unknown_routing_profile',
        `Unknown routing profile: ${request.model}`,
      );
    }
    if (context.sessionId && !SESSION_ID_PATTERN.test(context.sessionId)) {
      throw new GatewayHttpError(
        400,
        'invalid_router_session',
        'x-tony-router-session must contain 1 to 200 URL-safe characters',
      );
    }

    try {
      const reservedOutputTokens = outputReserve(request);
      const execution = await executeRoutedRequest({
        config: this.#config.registry,
        profileId: request.model,
        requiredCapabilities: deriveChatRequestCapabilities(request, {
          ...(reservedOutputTokens !== undefined
            ? { reservedOutputTokens }
            : {}),
        }),
        operation: async ({ route, signal }) => {
          const provider = this.#accounts[route.accountId];
          if (!provider) {
            throw new GatewayHttpError(
              503,
              'account_not_configured',
              `Routing account ${route.accountId} has no runtime client`,
            );
          }

          try {
            return await provider.createChatCompletion(
              Object.freeze({ ...request, model: route.upstreamModel }),
              {
                requestId: context.requestId,
                signal,
                publicModel: request.model,
              },
            );
          } catch (error) {
            throw enrichedProviderError(error);
          }
        },
        policy: this.#config.fallbackPolicy,
        circuitBreaker: this.#circuits,
        replaySafe: context.replaySafe,
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        affinityStore: this.#affinity,
        accountIdForRoute: (route) => route.accountId,
        signal: context.signal,
      });

      return Object.freeze({
        result: execution.value,
        route: execution.route,
        attempts: execution.attempts,
        trace: execution.trace,
      });
    } catch (error) {
      throw gatewayError(error);
    }
  }
}
