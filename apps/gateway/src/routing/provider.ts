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

export interface RoutedOpenAIProviderOptions {
  readonly config: GatewayRouterConfig;
  readonly logger: JsonLogger;
  readonly accounts?: Readonly<Record<string, OpenAICompatibleProvider>>;
  /** @deprecated Use accounts. Preserved for version 1 integrations. */
  readonly providers?: Readonly<Record<string, OpenAICompatibleProvider>>;
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
