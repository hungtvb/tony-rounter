# Provider control plane

Tony Router exposes a local provider-first setup and operations surface at:

```text
http://127.0.0.1:8787/ui#providers
```

## Trust boundary

The browser remains an untrusted presentation surface. Every dashboard and control API is bearer-protected, and trusted config mutation is available only when the gateway binds to loopback and starts with an explicit absolute directory:

```bash
export TONY_ROUTER_CONTROL_DIR="$HOME/.tony-router/control"
pnpm --filter @tony-router/gateway start
```

Managed control mode is mutually exclusive with legacy `TONY_ROUTER_UPSTREAM_*` settings and explicit `TONY_ROUTER_ROUTING_CONFIG_FILE` / `TONY_ROUTER_PROVIDER_CONFIG_FILE` paths. The dashboard never accepts a provider API key. Provider bindings contain only `apiKeyEnv`; the real credential remains in the process environment.

## Provider and account inventory

After local bearer authentication, `/ui/api/dashboard` renders:

- provider adapters and normalized endpoints;
- accounts grouped under their provider;
- account endpoint and timeout overrides;
- safe credential status (`Key loaded` or `No key loaded`);
- provider, account, profile, model, and route counts;
- local-control state, active generation, and restart requirement.

The payload excludes API keys, gateway bearer tokens, authorization headers, prompts, response bodies, and raw upstream errors. Browser rendering uses DOM text nodes instead of configuration HTML injection.

## Validate and apply

The assistant generates:

1. `router.yaml` — routing configuration version 2.
2. `providers.json` — provider defaults and account bindings using `apiKeyEnv`.

With managed control enabled, the dashboard can validate and atomically apply the pair. Apply performs these steps:

1. parse and cross-validate both files before writing;
2. reject raw keys, unknown fields, oversized input, unsafe remote HTTP, and dangling identities;
3. write an immutable generation under `generations/<generation-id>`;
4. fsync the generation files and directory where supported;
5. switch one `active.json` pointer by atomic rename;
6. retain bounded previous generations for rollback.

A successful apply does not hot-reload the running router. It returns `restartRequired: true`. Export all environment variables named by `apiKeyEnv`, then restart Tony Router. Startup reads only the active generation and strictly requires referenced credentials.

## Rollback and recovery

Rollback validates the target generation, verifies SHA-256 hashes, reparses the routing/provider pair, and switches only the active pointer. Corrupt or partial generation directories are omitted and cannot be activated. The gateway must be restarted after rollback.

No existing generation is overwritten. An invalid candidate leaves the previous active pointer unchanged.

## Account health probes

Each routed account exposes a bounded health action. A probe calls the account's OpenAI-compatible model-list endpoint using the credential already loaded by the gateway. The dashboard receives only:

- account and provider IDs;
- status category such as `healthy`, `authentication_failed`, `rate_limited`, `timeout`, or `unavailable`;
- latency;
- timestamp;
- optional HTTP status class (`4xx` or `5xx`).

Response bodies, provider request IDs, authorization headers, credentials, and raw provider messages are not returned. Probes do not change route affinity or circuit-breaker state.

## Manual mode

Without `TONY_ROUTER_CONTROL_DIR`, generation, copy, and manual application remain available:

```bash
export OPENAI_PERSONAL_KEY='your-provider-key'
export TONY_ROUTER_ROUTING_CONFIG_FILE=/absolute/path/router.yaml
export TONY_ROUTER_PROVIDER_CONFIG_FILE=/absolute/path/providers.json
pnpm --filter @tony-router/gateway start
```

## Current boundary

This phase does not implement:

- provider credential persistence or an OS credential vault;
- OAuth/device authorization;
- automatic process restart or hot reload;
- quota or cost accounting;
- a hosted multi-user control plane.
