# Multi-provider gateway

Tony Router routed mode combines two configuration files:

- `TONY_ROUTER_ROUTING_CONFIG_FILE` points to versioned routing YAML parsed by `@tony-router/core`.
- `TONY_ROUTER_PROVIDER_CONFIG_FILE` points to a strict JSON provider/account binding file.

Version 2 separates provider defaults from account credentials. Multiple accounts may share one provider adapter and model catalog while retaining independent API keys, timeouts, circuit state, and fallback behavior. See `docs/provider-accounts.md` and `examples/router.yaml`.

Raw API keys are rejected from binding files. Each account references a named environment variable through `apiKeyEnv`.

In routed mode, OpenAI-compatible `model` values are routing profile IDs such as `tony-auto`. The selected route rewrites that public profile to its configured upstream model, and upstream model IDs remain internal in both JSON and SSE responses.

Ambiguous failures such as timeout, connection failure, or upstream 5xx are not replayed by default. Clients must explicitly send `x-tony-router-replay-safe: true` to authorize fallback after a failure that may have processed the request. Authentication, configuration, and rate-limit rejection can fall back before output without that header.

`x-tony-router-session` enables bounded in-process route affinity. Successful responses include `x-tony-router-route`, `x-tony-router-provider`, `x-tony-router-account`, and `x-tony-router-attempts` headers.

Streaming fallback is limited to failures detected before the first accepted SSE event. Once output is visible, the stream is never replayed from another account or provider.

Version 1 routing and provider bindings remain supported and are normalized into one account per provider.
