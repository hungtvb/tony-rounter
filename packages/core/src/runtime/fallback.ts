import type { SessionAffinityStore } from '../routing/affinity.js';
import { selectRoute } from '../routing/engine.js';
import type {
  RouteRuntimeState,
  RoutingConfig,
  SelectedRoute,
} from '../routing/types.js';
import type {
  CircuitBreakerRegistry,
  CircuitKey,
  CircuitSnapshot,
} from './circuit-breaker.js';
import { classifyProviderFailure, type ProviderFailure } from './failure.js';

export interface FallbackPolicy {
  readonly maxAttemptsPerRoute: number;
  readonly maxTotalAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly totalDeadlineMs: number;
}

export interface RoutedOperationContext {
  readonly route: SelectedRoute;
  readonly routeAttempt: number;
  readonly totalAttempt: number;
  readonly signal: AbortSignal;
}

export type RoutedOperation<T> = (
  context: RoutedOperationContext,
) => Promise<T>;

export type ExecutionTraceEvent =
  | {
      readonly type: 'route_selected';
      readonly routeId: string;
      readonly accountId?: string;
      readonly affinityRetained: boolean;
    }
  | {
      readonly type: 'circuit_rejected';
      readonly routeId: string;
      readonly accountId?: string;
      readonly circuit: CircuitSnapshot;
    }
  | {
      readonly type: 'attempt_started';
      readonly routeId: string;
      readonly accountId?: string;
      readonly routeAttempt: number;
      readonly totalAttempt: number;
    }
  | {
      readonly type: 'attempt_failed';
      readonly routeId: string;
      readonly accountId?: string;
      readonly routeAttempt: number;
      readonly totalAttempt: number;
      readonly failure: ProviderFailure;
      readonly circuit: CircuitSnapshot;
    }
  | {
      readonly type: 'retry_scheduled';
      readonly routeId: string;
      readonly accountId?: string;
      readonly delayMs: number;
      readonly nextRouteAttempt: number;
    }
  | {
      readonly type: 'fallback_scheduled';
      readonly failedRouteId: string;
      readonly accountId?: string;
      readonly failureCode: string;
    }
  | {
      readonly type: 'attempt_succeeded';
      readonly routeId: string;
      readonly accountId?: string;
      readonly routeAttempt: number;
      readonly totalAttempt: number;
      readonly circuit: CircuitSnapshot;
    };

export interface RoutedExecutionResult<T> {
  readonly value: T;
  readonly route: SelectedRoute;
  readonly attempts: number;
  readonly trace: readonly ExecutionTraceEvent[];
}

export type RoutedExecutionErrorCode =
  | 'request_aborted'
  | 'deadline_exceeded'
  | 'no_compatible_route'
  | 'attempt_limit_exceeded'
  | 'unsafe_replay_blocked'
  | 'output_already_visible'
  | 'provider_failure';

export class RoutedExecutionError extends Error {
  override readonly name = 'RoutedExecutionError';

  constructor(
    readonly code: RoutedExecutionErrorCode,
    message: string,
    readonly trace: readonly ExecutionTraceEvent[],
    readonly failure?: ProviderFailure,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
  }
}

export interface ExecuteRoutedRequestInput<T> {
  readonly config: RoutingConfig;
  readonly requiredCapabilities: Parameters<
    typeof selectRoute
  >[1]['requiredCapabilities'];
  readonly operation: RoutedOperation<T>;
  readonly policy: FallbackPolicy;
  readonly circuitBreaker: CircuitBreakerRegistry;
  readonly replaySafe: boolean;
  readonly profileId?: string;
  readonly routeStates?: Readonly<Record<string, RouteRuntimeState>>;
  readonly affinityRouteId?: string;
  readonly sessionId?: string;
  readonly affinityStore?: SessionAffinityStore;
  readonly accountIdForRoute?: (route: SelectedRoute) => string | undefined;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface ExecutionAbortScope {
  readonly signal: AbortSignal;
  readonly abortedByDeadline: () => boolean;
  readonly cleanup: () => void;
}

type CodedError = Error & { readonly code: string };

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function validatePolicy(policy: FallbackPolicy): FallbackPolicy {
  const validated = Object.freeze({
    maxAttemptsPerRoute: positiveInteger(
      policy.maxAttemptsPerRoute,
      'maxAttemptsPerRoute',
    ),
    maxTotalAttempts: positiveInteger(
      policy.maxTotalAttempts,
      'maxTotalAttempts',
    ),
    baseDelayMs: nonNegativeInteger(policy.baseDelayMs, 'baseDelayMs'),
    maxDelayMs: nonNegativeInteger(policy.maxDelayMs, 'maxDelayMs'),
    totalDeadlineMs: positiveInteger(policy.totalDeadlineMs, 'totalDeadlineMs'),
  });
  if (validated.baseDelayMs > validated.maxDelayMs) {
    throw new RangeError('baseDelayMs must not exceed maxDelayMs');
  }
  return validated;
}

function errorFromUnknown(value: unknown, message: string): Error {
  return value instanceof Error ? value : new Error(message, { cause: value });
}

function codedError(
  code: string,
  message: string,
  cause?: unknown,
): CodedError {
  return Object.assign(new Error(message, { cause }), { code });
}

function createExecutionAbortScope(
  parentSignal: AbortSignal | undefined,
  deadlineMs: number,
): ExecutionAbortScope {
  const controller = new AbortController();
  let deadline = false;

  const abortFromParent = (): void => {
    controller.abort(
      codedError(
        'request_aborted',
        'Routed execution was aborted',
        parentSignal?.reason,
      ),
    );
  };
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    deadline = true;
    controller.abort(
      codedError(
        'execution_deadline_exceeded',
        'Routed execution exceeded its total deadline',
      ),
    );
  }, deadlineMs);
  timer.unref();

  return {
    signal: controller.signal,
    abortedByDeadline: () => deadline,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function defaultSleep(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw errorFromUnknown(signal.reason, 'Retry backoff was aborted');
  }
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(errorFromUnknown(signal.reason, 'Retry backoff was aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    timer.unref();

    if (signal.aborted) abort();
  });
}

function runWithAbort<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      errorFromUnknown(signal.reason, 'Provider operation was aborted'),
    );
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', abort);
    const resolveOnce = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(errorFromUnknown(error, 'Provider operation failed'));
    };
    const abort = (): void => {
      rejectOnce(signal.reason);
    };

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      rejectOnce(error);
      return;
    }

    void result.then(resolveOnce, rejectOnce);
  });
}

function freezeTrace(
  trace: readonly ExecutionTraceEvent[],
): readonly ExecutionTraceEvent[] {
  return Object.freeze(trace.map((event) => Object.freeze({ ...event })));
}

function circuitKey(
  route: SelectedRoute,
  accountId: string | undefined,
): CircuitKey {
  return {
    routeId: route.routeId,
    ...(accountId !== undefined ? { accountId } : {}),
  };
}

function stateCopy(
  states: Readonly<Record<string, RouteRuntimeState>> | undefined,
): Record<string, RouteRuntimeState> {
  const output = Object.create(null) as Record<string, RouteRuntimeState>;
  for (const [routeId, state] of Object.entries(states ?? {})) {
    output[routeId] = { ...state };
  }
  return output;
}

function retryDelay(
  policy: FallbackPolicy,
  routeAttempt: number,
  retryAfterMs: number | undefined,
): number | undefined {
  const exponential = Math.min(
    policy.baseDelayMs * 2 ** Math.max(0, routeAttempt - 1),
    policy.maxDelayMs,
  );
  const requested = Math.max(exponential, retryAfterMs ?? 0);
  return requested <= policy.maxDelayMs ? requested : undefined;
}

function replayAllowed(failure: ProviderFailure, replaySafe: boolean): boolean {
  return !failure.requestMayHaveBeenProcessed || replaySafe;
}

function executionError(
  code: RoutedExecutionErrorCode,
  message: string,
  trace: readonly ExecutionTraceEvent[],
  failure?: ProviderFailure,
  cause?: unknown,
): RoutedExecutionError {
  return new RoutedExecutionError(code, message, freezeTrace(trace), failure, {
    ...(cause !== undefined ? { cause } : {}),
  });
}

export async function executeRoutedRequest<T>(
  input: ExecuteRoutedRequestInput<T>,
): Promise<RoutedExecutionResult<T>> {
  const policy = validatePolicy(input.policy);
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const startedAt = now();
  const abortScope = createExecutionAbortScope(
    input.signal,
    policy.totalDeadlineMs,
  );
  const routeStates = stateCopy(input.routeStates);
  const trace: ExecutionTraceEvent[] = [];
  let totalAttempts = 0;
  let lastFailure: ProviderFailure | undefined;
  let lastCause: unknown;
  const storedAffinity =
    input.affinityRouteId ??
    (input.sessionId ? input.affinityStore?.get(input.sessionId) : undefined);

  const assertActive = (): void => {
    if (
      !abortScope.signal.aborted &&
      now() - startedAt < policy.totalDeadlineMs
    ) {
      return;
    }
    throw executionError(
      abortScope.abortedByDeadline() ||
        now() - startedAt >= policy.totalDeadlineMs
        ? 'deadline_exceeded'
        : 'request_aborted',
      abortScope.abortedByDeadline()
        ? 'Routed execution exceeded its total deadline'
        : 'Routed execution was aborted',
      trace,
      lastFailure,
      lastCause,
    );
  };

  try {
    while (totalAttempts < policy.maxTotalAttempts) {
      assertActive();
      const decision = selectRoute(input.config, {
        requiredCapabilities: input.requiredCapabilities,
        routeStates,
        ...(input.profileId !== undefined
          ? { profileId: input.profileId }
          : {}),
        ...(storedAffinity !== undefined
          ? { affinityRouteId: storedAffinity }
          : {}),
      });
      const route = decision.selected;
      if (!route) {
        throw executionError(
          'no_compatible_route',
          'No compatible route remains available',
          trace,
          lastFailure,
          lastCause,
        );
      }

      const accountId = input.accountIdForRoute?.(route);
      trace.push({
        type: 'route_selected',
        routeId: route.routeId,
        ...(accountId !== undefined ? { accountId } : {}),
        affinityRetained: route.affinityRetained,
      });

      let routeAttempt = 0;
      let fallbackRequired = false;

      while (
        routeAttempt < policy.maxAttemptsPerRoute &&
        totalAttempts < policy.maxTotalAttempts
      ) {
        assertActive();
        const key = circuitKey(route, accountId);
        const acquisition = input.circuitBreaker.acquire(key, now());
        if (!acquisition.allowed) {
          trace.push({
            type: 'circuit_rejected',
            routeId: route.routeId,
            ...(accountId !== undefined ? { accountId } : {}),
            circuit: acquisition.snapshot,
          });
          routeStates[route.routeId] = {
            ...routeStates[route.routeId],
            available: false,
          };
          fallbackRequired = true;
          break;
        }

        routeAttempt += 1;
        totalAttempts += 1;
        trace.push({
          type: 'attempt_started',
          routeId: route.routeId,
          ...(accountId !== undefined ? { accountId } : {}),
          routeAttempt,
          totalAttempt: totalAttempts,
        });

        let value: T;
        try {
          value = await runWithAbort(
            () =>
              input.operation({
                route,
                routeAttempt,
                totalAttempt: totalAttempts,
                signal: abortScope.signal,
              }),
            abortScope.signal,
          );
        } catch (error) {
          const failure = classifyProviderFailure(error);
          lastFailure = failure;
          lastCause = error;
          const circuit = input.circuitBreaker.recordFailure(
            acquisition.permit,
            failure.circuitImpact,
            now(),
          );
          trace.push({
            type: 'attempt_failed',
            routeId: route.routeId,
            ...(accountId !== undefined ? { accountId } : {}),
            routeAttempt,
            totalAttempt: totalAttempts,
            failure,
            circuit,
          });

          if (abortScope.signal.aborted) assertActive();

          if (failure.outputVisible) {
            throw executionError(
              'output_already_visible',
              'Provider failed after output became visible; replay is forbidden',
              trace,
              failure,
              error,
            );
          }

          const canReplay = replayAllowed(failure, input.replaySafe);
          if (!canReplay) {
            throw executionError(
              'unsafe_replay_blocked',
              'Provider may have processed the request and replay was not authorized',
              trace,
              failure,
              error,
            );
          }

          const delayMs = retryDelay(
            policy,
            routeAttempt,
            failure.retryAfterMs,
          );
          const hasRouteAttempt = routeAttempt < policy.maxAttemptsPerRoute;
          const hasTotalAttempt = totalAttempts < policy.maxTotalAttempts;
          const fitsDeadline =
            delayMs !== undefined &&
            now() - startedAt + delayMs < policy.totalDeadlineMs;

          if (
            circuit.state !== 'open' &&
            failure.retryable &&
            hasRouteAttempt &&
            hasTotalAttempt &&
            fitsDeadline
          ) {
            trace.push({
              type: 'retry_scheduled',
              routeId: route.routeId,
              ...(accountId !== undefined ? { accountId } : {}),
              delayMs,
              nextRouteAttempt: routeAttempt + 1,
            });
            try {
              await sleep(delayMs, abortScope.signal);
            } catch (sleepError) {
              lastCause = sleepError;
              assertActive();
              throw executionError(
                'provider_failure',
                'Retry backoff failed',
                trace,
                lastFailure,
                sleepError,
              );
            }
            continue;
          }

          if (failure.fallbackable && hasTotalAttempt) {
            routeStates[route.routeId] = {
              ...routeStates[route.routeId],
              available: false,
            };
            trace.push({
              type: 'fallback_scheduled',
              failedRouteId: route.routeId,
              ...(accountId !== undefined ? { accountId } : {}),
              failureCode: failure.code,
            });
            fallbackRequired = true;
            break;
          }

          throw executionError(
            totalAttempts >= policy.maxTotalAttempts
              ? 'attempt_limit_exceeded'
              : 'provider_failure',
            totalAttempts >= policy.maxTotalAttempts
              ? 'Routed execution exhausted its total attempt limit'
              : 'Provider failure is not retryable or fallbackable',
            trace,
            failure,
            error,
          );
        }

        assertActive();
        const circuit = input.circuitBreaker.recordSuccess(acquisition.permit);
        trace.push({
          type: 'attempt_succeeded',
          routeId: route.routeId,
          ...(accountId !== undefined ? { accountId } : {}),
          routeAttempt,
          totalAttempt: totalAttempts,
          circuit,
        });
        if (input.sessionId) {
          input.affinityStore?.remember(input.sessionId, route.routeId);
        }
        return Object.freeze({
          value,
          route,
          attempts: totalAttempts,
          trace: freezeTrace(trace),
        });
      }

      if (!fallbackRequired) {
        throw executionError(
          'attempt_limit_exceeded',
          'Routed execution exhausted the route attempt limit',
          trace,
          lastFailure,
          lastCause,
        );
      }
    }

    throw executionError(
      'attempt_limit_exceeded',
      'Routed execution exhausted its total attempt limit',
      trace,
      lastFailure,
      lastCause,
    );
  } finally {
    abortScope.cleanup();
  }
}
