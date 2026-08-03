# Multi-provider gateway

Tony Router can run in routed mode by combining two configuration files:

- `TONY_ROUTER_ROUTING_CONFIG_FILE` points to the versioned routing YAML parsed by `@tony-router/core`.
- `TONY_ROUTER_PROVIDER_CONFIG_FILE` points to a strict JSON provider-binding file.

Provider bindings contain base URLs, timeout values, and optional `apiKeyEnv` references. Raw API keys are rejected from the file; the referenced environment variable holds the secret.

```json
{
  "version": 1,
  "providers": {
    "primary": {
      "baseUrl": "https://api.example.com/v1",
      "apiKeyEnv": "PRIMARY_API_KEY",
      "timeoutMs": 60000
    }
  }
}
```

In routed mode, OpenAI-compatible `model` values are routing profile IDs such as `tony-auto`. The selected route rewrites that public profile to its configured upstream model. JSON responses and SSE chunks are normalized back to the public profile ID so upstream model IDs remain internal.

Ambiguous failures such as timeout, connection failure, or upstream 5xx are not replayed by default. Clients must explicitly send `x-tony-router-replay-safe: true` to authorize fallback after a failure that may have processed the request. Authentication, configuration, and rate-limit rejection can fall back before output without that header.

`x-tony-router-session` enables bounded in-process route affinity. Successful responses include `x-tony-router-route`, `x-tony-router-provider`, and `x-tony-router-attempts` headers.

Streaming fallback is limited to failures detected before the first accepted SSE event. Once output is visible, the stream is never replayed from another provider.
