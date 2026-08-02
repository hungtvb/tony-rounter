# Tony Rounter

Local-first AI gateway and task-aware model router for coding agents.

> The repository name currently uses `rounter`; the product name is **Tony Router**.

## Current status

Implemented and verified:

- secure loopback-first Fastify gateway
- generated local bearer token and redacted JSON logs
- authenticated `GET /v1/models`
- authenticated `POST /v1/chat/completions`
- non-streaming and validated SSE streaming proxy
- upstream timeout, disconnect propagation, redirect rejection, and normalized errors
- versioned YAML routing registry
- hard capability extraction for tools, parallel tool calls, vision, structured output, and context size
- deterministic profile/route scoring with lexical tie-breaking
- bounded session affinity and machine-readable rejection traces

The routing engine currently lives in `@tony-router/core`. Wiring multiple configured upstream providers into the HTTP gateway and safe runtime fallback are the next phases.

## Run the gateway

Requirements: Node.js 22+ and pnpm 10.14.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm --filter @tony-router/gateway build
pnpm --filter @tony-router/gateway start
```

The gateway listens on `127.0.0.1:8787` by default. Without `TONY_ROUTER_TOKEN`, a 256-bit token is created at `~/.tony-router/token`.

Configure one OpenAI-compatible upstream:

```bash
export TONY_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
export TONY_ROUTER_UPSTREAM_API_KEY=your-provider-api-key
```

Remote upstreams require HTTPS. Loopback HTTP is accepted for development.

```bash
curl http://127.0.0.1:8787/health

curl http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)"

curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

See `.env.example` for all gateway settings.

## Routing core

A complete example is available at `examples/router.yaml`.

```ts
import {
  deriveChatRequestCapabilities,
  InMemorySessionAffinityStore,
  parseRoutingConfig,
  RoutingEngine,
} from '@tony-router/core';

const config = parseRoutingConfig(yamlSource);
const engine = new RoutingEngine(
  config,
  new InMemorySessionAffinityStore(10_000),
);

const decision = engine.select({
  sessionId: 'coding-session-1',
  profileId: 'coding',
  requiredCapabilities: deriveChatRequestCapabilities(request, {
    estimatedInputTokens: 20_000,
    reservedOutputTokens: 4_000,
  }),
  routeStates: {
    'fast-primary': { healthy: true, available: true },
  },
});
```

Selection rules are deterministic:

1. Reject routes outside the profile, disabled routes, unhealthy/unavailable routes, and models missing any hard capability.
2. Retain the session-affine route only while it remains accepted.
3. Sort remaining accepted routes by profile priority, route priority, then route ID.
4. Return every evaluated route with machine-readable rejection reasons.

Invalid versions, unknown critical fields, duplicate YAML keys, aliases, invalid capability combinations, duplicate profile routes, and dangling references fail configuration startup.

## Architecture

```text
Client / Coding Agent
        |
        v
Protocol Gateway
  - OpenAI Chat Completions
  - Responses / Anthropic Messages (planned)
        |
        v
Routing Engine
  - versioned profiles
  - hard capability filter
  - deterministic scoring
  - session affinity
  - decision trace
        |
        v
Provider Adapters
  - OpenAI-compatible (implemented)
  - Anthropic / Gemini / others (planned)
```

## Security boundaries

- Loopback bind by default; non-loopback requires explicit opt-in.
- Local and upstream credentials are redacted and never printed at startup.
- Upstream redirects are rejected before credentials can be forwarded elsewhere.
- YAML aliases are disabled and configuration size is bounded.
- MCP runtimes and arbitrary subprocess execution are not embedded in the gateway.

See `docs/roadmap.md` and GitHub issues for the implementation sequence.
