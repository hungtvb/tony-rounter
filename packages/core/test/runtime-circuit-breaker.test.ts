import { describe, expect, it } from 'vitest';

import { CircuitBreakerRegistry } from '../src/index.js';

const KEY = { routeId: 'primary', accountId: 'account-a' } as const;

describe('CircuitBreakerRegistry', () => {
  it('opens after the configured transient failure threshold', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 2,
      cooldownMs: 1_000,
    });

    const first = registry.acquire(KEY, 0);
    expect(first.allowed).toBe(true);
    if (!first.allowed) throw new Error('expected permit');
    expect(registry.recordFailure(first.permit, 'count', 0)).toMatchObject({
      state: 'closed',
      consecutiveFailures: 1,
    });

    const second = registry.acquire(KEY, 1);
    expect(second.allowed).toBe(true);
    if (!second.allowed) throw new Error('expected permit');
    expect(registry.recordFailure(second.permit, 'count', 1)).toMatchObject({
      state: 'open',
      consecutiveFailures: 2,
      retryAt: 1_001,
    });

    const denied = registry.acquire(KEY, 1_000);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error('expected denial');
    expect(denied.snapshot.state).toBe('open');
  });

  it('shares failure counts across concurrent closed permits', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 2,
      cooldownMs: 100,
    });

    const first = registry.acquire(KEY, 0);
    const second = registry.acquire(KEY, 0);
    if (!first.allowed || !second.allowed) {
      throw new Error('expected concurrent permits');
    }

    expect(registry.recordFailure(first.permit, 'count', 1)).toMatchObject({
      state: 'closed',
      consecutiveFailures: 1,
    });
    expect(registry.recordFailure(second.permit, 'count', 2)).toMatchObject({
      state: 'open',
      consecutiveFailures: 2,
      retryAt: 102,
    });
  });

  it('transitions to half-open after cooldown and closes on success', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 100,
    });
    const initial = registry.acquire(KEY, 0);
    if (!initial.allowed) throw new Error('expected permit');
    registry.recordFailure(initial.permit, 'count', 0);

    expect(registry.snapshot(KEY, 99).state).toBe('open');
    expect(registry.snapshot(KEY, 100).state).toBe('half_open');

    const probe = registry.acquire(KEY, 100);
    expect(probe.allowed).toBe(true);
    if (!probe.allowed) throw new Error('expected half-open permit');
    expect(probe.snapshot.state).toBe('half_open');

    expect(registry.recordSuccess(probe.permit)).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
      halfOpenInFlight: 0,
    });
  });

  it('reopens when a half-open probe fails', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 50,
    });
    const first = registry.acquire(KEY, 0);
    if (!first.allowed) throw new Error('expected permit');
    registry.recordFailure(first.permit, 'open_immediately', 0);

    const probe = registry.acquire(KEY, 50);
    if (!probe.allowed) throw new Error('expected half-open permit');
    expect(registry.recordFailure(probe.permit, 'count', 50)).toMatchObject({
      state: 'open',
      retryAt: 100,
    });
  });

  it('limits concurrent half-open probes', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 10,
      halfOpenMaxAttempts: 1,
    });
    const initial = registry.acquire(KEY, 0);
    if (!initial.allowed) throw new Error('expected permit');
    registry.recordFailure(initial.permit, 'count', 0);

    const firstProbe = registry.acquire(KEY, 10);
    expect(firstProbe.allowed).toBe(true);
    const secondProbe = registry.acquire(KEY, 10);
    expect(secondProbe.allowed).toBe(false);
  });

  it('opens immediately for permanent route failures', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 10,
      cooldownMs: 500,
    });
    const permit = registry.acquire(KEY, 0);
    if (!permit.allowed) throw new Error('expected permit');

    expect(
      registry.recordFailure(permit.permit, 'open_immediately', 20),
    ).toMatchObject({ state: 'open', retryAt: 520 });
  });

  it('isolates state by both route and account', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 100,
    });
    const accountA = registry.acquire(KEY, 0);
    if (!accountA.allowed) throw new Error('expected permit');
    registry.recordFailure(accountA.permit, 'count', 0);

    expect(
      registry.acquire({ routeId: 'primary', accountId: 'account-b' }, 1)
        .allowed,
    ).toBe(true);
    expect(
      registry.acquire({ routeId: 'backup', accountId: 'account-a' }, 1)
        .allowed,
    ).toBe(true);
    expect(registry.acquire(KEY, 1).allowed).toBe(false);
  });

  it('invalidates outstanding permits when a circuit is reset', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 100,
    });
    const acquired = registry.acquire(KEY, 0);
    if (!acquired.allowed) throw new Error('expected permit');

    registry.reset(KEY);

    expect(() => registry.recordSuccess(acquired.permit)).toThrow(
      /invalid or already settled/,
    );
    expect(registry.snapshot(KEY)).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
    });
  });

  it('rejects settling the same permit twice', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 2,
      cooldownMs: 100,
    });
    const acquired = registry.acquire(KEY, 0);
    if (!acquired.allowed) throw new Error('expected permit');
    registry.recordSuccess(acquired.permit);

    expect(() => registry.recordSuccess(acquired.permit)).toThrow(
      /already settled/,
    );
  });

  it('does not count failures with no circuit impact', () => {
    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 100,
    });
    const acquired = registry.acquire(KEY, 0);
    if (!acquired.allowed) throw new Error('expected permit');

    expect(registry.recordFailure(acquired.permit, 'none', 0)).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
    });
  });

  it('validates configuration and circuit identifiers', () => {
    expect(
      () =>
        new CircuitBreakerRegistry({ failureThreshold: 0, cooldownMs: 100 }),
    ).toThrow(RangeError);
    expect(
      () => new CircuitBreakerRegistry({ failureThreshold: 1, cooldownMs: -1 }),
    ).toThrow(RangeError);

    const registry = new CircuitBreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 0,
    });
    expect(() => registry.acquire({ routeId: ' ' })).toThrow(RangeError);
  });
});
