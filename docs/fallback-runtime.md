# Safe retry, circuit breaker, and fallback runtime

The Phase 3 runtime executes a routed operation without silently replaying requests after visible output or after an unsafe ambiguous failure.

## Failure classification

Provider failures are classified into stable kinds with explicit replay metadata:

- configuration and authentication failures are not transient, open their route/account circuit immediately, and may fall back because the provider rejected the request before processing
- rate limits may retry or fall back and may provide a bounded `retryAfterMs`
- timeout, connection reset, upstream 5xx, malformed response, and malformed stream failures are treated as potentially processed requests
- client abort and rejected request failures are never retried automatically
- any failure marked `outputVisible: true` forbids retry and fallback regardless of policy

A potentially processed request is replayed only when the caller explicitly sets `replaySafe: true`.

## Circuit breaker isolation

Circuit state is isolated by both `routeId` and optional `accountId`. Each circuit moves through:

```text
closed -> open -> half_open -> closed
                   |          
                   +-> open on probe failure
```

Configuration/authentication failures open immediately. Transient failures open after `failureThreshold`. The half-open probe count is bounded, permits are single-use, and reset invalidates outstanding permits for that key.

## Execution policy

```ts
const policy = {
  maxAttemptsPerRoute: 2,
  maxTotalAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
  totalDeadlineMs: 30_000,
};
```

The runtime enforces all limits even when an operation ignores its abort signal. Exponential retry delay is deterministic and capped. A provider `retryAfterMs` is respected only when it fits the configured cap and remaining total deadline; otherwise the runtime moves to a compatible fallback or fails.

## Selection and affinity

Fallback reuses the deterministic capability-aware selector. A failed route is excluded only for the current execution, so a fallback can never bypass required tools, vision, structured output, or context size. Session affinity is updated only after an attempt succeeds.

## Trace

Every execution returns or throws with an immutable trace containing:

- route selection
- circuit rejection
- attempt start
- normalized attempt failure and circuit snapshot
- scheduled retry delay
- scheduled fallback
- successful attempt

The trace is operational metadata. It must not contain provider credentials, raw prompts, or raw response bodies.
