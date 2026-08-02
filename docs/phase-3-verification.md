# Phase 3 verification checklist

The safe fallback runtime must pass these gates before merge:

- failure classification distinguishes permanent, transient, ambiguous, and output-visible failures
- authentication and configuration failures are not retried
- potentially processed requests require explicit replay authorization
- output-visible failures never retry or fall back
- retries and total attempts are bounded
- total deadlines abort uncooperative operations
- circuit state is isolated by route and account
- half-open probe concurrency is bounded
- fallback selection preserves every hard capability
- session affinity changes only after success
- execution traces are immutable and machine-readable
- format, lint, typecheck, unit tests, and build pass on a frozen-lockfile checkout
