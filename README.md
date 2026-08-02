# Tony Rounter

Local-first AI gateway and task-aware model router for coding agents.

> Repository name currently uses `rounter`; the product name in documentation is **Tony Router**.

## Current status

The first usable OpenAI-compatible gateway is implemented:

- loopback-only binding by default
- generated 256-bit bearer token stored in `~/.tony-router/token`
- public `GET /health`
- authenticated and upstream-backed `GET /v1/models`
- authenticated `POST /v1/chat/completions`
- non-streaming chat completion proxy with normalized usage metadata
- incremental SSE validation and canonicalization for streaming responses
- upstream timeout and downstream disconnect propagation
- normalized upstream errors for invalid requests, auth failures, rate limits,
  timeouts, malformed responses, and transient failures
- generated request IDs returned through `x-request-id`
- structured logs with local and upstream credential redaction
- bounded graceful shutdown for `SIGINT` and `SIGTERM`

Capability-aware routing and multi-provider fallback are the next phases.

## Run locally

Requirements: Node.js 22+ and pnpm 10.14.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm --filter @tony-router/gateway build
pnpm --filter @tony-router/gateway start
```

The gateway listens on `127.0.0.1:8787` by default. When no
`TONY_ROUTER_TOKEN` is provided, a token is created once and stored at:

```text
~/.tony-router/token
```

Configure an OpenAI-compatible upstream before starting the gateway:

```bash
export TONY_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
export TONY_ROUTER_UPSTREAM_API_KEY=your-provider-api-key
```

Base URLs with or without the trailing `/v1` are accepted. Remote upstreams
must use HTTPS. Plain HTTP is accepted only for `localhost`, `127.0.0.1`, and
`::1` development upstreams.

Read the local gateway token and call the API:

```bash
curl http://127.0.0.1:8787/health

curl http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)"

curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Streaming uses standard Chat Completions SSE frames:

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

The gateway validates every upstream SSE event before forwarding it. A failure
before the first event returns a normalized HTTP error. A failure after output
has started emits a final SSE `error` object with the local `request_id`, then
terminates with `data: [DONE]`.

On Windows PowerShell:

```powershell
$token = Get-Content "$HOME/.tony-router/token"
Invoke-RestMethod http://127.0.0.1:8787/v1/models `
  -Headers @{ Authorization = "Bearer $token" }
```

See `.env.example` for all supported configuration. Binding to a non-loopback
address is rejected unless `TONY_ROUTER_ALLOW_NON_LOOPBACK=true` is explicitly
set. Authentication remains mandatory regardless of `Host`, `Origin`, or
forwarded headers.

## Vision

Tony Router exposes one local endpoint for coding clients such as Codex CLI,
Claude Code, Gemini CLI, Cursor, Cline, OpenCode, and Tony Harness. It routes
each request to a compatible provider/model based on task profile,
capabilities, health, quota, latency, and budget.

Unlike a basic fallback proxy, Tony Router is designed to preserve workflow
and session continuity across model changes.

## Core principles

- **Local-first and secure by default** — bind to loopback only, redact logs,
  isolate credentials, and keep remote access disabled unless explicitly
  enabled.
- **Protocol compatibility** — OpenAI Responses, OpenAI Chat Completions,
  Anthropic Messages, and Gemini adapters.
- **Capability-aware routing** — never fallback to a model that cannot satisfy
  required tools, structured output, vision, or context limits.
- **Workflow-aware routing** — route brainstorm, planning, implementation,
  review, and verification to different profiles when useful.
- **Continuity-aware fallback** — preserve normalized context, tool schemas,
  session affinity, and a compact handoff when switching providers.
- **Evidence-based operation** — health checks, circuit breakers, traceable
  routing decisions, and contract tests.

## Planned architecture

```text
Client / Coding Agent
        |
        v
Protocol Gateway
  - OpenAI Responses
  - Chat Completions
  - Anthropic Messages
        |
        v
Routing Engine
  - policy/profile
  - capability filter
  - quota/health/budget scoring
  - session affinity
        |
        v
Provider Adapters
  - OpenAI / Codex
  - Anthropic
  - Gemini
  - OpenRouter
  - TokenRouter / compatible gateways
```

## Initial non-goals

- Public hosted SaaS gateway.
- Browser-exposed credential management.
- Arbitrary shell command execution.
- Running MCP servers inside the gateway process.
- Automatic model selection based only on an opaque LLM classifier.

See `docs/roadmap.md` and GitHub issues for the implementation sequence.
