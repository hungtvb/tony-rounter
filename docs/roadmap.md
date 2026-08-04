# Roadmap

> **Implementation note (2026-08-03):** The repository has delivered multi-provider routed runtime, first-class provider accounts, a local provider-first web control plane, atomic managed-config generations with rollback, bounded account health probes, and text JSON/SSE OpenAI Responses compatibility ahead of the original phase numbering below. Treat current code, tests, and active GitHub issues as authoritative; this document remains the long-range protocol/desktop roadmap.

## Delivery strategy

Build the smallest verifiable routing core first. Each phase should end with executable tests and a working artifact rather than documentation-only completion.

## Phase 0 — Repository foundation

- pnpm workspace and TypeScript configuration.
- formatting, linting, type checking, and tests.
- CI for pull requests.
- contribution and security notes.
- mock OpenAI-compatible upstream used by tests.

**Exit evidence**

- clean install from a fresh checkout;
- lint, typecheck, and tests pass in CI;
- mock upstream can emit normal and malformed streams.

## Phase 1 — Single-provider gateway

- local HTTP server with generated bearer token;
- `/health` and `/v1/models`;
- `/v1/chat/completions` non-streaming and streaming;
- OpenAI-compatible provider adapter;
- canonical request and stream event types;
- timeout and normalized error handling;
- redacted structured logs.

**Exit evidence**

- OpenAI-compatible client can complete a streamed chat through the local gateway;
- authorization, timeout, malformed stream, and secret-redaction tests pass.

## Phase 2 — Deterministic routing

- versioned YAML configuration schema;
- route and model capability registry;
- named profiles;
- hard capability filtering;
- deterministic priority/health scoring;
- session affinity;
- routing decision trace.

**Exit evidence**

- tests prove incompatible models are never selected;
- repeated session requests remain affine while the route is healthy;
- route selection is reproducible from the same state.

## Phase 3 — Resilience

- retry policy for replay-safe transient failures;
- per-route circuit breaker and cooldown;
- fallback before output emission;
- quota and rate-limit observations;
- partial-stream failure semantics.

**Exit evidence**

- controlled tests exercise timeout, 429, 5xx, auth failure, and partial SSE failures;
- fallback never silently duplicates already-emitted output.

## Phase 4 — OpenAI Responses API

Delivered compatibility slices:

- authenticated non-streaming `/v1/responses` request parsing;
- text message and instruction translation through the existing routed Chat Completions runtime;
- non-streaming function tool and named tool-choice mapping;
- response text, function-call, usage, and public-model normalization;
- text-only `stream: true` translation into ordered Responses lifecycle events;
- streaming custom function-call output items and argument delta/done events;
- required, named, disabled, and automatic function tool-choice preservation;
- deterministic mixed text/function output and bounded parallel function calls;
- monotonic sequence numbers, terminal usage, and no exposed Chat Completions `[DONE]` sentinel;
- fallback allowed only before output, with routed identity headers preserved;
- downstream disconnect propagation and terminal post-emission `error` events;
- fail-closed validation for changed call IDs/names, malformed indices, unconfigured functions, ambiguous mixed deltas, and serial/parallel contract violations;
- self-contained manual continuation with replayed assistant output, `function_call` items, and matching text-only `function_call_output` items;
- deterministic translation to Chat Completions assistant `tool_calls` plus `tool` messages, including multiple parallel and sequential function-call turns;
- rejection of orphan/duplicate/unresolved calls, duplicate outputs, incomplete statuses, message interleaving, and image/file tool outputs before provider invocation;
- capability-safe user `input_image` translation for HTTPS URLs and base64 PNG/JPEG/GIF/WEBP data URLs;
- ordered text/image content mapping, `auto`/`low`/`high` detail preservation, and deterministic rejection of malformed or unsupported image references;
- vision-capability filtering before provider invocation, without local image fetching, proxying, transformation, or persistence;
- Responses `text.format.type: json_schema` validation and lossless translation to Chat Completions Structured Outputs;
- structured-output capability filtering before provider invocation, with explicit rejection of legacy JSON mode, malformed schemas, unsupported fields, and silent downgrade paths;
- Codex-style JSON/SSE compatibility fixtures combining instructions, function tools, image input, and strict structured output;
- bounded refusal normalization plus ordered `response.refusal.delta` / `done` lifecycle events;
- bounded reasoning request forwarding, reasoning-capability filtering, explicit provider-supplied reasoning-summary lifecycle events, and reasoning-token usage preservation;
- capability-safe inline base64 PDF `input_file` translation with ordered text/image/PDF content, bounded PDF validation, and no local fetching, rendering, extraction, OCR, or persistence;
- explicit rejection of provider-account-owned `file_id`, remote `file_url`, hosted-tool, encrypted/private reasoning content, stored, background, and server-side `previous_response_id` chaining features;
- gateway contracts for authentication, missing provider, JSON/SSE translation, routed fallback, no post-output replay, disconnect, malformed streams, and protocol mismatch.

Remaining:

- virtual Files API IDs with explicit provider/account ownership, remote file URL policy, and broader multimodal capability mapping;
- server-side `previous_response_id` chaining and response persistence;
- optional stored/background semantics only after their ownership and persistence boundaries are defined.

**Exit evidence**

- Codex-style Responses API fixtures pass through the gateway;
- tool calls and usage remain protocol-correct;
- streaming event order and terminal semantics remain deterministic;
- unsupported feature downgrade requires explicit policy rather than silent omission.

## Phase 5 — Multiple providers

- Anthropic Messages adapter;
- Gemini adapter;
- OpenRouter and TokenRouter-compatible presets;
- model aliasing and provider-specific capability declarations;
- cross-provider handoff rules.

**Exit evidence**

- equivalent canonical fixtures pass against at least two provider protocols;
- unsupported feature downgrade requires explicit policy.

## Phase 6 — CLI and diagnostics

- `tony-router init`;
- `tony-router serve`;
- `tony-router doctor`;
- `tony-router routes`;
- config generation for supported coding clients;
- local trace viewer.

**Exit evidence**

- a new user can initialize, validate, and run a gateway without editing generated secrets manually.

## Phase 7 — Desktop control plane

The loopback web control plane now covers provider inventory, environment-only setup, atomic config apply/rollback, and account health probes. The remaining desktop phase includes:

- Tauri desktop shell;
- provider/account setup;
- routing profiles editor;
- quota/health dashboard;
- request trace inspection with prompts hidden by default;
- OS credential-vault integration.

## Phase 8 — Workflow orchestration

- task/profile hints from Tony Harness;
- workflow-specific route policies;
- parallel independent review;
- judge/aggregation strategy;
- compact continuity handoff;
- project budgets and policy packs.

## Deferred until after core stability

- public hosted service;
- remote tunnel support;
- automatic opaque LLM-only routing;
- embedded MCP execution;
- arbitrary plugin code inside the gateway process.
