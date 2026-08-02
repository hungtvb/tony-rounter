# Phase 3 lifecycle hardening

The runtime enforces these additional invariants:

- an already-aborted signal prevents provider dispatch
- abort and deadline races always settle the acquired circuit permit
- custom backoff failures are normalized as runtime execution failures
- circuit reset invalidates every outstanding permit for the same route/account key
- external-abort tests wait until the provider operation has started before cancelling
