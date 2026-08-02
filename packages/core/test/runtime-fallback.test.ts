import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  CircuitBreakerRegistry,
  executeRoutedRequest,
  InMemorySessionAffinityStore,
  parseRoutingConfig,
  RoutedExecutionError,
  type FallbackPolicy,
} from '../src/index.js';

const CONFIG = parseRoutingConfig(`
version: 1
defaultProfile: default
providers:
  provider:
    kind: openai-compatible
models:
  full:
    provider: provider
    upstreamModel: full-model
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      contextTokens: 128000
routes:
  primary:
    model: full
    priority: 100
  backup:
    model: full
    priority: 50
profiles:
  default:
    routes:
      - route: primary
        priority: 100
      - route: backup
        priority: 50
`);

const INCOMPATIBLE_FALLBACK_CONFIG = parseRoutingConfig(`
version: 1
defaultProfile: default
providers:
  provider:
    kind: openai-compatible
models:
  vision:
    provider: provider
    upstreamModel: vision-model
    capabilities:
      tools: true
      parallelToolCalls: false
      vision: true
      structuredOutput: false
      contextTokens: 128000
  text:
    provider: provider
    upstreamModel: text-model
    capabilities:
      tools: true
      parallelToolCalls: false
      vision: false
      structuredOutput: false
      contextTokens: 128000
routes:
  primary:
    model: vision
    priority: 100
  backup:
    model: text
    priority: 50
profiles:
  default:
    routes:
      - route: primary
        priority: 100
      - route: backup
        priority: 50
`);

const REQUIREMENTS = {
  tools: false,
  parallelToolCalls: false,
  vision: false,
  structuredOutput: false,
} as const;

const POLICY: FallbackPolicy = {
  maxAttemptsPerRoute: 2,
  maxTotalAttempts: 4,
  baseDelayMs: 10,
  maxDelayMs: 100,
  totalDeadlineMs: 1_000,
};

function breaker(failureThreshold = 3): CircuitBreakerRegistry {
  return new CircuitBreakerRegistry({
    failureThreshold,
    cooldownMs: 1_000,
  });
}

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

function fakeClock(): {
  readonly now: () => number;
  readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly delays: number[];
} {
  let current = 0;
  const delays: number[] = [];
  return {
    now: () => current,
    delays,
    sleep: (delayMs, signal) => {
      if (signal.aborted) return Promise.reject(signal.reason);
      delays.push(delayMs);
      current += delayMs;
      return Promise.resolve();
    },
  };
}

async function expectExecutionError(
  promise: Promise<unknown>,
  code: RoutedExecutionError['code'],
): Promise<RoutedExecutionError> {
  try {
    await promise;
    throw new Error('Expected routed execution to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(RoutedExecutionError);
    const routed = error as RoutedExecutionError;
    expect(routed.code).toBe(code);
    return routed;
  }
}

describe('executeRoutedRequest', () => {
  it('returns the first successful route and an immutable trace', async () => {
    const result = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => `ok:${route.routeId}`,
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: false,
    });

    expect(result).toMatchObject({
      value: 'ok:primary',
      route: { routeId: 'primary' },
      attempts: 1,
    });
    expect(result.trace.map((event) => event.type)).toEqual([
      'route_selected',
      'attempt_started',
      'attempt_succeeded',
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace)).toBe(true);
  });

  it('falls back after authentication failure without retrying the bad route', async () => {
    const calls: string[] = [];
    const registry = breaker();
    const result = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => {
        calls.push(route.routeId);
        if (route.routeId === 'primary') {
          throw codedError('upstream_authentication_failed');
        }
        return 'backup-success';
      },
      policy: POLICY,
      circuitBreaker: registry,
      replaySafe: false,
    });

    expect(result.value).toBe('backup-success');
    expect(calls).toEqual(['primary', 'backup']);
    expect(
      result.trace.some((event) => event.type === 'retry_scheduled'),
    ).toBe(false);
    expect(
      result.trace.some((event) => event.type === 'fallback_scheduled'),
    ).toBe(true);
    expect(registry.snapshot({ routeId: 'primary' }, 0).state).toBe('open');
  });

  it('blocks timeout replay when the request is not declared replay-safe', async () => {
    const calls: string[] = [];
    const error = await expectExecutionError(
      executeRoutedRequest({
        config: CONFIG,
        requiredCapabilities: REQUIREMENTS,
        operation: async ({ route }) => {
          calls.push(route.routeId);
          throw codedError('upstream_timeout');
        },
        policy: POLICY,
        circuitBreaker: breaker(),
        replaySafe: false,
      }),
      'unsafe_replay_blocked',
    );

    expect(calls).toEqual(['primary']);
    expect(error.failure?.kind).toBe('timeout');
  });

  it('retries a replay-safe transient failure with bounded backoff', async () => {
    const clock = fakeClock();
    let attempts = 0;
    const result = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => {
        attempts += 1;
        if (attempts === 1) throw codedError('upstream_timeout');
        return route.routeId;
      },
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: true,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.value).toBe('primary');
    expect(result.attempts).toBe(2);
    expect(clock.delays).toEqual([10]);
    expect(
      result.trace.find((event) => event.type === 'retry_scheduled'),
    ).toMatchObject({ delayMs: 10, nextRouteAttempt: 2 });
  });

  it('uses a valid retry-after delay and falls back when it exceeds the cap', async () => {
    const firstClock = fakeClock();
    let firstAttempts = 0;
    const retried = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async () => {
        firstAttempts += 1;
        if (firstAttempts === 1) {
          throw codedError('upstream_rate_limited', { retryAfterMs: 30 });
        }
        return 'retried';
      },
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: false,
      now: firstClock.now,
      sleep: firstClock.sleep,
    });
    expect(retried.value).toBe('retried');
    expect(firstClock.delays).toEqual([30]);

    const calls: string[] = [];
    const secondClock = fakeClock();
    const fellBack = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => {
        calls.push(route.routeId);
        if (route.routeId === 'primary') {
          throw codedError('upstream_rate_limited', { retryAfterMs: 500 });
        }
        return 'backup';
      },
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: false,
      now: secondClock.now,
      sleep: secondClock.sleep,
    });
    expect(fellBack.value).toBe('backup');
    expect(calls).toEqual(['primary', 'backup']);
    expect(secondClock.delays).toEqual([]);
  });

  it('does not retry a route after its circuit opens', async () => {
    const calls: string[] = [];
    const result = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => {
        calls.push(route.routeId);
        if (route.routeId === 'primary') {
          throw codedError('upstream_unavailable');
        }
        return 'backup';
      },
      policy: POLICY,
      circuitBreaker: breaker(1),
      replaySafe: true,
      ...fakeClock(),
    });

    expect(result.value).toBe('backup');
    expect(calls).toEqual(['primary', 'backup']);
    expect(
      result.trace.some((event) => event.type === 'retry_scheduled'),
    ).toBe(false);
  });

  it('never replays after output becomes visible', async () => {
    const calls: string[] = [];
    const error = await expectExecutionError(
      executeRoutedRequest({
        config: CONFIG,
        requiredCapabilities: REQUIREMENTS,
        operation: async ({ route }) => {
          calls.push(route.routeId);
          throw codedError('upstream_truncated_stream', {
            outputVisible: true,
          });
        },
        policy: POLICY,
        circuitBreaker: breaker(),
        replaySafe: true,
      }),
      'output_already_visible',
    );

    expect(calls).toEqual(['primary']);
    expect(error.failure?.outputVisible).toBe(true);
  });

  it('skips an already-open circuit and selects the backup', async () => {
    const registry = breaker(1);
    const permit = registry.acquire({ routeId: 'primary' }, 0);
    if (!permit.allowed) throw new Error('expected permit');
    registry.recordFailure(permit.permit, 'count', 0);

    const calls: string[] = [];
    const result = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route }) => {
        calls.push(route.routeId);
        return route.routeId;
      },
      policy: POLICY,
      circuitBreaker: registry,
      replaySafe: false,
      now: () => 1,
    });

    expect(result.value).toBe('backup');
    expect(calls).toEqual(['backup']);
    expect(
      result.trace.some((event) => event.type === 'circuit_rejected'),
    ).toBe(true);
  });

  it('never falls back to a model missing a hard capability', async () => {
    const calls: string[] = [];
    const error = await expectExecutionError(
      executeRoutedRequest({
        config: INCOMPATIBLE_FALLBACK_CONFIG,
        requiredCapabilities: { ...REQUIREMENTS, vision: true },
        operation: async ({ route }) => {
          calls.push(route.routeId);
          throw codedError('upstream_authentication_failed');
        },
        policy: POLICY,
        circuitBreaker: breaker(),
        replaySafe: false,
      }),
      'no_compatible_route',
    );

    expect(calls).toEqual(['primary']);
    expect(error.trace.map((event) => event.type)).toContain(
      'fallback_scheduled',
    );
  });

  it('updates affinity only after a successful fallback', async () => {
    const store = new InMemorySessionAffinityStore();
    const first = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      sessionId: 'session',
      affinityStore: store,
      operation: async ({ route }) => {
        if (route.routeId === 'primary') {
          throw codedError('upstream_authentication_failed');
        }
        return route.routeId;
      },
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: false,
    });

    expect(first.route.routeId).toBe('backup');
    expect(store.get('session')).toBe('backup');

    const second = await executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      sessionId: 'session',
      affinityStore: store,
      operation: async ({ route }) => route.routeId,
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: false,
    });
    expect(second.route.routeId).toBe('backup');
    expect(second.route.affinityRetained).toBe(true);
  });

  it('enforces the total attempt limit across routes', async () => {
    const calls: string[] = [];
    const clock = fakeClock();
    const error = await expectExecutionError(
      executeRoutedRequest({
        config: CONFIG,
        requiredCapabilities: REQUIREMENTS,
        operation: async ({ route }) => {
          calls.push(route.routeId);
          throw codedError('upstream_unavailable');
        },
        policy: {
          ...POLICY,
          maxAttemptsPerRoute: 1,
          maxTotalAttempts: 2,
        },
        circuitBreaker: breaker(),
        replaySafe: true,
        now: clock.now,
        sleep: clock.sleep,
      }),
      'attempt_limit_exceeded',
    );

    expect(calls).toEqual(['primary', 'backup']);
    expect(error.trace.filter((event) => event.type === 'attempt_started')).toHaveLength(
      2,
    );
  });

  it('cuts off an operation that does not cooperate with the abort signal', async () => {
    const registry = breaker();
    const startedAt = Date.now();
    const error = await expectExecutionError(
      executeRoutedRequest({
        config: CONFIG,
        requiredCapabilities: REQUIREMENTS,
        operation: async () => {
          await delay(100);
          return 'late';
        },
        policy: { ...POLICY, totalDeadlineMs: 15 },
        circuitBreaker: registry,
        replaySafe: true,
      }),
      'deadline_exceeded',
    );

    expect(Date.now() - startedAt).toBeLessThan(80);
    expect(error.failure?.code).toBe('execution_deadline_exceeded');
    expect(registry.acquire({ routeId: 'primary' }).allowed).toBe(true);
  });

  it('propagates external abort without retry or fallback', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const execution = executeRoutedRequest({
      config: CONFIG,
      requiredCapabilities: REQUIREMENTS,
      operation: async ({ route, signal }) => {
        calls.push(route.routeId);
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', resolve, { once: true });
        });
        throw codedError('client_closed_request');
      },
      policy: POLICY,
      circuitBreaker: breaker(),
      replaySafe: true,
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled'));

    const error = await expectExecutionError(execution, 'request_aborted');
    expect(calls).toEqual(['primary']);
    expect(error.trace.some((event) => event.type === 'fallback_scheduled')).toBe(
      false,
    );
  });

  it('rejects invalid retry policy before dispatch', async () => {
    let calls = 0;
    await expect(
      executeRoutedRequest({
        config: CONFIG,
        requiredCapabilities: REQUIREMENTS,
        operation: async () => {
          calls += 1;
          return 'never';
        },
        policy: { ...POLICY, baseDelayMs: 101, maxDelayMs: 100 },
        circuitBreaker: breaker(),
        replaySafe: false,
      }),
    ).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
  });
});
