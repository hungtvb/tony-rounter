# Provider accounts

Phase 5 separates reusable provider adapters from credential-bearing accounts.

```text
Provider -> Account -> Route -> Profile
        \-> Model --/
```

A model belongs to a provider. A route pairs that model with one account belonging to the same provider. Circuit breaker, retry, fallback, and session-affinity state are isolated by account ID.

## Routing configuration v2

```yaml
version: 2
defaultProfile: tony-auto
providers:
  openai:
    kind: openai-compatible
accounts:
  personal:
    provider: openai
  work:
    provider: openai
models:
  gpt:
    provider: openai
    upstreamModel: gpt-5
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      contextTokens: 128000
routes:
  personal-route:
    model: gpt
    account: personal
    priority: 20
  work-route:
    model: gpt
    account: work
    priority: 10
profiles:
  tony-auto:
    routes:
      - route: personal-route
      - route: work-route
```

Both routes reuse one provider adapter and one model catalog entry. They differ only by account credential and account-specific runtime state.

## Provider binding v2

```json
{
  "version": 2,
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "timeoutMs": 60000
    }
  },
  "accounts": {
    "personal": {
      "provider": "openai",
      "apiKeyEnv": "OPENAI_PERSONAL_KEY"
    },
    "work": {
      "provider": "openai",
      "apiKeyEnv": "OPENAI_WORK_KEY",
      "timeoutMs": 90000
    }
  }
}
```

An account may override `baseUrl` and `timeoutMs`. API keys remain environment-variable references only. Raw secrets are rejected by the strict binding parser and never appear in dashboard payloads.

## Compatibility

Routing and binding version 1 remain accepted. Tony Router normalizes every v1 provider into one implicit account with the same ID, so existing Phase 4 deployments continue to work unchanged.

Successful routed responses expose:

- `x-tony-router-provider`: adapter/provider ID
- `x-tony-router-account`: selected credential account ID
- `x-tony-router-route`: selected route ID
- `x-tony-router-attempts`: bounded attempt count
