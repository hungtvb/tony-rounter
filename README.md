# Tony Rounter

Local-first AI gateway and task-aware model router for coding agents.

> Repository name currently uses `rounter`; the product name in documentation is **Tony Router**.

## Vision

Tony Router exposes one local endpoint for coding clients such as Codex CLI, Claude Code, Gemini CLI, Cursor, Cline, OpenCode, and Tony Harness. It routes each request to a compatible provider/model based on task profile, capabilities, health, quota, latency, and budget.

Unlike a basic fallback proxy, Tony Router is designed to preserve workflow and session continuity across model changes.

## Core principles

- **Local-first and secure by default** — bind to loopback only, redact logs, isolate credentials, and keep remote access disabled unless explicitly enabled.
- **Protocol compatibility** — OpenAI Responses, OpenAI Chat Completions, Anthropic Messages, and Gemini adapters.
- **Capability-aware routing** — never fallback to a model that cannot satisfy required tools, structured output, vision, or context limits.
- **Workflow-aware routing** — route brainstorm, planning, implementation, review, and verification to different profiles when useful.
- **Continuity-aware fallback** — preserve normalized context, tool schemas, session affinity, and a compact handoff when switching providers.
- **Evidence-based operation** — health checks, circuit breakers, traceable routing decisions, and contract tests.

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

## MVP scope

1. Local HTTP gateway.
2. `/v1/models`, `/v1/chat/completions`, and `/v1/responses`.
3. OpenAI-compatible provider adapter first.
4. Static routing profiles with capability checks.
5. Streaming passthrough.
6. Session affinity, retry policy, circuit breaker, and redacted structured logs.
7. Contract and failure-path tests.

Anthropic/Gemini protocol translation, desktop UI, credential vault integrations, automatic task classification, and multi-model review come after the core is stable.

## Proposed workspace

```text
apps/
  gateway/             # Local daemon and HTTP API
  cli/                 # Configuration, diagnostics, and profile commands
packages/
  core/                # Shared domain types and errors
  routing-engine/      # Policies, capability filtering, scoring
  protocol-openai/     # OpenAI request/response normalization
  provider-openai/     # First provider adapter
  observability/       # Redaction, structured logs, metrics
  config/              # Schema and configuration loading
docs/
  architecture.md
  roadmap.md
```

## Initial non-goals

- Public hosted SaaS gateway.
- Browser-exposed credential management.
- Arbitrary shell command execution.
- Running MCP servers inside the gateway process.
- Automatic model selection based only on an opaque LLM classifier.

## Status

Project initialization. See `docs/roadmap.md` and GitHub issues for the implementation sequence.
