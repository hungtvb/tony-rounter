# Tony Rounter

Local-first AI gateway and task-aware model router for coding agents.

> The repository name currently uses `rounter`; the product name is **Tony Router**.

## Current status

Implemented and verified:

- secure loopback-first Fastify gateway
- generated local bearer token and redacted JSON logs
- authenticated `GET /v1/models`
- authenticated `POST /v1/chat/completions`
- authenticated `POST /v1/responses` compatibility for text/image/inline-PDF input, JSON Schema structured output, custom function tools, and self-contained tool-result continuation across JSON and SSE streaming
- non-streaming and validated SSE streaming proxy for Chat Completions
- upstream timeout, disconnect propagation, redirect rejection, and normalized errors
- versioned YAML routing registry
- hard capability extraction for tools, parallel tool calls, vision, inline file input, structured output, reasoning, and context size
- deterministic profile/route scoring with lexical tie-breaking
- bounded session affinity and machine-readable rejection traces
- multi-provider routed runtime with bounded retry, safe fallback, and per-account circuit isolation
- first-class provider accounts with routing/binding configuration version 2 and version 1 compatibility
- local control-plane dashboard with protected provider/account inventory, models, traces, and chat playground
- environment-only provider setup assistant that generates starter files without collecting raw API keys
- optional loopback-only managed config generations with atomic apply, hash-verified rollback, and restart-required state
- bounded per-account health probes that return status categories and latency without raw provider responses

The Responses compatibility layer translates supported requests through the same routed Chat Completions runtime, preserving public model IDs and route/provider/account headers. User messages may mix text with HTTPS image URLs, base64 PNG/JPEG/GIF/WEBP data URLs, and inline base64 PDF files. Image detail (`auto`, `low`, or `high`) and original mixed-content order are preserved. Image requests require `vision: true`; inline PDF requests require `fileInput: true`. PDF bytes are validated as bounded canonical base64 with a PDF header, EOF marker, and basename ending in `.pdf`, then forwarded losslessly as a Chat Completions file content part. Tony Router never fetches, proxies, renders, extracts, OCRs, or persists image/PDF input locally. `text.format.type: json_schema` is translated losslessly to Chat Completions Structured Outputs and requires a model declaring `structuredOutput: true`; Tony Router never silently downgrades it to legacy JSON mode or plain text. Text, refusal, provider-supplied reasoning summary, and custom function-call streams are emitted as ordered Responses lifecycle events with monotonic sequence numbers. Reasoning is never inferred from ordinary assistant text; `reasoning.effort` / `reasoning.summary` are forwarded only to routes declaring `reasoning: true`. Function argument deltas are aggregated exactly into completed output items; malformed or truncated upstream data after output becomes a terminal `error` event and never triggers fallback after emission.

Clients can complete a custom function loop without gateway persistence by resending prior assistant `message` / `function_call` items together with matching `function_call_output` items. Tony Router validates that every call ID has exactly one preceding call and one completed text output before forwarding the continuation. Responses `input_file.file_id` remains unsupported until provider/account ownership can be pinned safely; `input_file.file_url` remains unsupported because Tony Router does not fetch remote files. Image/file tool outputs, server-side `previous_response_id`, hosted tools, encrypted/private reasoning content, background execution, stored responses, and automatic tool execution also remain explicitly unsupported.

The routing engine lives in `@tony-router/core`; the Fastify gateway wires profiles to provider accounts and keeps public model IDs stable across JSON and SSE responses.

## Run the gateway

Requirements: Node.js 22+ and pnpm 10.14.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm --filter @tony-router/gateway build
pnpm --filter @tony-router/gateway start
```

The gateway listens on `127.0.0.1:8787` by default. Without `TONY_ROUTER_TOKEN`, a 256-bit token is created at `~/.tony-router/token`.

For the simplest legacy mode, configure one OpenAI-compatible upstream:

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

curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "instructions": "Be concise.",
    "input": "Write hello.txt.",
    "tools": [{
      "type": "function",
      "name": "write_file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {"type": "string"},
          "content": {"type": "string"}
        },
        "required": ["path", "content"]
      }
    }],
    "tool_choice": "required",
    "stream": true
  }'

# Multimodal input is forwarded only to a vision-capable route.
curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tony-auto",
    "input": [{
      "role": "user",
      "content": [
        {"type": "input_text", "text": "Describe this image."},
        {
          "type": "input_image",
          "image_url": "https://images.example.com/photo.jpg",
          "detail": "high"
        }
      ]
    }],
    "stream": true
  }'

# Inline PDFs are forwarded only to a route declaring fileInput: true.
PDF_DATA="$(base64 < spec.pdf | tr -d '\n')"
curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"tony-auto\",
    \"input\": [{
      \"role\": \"user\",
      \"content\": [
        {\"type\": \"input_text\", \"text\": \"Summarize this specification.\"},
        {
          \"type\": \"input_file\",
          \"file_data\": \"$PDF_DATA\",
          \"filename\": \"spec.pdf\"
        }
      ]
    }],
    \"stream\": true
  }"

# JSON Schema structured output is routed only to a compatible model.
curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tony-auto",
    "input": "Return a safe edit plan.",
    "text": {
      "format": {
        "type": "json_schema",
        "name": "edit_plan",
        "schema": {
          "type": "object",
          "properties": {
            "summary": {"type": "string"},
            "files": {
              "type": "array",
              "items": {"type": "string"}
            }
          },
          "required": ["summary", "files"],
          "additionalProperties": false
        },
        "strict": true
      }
    },
    "stream": true
  }'

# Reasoning summaries and refusals are forwarded only when explicitly supplied upstream.
curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tony-auto",
    "input": "Evaluate the request safely.",
    "reasoning": {"effort": "high", "summary": "concise"},
    "stream": true
  }'

# After executing the returned function call, resend the completed call and output.
curl --no-buffer http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $(cat ~/.tony-router/token)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": "Write hello.txt."
      },
      {
        "type": "function_call",
        "call_id": "call_1",
        "name": "write_file",
        "arguments": "{\"path\":\"hello.txt\",\"content\":\"hello\"}",
        "status": "completed"
      },
      {
        "type": "function_call_output",
        "call_id": "call_1",
        "output": "{\"ok\":true}"
      }
    ],
    "stream": true
  }'
```

This continuation mode is self-contained: include the prior assistant/function-call items needed by the model. `previous_response_id` is not accepted because Tony Router does not persist Responses state.

See `.env.example` for all gateway settings. For multiple accounts, use `examples/router.yaml`, `docs/provider-accounts.md`, and the **Providers** page at `http://127.0.0.1:8787/ui#providers`. Set an absolute loopback-only `TONY_ROUTER_CONTROL_DIR` to enable validated atomic apply and rollback without storing provider keys.

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
  - OpenAI Responses (text/image/structured/function JSON + SSE compatibility)
  - Anthropic Messages (planned)
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
        |
        v
Provider Accounts
  - independent credentials and endpoints
  - account-isolated circuit/fallback state
  - Anthropic / Gemini adapters (planned)
```

## Security boundaries

- Loopback bind by default; non-loopback requires explicit opt-in.
- Local and upstream credentials are redacted and never printed at startup.
- Upstream redirects are rejected before credentials can be forwarded elsewhere.
- YAML aliases are disabled and configuration size is bounded.
- MCP runtimes and arbitrary subprocess execution are not embedded in the gateway.

See `docs/roadmap.md` and GitHub issues for the implementation sequence.
