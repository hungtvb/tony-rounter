# Architecture

## 1. Product boundary

Tony Router is a local control plane between coding clients and AI providers. Its core responsibility is to accept supported client protocols, normalize requests, select a compatible route, forward streams, and return protocol-correct responses.

The gateway must not become a general shell runner or an MCP runtime. Those capabilities require separate processes and trust boundaries.

## 2. Request flow

```text
Client
  |
  v
HTTP transport
  |
  v
Protocol parser and validator
  |
  v
Canonical request
  |
  +--> Required capability extraction
  |
  +--> Session lookup / affinity
  |
  v
Routing engine
  |
  +--> Candidate filter
  +--> Health / cooldown filter
  +--> Policy constraints
  +--> Scoring
  |
  v
Provider adapter
  |
  +--> Request translation
  +--> Timeout / retry policy
  +--> Stream parsing
  |
  v
Canonical response events
  |
  v
Client protocol encoder
```

## 3. Canonical model

Protocol adapters must translate into shared domain types rather than calling provider adapters directly.

```ts
export interface CanonicalRequest {
  requestId: string;
  sessionId?: string;
  modelHint?: string;
  profile?: string;
  messages: CanonicalMessage[];
  tools?: CanonicalTool[];
  responseFormat?: CanonicalResponseFormat;
  requiredCapabilities: RequiredCapabilities;
  limits?: RequestLimits;
  metadata?: Record<string, string>;
}
```

Canonical streaming events should cover at least:

- response start;
- text delta;
- reasoning delta when allowed;
- tool-call start, argument delta, and completion;
- usage update;
- response completion;
- normalized error.

Unsupported provider fields must be rejected or explicitly downgraded by policy. They must not be silently discarded.

## 4. Routing pipeline

Routing uses deterministic stages:

1. Load the requested profile.
2. Derive hard capability requirements from the request.
3. Remove incompatible models.
4. Remove unhealthy or cooling-down routes.
5. Apply project, provider, and budget constraints.
6. Prefer the session-affine route when it remains valid.
7. Score remaining candidates by profile priority, quota headroom, latency, cost, and recent error rate.
8. Select a route and record the reasons.

The initial MVP should use rule-based routing. Automatic task classification can later produce a profile hint, but it must not bypass hard constraints.

## 5. Failure behavior

### Retry

Retry only failures known to be transient and only when the request can be replayed safely. Streaming requests that already emitted user-visible output require special handling and must not restart invisibly.

### Fallback

Fallback is permitted when:

- a compatible candidate remains;
- the policy allows provider/model switching;
- no irreversible partial output has been emitted, or the client explicitly supports continuation;
- tool and response-format requirements are preserved.

### Circuit breaker

Each route maintains failure counts and cooldown state. Authentication/configuration errors should open the circuit longer than transient upstream failures.

## 6. Security boundaries

- Bind to `127.0.0.1` and `::1` by default.
- Require a generated local bearer token even on loopback.
- Never infer trusted-local status from `Host`, `Origin`, or forwarded headers.
- Redact authorization headers, API keys, cookies, tool arguments marked sensitive, and configured patterns.
- Store credentials outside normal configuration files where platform support exists.
- Keep public tunnel support out of the MVP.
- Do not execute arbitrary commands from HTTP requests.
- Run future MCP integrations in a separate sandboxed process with an explicit capability allowlist.

## 7. Configuration model

```yaml
server:
  host: 127.0.0.1
  port: 9411

profiles:
  coding:
    routes:
      - provider: openai
        model: example-coding-model
        priority: 100
    constraints:
      require_tools: true
      max_cost_usd: 1.00

providers:
  openai:
    type: openai-compatible
    base_url: https://api.example.com/v1
    credential_ref: OPENAI_API_KEY
```

Configuration must be validated with a versioned schema. Unknown critical keys should fail startup rather than being ignored.

## 8. Observability

Every request should expose a local trace containing:

- request ID and session ID;
- selected profile;
- candidate routes considered;
- rejection reasons;
- selected route;
- upstream latency and status;
- retry/fallback transitions;
- token/usage data where available.

Prompts and responses are excluded from logs by default.

## 9. Test strategy

- Unit tests for capability filtering, policy evaluation, scoring, and redaction.
- Contract tests for each exposed protocol.
- Recorded provider fixtures for stream parsing.
- Failure-path tests for timeout, partial stream, malformed SSE, rate limits, auth failure, and circuit-breaker transitions.
- Security tests for loopback binding, bearer auth, header spoofing, and secret leakage.
- End-to-end smoke tests against a mock OpenAI-compatible server before live-provider tests.

## 10. Initial technology decision

Start with TypeScript on Node.js 22+ in a pnpm workspace. This minimizes protocol/SDK friction and enables rapid contract testing. Keep the routing core free from framework dependencies so a future Go or Rust transport can reuse the behavioral specification if performance or packaging later requires it.
