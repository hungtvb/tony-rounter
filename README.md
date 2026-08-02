# Tony Rounter

Local-first AI gateway and task-aware model router for coding agents.

> Repository name currently uses `rounter`; the product name in documentation is **Tony Router**.

## Current status

The secure local transport is implemented:

- loopback-only binding by default
- generated 256-bit bearer token stored in `~/.tony-router/token`
- public `GET /health`
- authenticated `GET /v1/models`
- generated request IDs returned through `x-request-id`
- bounded request bodies and request deadlines
- normalized JSON errors
- structured logs with secret redaction
- bounded graceful shutdown for `SIGINT` and `SIGTERM`

Provider adapters and completion endpoints are the next implementation phase.

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

Read it from the file and send it as a bearer token:

```bash
curl http://127.0.0.1:8787/health

curl http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)"
```

On Windows PowerShell:

```powershell
$token = Get-Content "$HOME/.tony-router/token"
Invoke-RestMethod http://127.0.0.1:8787/v1/models `
  -Headers @{ Authorization = "Bearer $token" }
```

See `.env.example` for supported configuration. Binding to a non-loopback
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
