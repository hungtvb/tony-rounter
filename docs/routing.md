# Routing configuration and decisions

Tony Router routing configuration is versioned independently from gateway environment settings. The current schema version is `1`.

## Registry layers

- `providers` identify adapter kinds. Phase 2 supports `openai-compatible`.
- `models` bind an upstream model name to hard capabilities.
- `routes` make a model selectable and assign route-level priority.
- `profiles` define ordered policy candidates and profile-level priority.

See `examples/router.yaml` for a complete configuration.

## Runtime state

Health and availability are not persisted in YAML. They are supplied for each decision because they change independently from policy:

```ts
const routeStates = {
  primary: { healthy: true, available: true },
  backup: { healthy: false, available: true },
};
```

A missing state means the route is not explicitly unhealthy or unavailable. Circuit breakers and quota observers will populate these values in the runtime fallback phase.

## Decision trace

Every configured route appears in `decision.candidates`, including routes outside the selected profile. Rejection codes are stable machine-readable values:

- `not_in_profile`
- `route_disabled`
- `route_unhealthy`
- `route_unavailable`
- `missing_tools`
- `missing_parallel_tool_calls`
- `missing_vision`
- `missing_structured_output`
- `missing_reasoning`
- `insufficient_context`

An accepted candidate has an empty rejection list and a deterministic score. No selected route is returned when every candidate is rejected.

## Session affinity

Affinity is a preference, not a capability override. The previous route is retained only when it remains enabled, healthy, available, inside the requested profile, and compatible with every hard requirement. Otherwise normal deterministic scoring chooses a replacement and updates the bounded affinity store.
