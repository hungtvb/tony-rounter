import type { CircuitFailureImpact } from './failure.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly halfOpenMaxAttempts?: number;
}

export interface CircuitKey {
  readonly routeId: string;
  readonly accountId?: string;
}

export interface CircuitSnapshot {
  readonly key: CircuitKey;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly halfOpenInFlight: number;
  readonly retryAt?: number;
}

export interface CircuitDenied {
  readonly allowed: false;
  readonly snapshot: CircuitSnapshot;
}

export interface CircuitAllowed {
  readonly allowed: true;
  readonly permit: CircuitPermit;
  readonly snapshot: CircuitSnapshot;
}

export type CircuitAcquireResult = CircuitDenied | CircuitAllowed;

interface MutableCircuit {
  state: CircuitState;
  consecutiveFailures: number;
  halfOpenInFlight: number;
  retryAt?: number;
}

const MAX_KEY_LENGTH = 256;

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

function identifier(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_KEY_LENGTH) {
    throw new RangeError(
      `${name} must contain between 1 and ${MAX_KEY_LENGTH} characters`,
    );
  }
  return normalized;
}

function normalizeKey(key: CircuitKey): CircuitKey {
  return Object.freeze({
    routeId: identifier(key.routeId, 'routeId'),
    ...(key.accountId !== undefined
      ? { accountId: identifier(key.accountId, 'accountId') }
      : {}),
  });
}

function serializedKey(key: CircuitKey): string {
  return JSON.stringify([key.routeId, key.accountId ?? null]);
}

function snapshot(key: CircuitKey, circuit: MutableCircuit): CircuitSnapshot {
  return Object.freeze({
    key,
    state: circuit.state,
    consecutiveFailures: circuit.consecutiveFailures,
    halfOpenInFlight: circuit.halfOpenInFlight,
    ...(circuit.retryAt !== undefined ? { retryAt: circuit.retryAt } : {}),
  });
}

export class CircuitPermit {
  readonly #token: symbol;

  constructor(
    readonly key: CircuitKey,
    readonly acquiredState: CircuitState,
    token: symbol,
  ) {
    this.#token = token;
  }

  matches(token: symbol): boolean {
    return this.#token === token;
  }
}

export class CircuitBreakerRegistry {
  readonly #circuits = new Map<string, MutableCircuit>();
  readonly #activePermits = new Map<symbol, string>();
  readonly config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = Object.freeze({
      failureThreshold: positiveInteger(
        config.failureThreshold,
        'failureThreshold',
      ),
      cooldownMs: nonNegativeInteger(config.cooldownMs, 'cooldownMs'),
      halfOpenMaxAttempts: positiveInteger(
        config.halfOpenMaxAttempts ?? 1,
        'halfOpenMaxAttempts',
      ),
    });
  }

  acquire(keyInput: CircuitKey, now = Date.now()): CircuitAcquireResult {
    const key = normalizeKey(keyInput);
    const id = serializedKey(key);
    const circuit = this.#circuit(id);

    if (
      circuit.state === 'open' &&
      circuit.retryAt !== undefined &&
      now >= circuit.retryAt
    ) {
      circuit.state = 'half_open';
      circuit.halfOpenInFlight = 0;
    }

    if (circuit.state === 'open') {
      return Object.freeze({
        allowed: false,
        snapshot: snapshot(key, circuit),
      });
    }
    if (
      circuit.state === 'half_open' &&
      circuit.halfOpenInFlight >= this.config.halfOpenMaxAttempts
    ) {
      return Object.freeze({
        allowed: false,
        snapshot: snapshot(key, circuit),
      });
    }

    if (circuit.state === 'half_open') circuit.halfOpenInFlight += 1;
    const token = Symbol(id);
    this.#activePermits.set(token, id);
    const permit = Object.freeze(new CircuitPermit(key, circuit.state, token));
    return Object.freeze({
      allowed: true,
      permit,
      snapshot: snapshot(key, circuit),
    });
  }

  recordSuccess(permit: CircuitPermit): CircuitSnapshot {
    const { id, circuit, key } = this.#consumePermit(permit);
    circuit.state = 'closed';
    circuit.consecutiveFailures = 0;
    circuit.halfOpenInFlight = 0;
    delete circuit.retryAt;
    this.#circuits.set(id, circuit);
    return snapshot(key, circuit);
  }

  recordFailure(
    permit: CircuitPermit,
    impact: CircuitFailureImpact,
    now = Date.now(),
  ): CircuitSnapshot {
    const { id, circuit, key } = this.#consumePermit(permit);
    if (permit.acquiredState === 'half_open' && circuit.halfOpenInFlight > 0) {
      circuit.halfOpenInFlight -= 1;
    }

    if (impact === 'open_immediately') {
      this.#open(circuit, now);
    } else if (impact === 'count') {
      circuit.consecutiveFailures += 1;
      if (
        permit.acquiredState === 'half_open' ||
        circuit.consecutiveFailures >= this.config.failureThreshold
      ) {
        this.#open(circuit, now);
      }
    } else if (permit.acquiredState === 'half_open') {
      circuit.state = 'open';
      circuit.retryAt = now;
    }

    this.#circuits.set(id, circuit);
    return snapshot(key, circuit);
  }

  snapshot(keyInput: CircuitKey, now = Date.now()): CircuitSnapshot {
    const key = normalizeKey(keyInput);
    const circuit = this.#circuit(serializedKey(key));
    if (
      circuit.state === 'open' &&
      circuit.retryAt !== undefined &&
      now >= circuit.retryAt
    ) {
      return snapshot(key, {
        ...circuit,
        state: 'half_open',
        halfOpenInFlight: 0,
      });
    }
    return snapshot(key, circuit);
  }

  reset(keyInput: CircuitKey): void {
    const id = serializedKey(normalizeKey(keyInput));
    this.#circuits.delete(id);
    this.#invalidatePermits(id);
  }

  clear(): void {
    this.#circuits.clear();
    this.#activePermits.clear();
  }

  #circuit(id: string): MutableCircuit {
    const existing = this.#circuits.get(id);
    if (existing) return existing;

    const created: MutableCircuit = {
      state: 'closed',
      consecutiveFailures: 0,
      halfOpenInFlight: 0,
    };
    this.#circuits.set(id, created);
    return created;
  }

  #invalidatePermits(id: string): void {
    for (const [token, storedId] of this.#activePermits) {
      if (storedId === id) this.#activePermits.delete(token);
    }
  }

  #open(circuit: MutableCircuit, now: number): void {
    circuit.state = 'open';
    circuit.halfOpenInFlight = 0;
    circuit.retryAt = now + this.config.cooldownMs;
  }

  #consumePermit(permit: CircuitPermit): {
    readonly id: string;
    readonly circuit: MutableCircuit;
    readonly key: CircuitKey;
  } {
    const key = permit.key;
    const id = serializedKey(key);
    const matchingToken = [...this.#activePermits.entries()].find(
      ([token, storedId]) => storedId === id && permit.matches(token),
    )?.[0];
    if (!matchingToken) {
      throw new Error('Circuit permit is invalid or already settled');
    }
    this.#activePermits.delete(matchingToken);
    return { id, circuit: this.#circuit(id), key };
  }
}
