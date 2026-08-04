import { describe, expect, it } from 'vitest';

import {
  InMemorySessionAffinityStore,
  parseRoutingConfig,
  RoutingEngine,
  RoutingSelectionError,
  selectRoute,
  type RouteCandidateTrace,
  type RouteRejectionCode,
} from '../src/index.js';

const CONFIG = parseRoutingConfig(`
version: 1
defaultProfile: coding
providers:
  provider:
    kind: openai-compatible
models:
  full:
    provider: provider
    upstreamModel: full-model
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      fileInput: true
      reasoning: true
      contextTokens: 128000
  limited:
    provider: provider
    upstreamModel: limited-model
    capabilities:
      tools: false
      parallelToolCalls: false
      vision: false
      structuredOutput: false
      contextTokens: 8000
  context64:
    provider: provider
    upstreamModel: context-model
    capabilities:
      tools: true
      parallelToolCalls: false
      vision: false
      structuredOutput: true
      contextTokens: 64000
routes:
  alpha:
    model: full
    priority: 10
  beta:
    model: full
    priority: 10
  cheap:
    model: limited
    priority: 100
  context:
    model: context64
    priority: 20
  disabled:
    model: full
    enabled: false
    priority: 1000
  outside:
    model: full
    priority: 999
profiles:
  coding:
    routes:
      - route: alpha
        priority: 50
      - route: beta
        priority: 50
      - route: cheap
        priority: 100
      - route: context
        priority: 90
      - route: disabled
        priority: 200
  review:
    routes:
      - route: beta
        priority: 10
`);

const NO_REQUIREMENTS = {
  tools: false,
  parallelToolCalls: false,
  vision: false,
  structuredOutput: false,
} as const;

function candidate(
  candidates: readonly RouteCandidateTrace[],
  routeId: string,
): RouteCandidateTrace {
  const found = candidates.find((entry) => entry.routeId === routeId);
  if (!found) throw new Error(`Missing candidate ${routeId}`);
  return found;
}

function rejectionCodes(
  routeCandidate: RouteCandidateTrace,
): readonly RouteRejectionCode[] {
  return routeCandidate.rejections.map((rejection) => rejection.code);
}

describe('selectRoute', () => {
  it('never allows an incompatible high-priority route to win', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: {
        ...NO_REQUIREMENTS,
        tools: true,
        structuredOutput: true,
      },
    });

    expect(decision.selected).toMatchObject({
      routeId: 'context',
      upstreamModel: 'context-model',
      affinityRetained: false,
    });
    const cheap = candidate(decision.candidates, 'cheap');
    expect(cheap.accepted).toBe(false);
    expect(cheap.rejections).toEqual([
      { code: 'missing_tools', required: true, actual: false },
      {
        code: 'missing_structured_output',
        required: true,
        actual: false,
      },
    ]);
  });

  it('routes file input only to a file-capable model', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: { ...NO_REQUIREMENTS, fileInput: true },
    });

    expect(decision.selected?.routeId).toBe('alpha');
    expect(candidate(decision.candidates, 'context')).toMatchObject({
      accepted: false,
      rejections: [
        { code: 'missing_file_input', required: true, actual: false },
      ],
    });
  });

  it('accepts exact context boundaries and rejects one token beyond them', () => {
    const exact = selectRoute(CONFIG, {
      requiredCapabilities: {
        ...NO_REQUIREMENTS,
        tools: true,
        minimumContextTokens: 64_000,
      },
    });
    expect(exact.selected?.routeId).toBe('context');

    const beyond = selectRoute(CONFIG, {
      requiredCapabilities: {
        ...NO_REQUIREMENTS,
        tools: true,
        minimumContextTokens: 64_001,
      },
    });
    expect(beyond.selected?.routeId).toBe('alpha');
    expect(candidate(beyond.candidates, 'context')).toMatchObject({
      accepted: false,
      rejections: [
        {
          code: 'insufficient_context',
          required: 64_001,
          actual: 64_000,
        },
      ],
    });
  });

  it('uses profile priority, route priority, then lexical route ID', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: {
        ...NO_REQUIREMENTS,
        tools: true,
        vision: true,
      },
    });

    expect(decision.selected?.routeId).toBe('alpha');
    expect(decision.selected?.score).toEqual({
      profilePriority: 50,
      routePriority: 10,
    });
  });

  it('retains an accepted affine route even when another route scores higher', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: NO_REQUIREMENTS,
      affinityRouteId: 'alpha',
    });

    expect(decision.selected).toMatchObject({
      routeId: 'alpha',
      affinityRetained: true,
    });
  });

  it('drops unhealthy, unavailable, disabled, or incompatible affinity', () => {
    const unhealthy = selectRoute(CONFIG, {
      requiredCapabilities: NO_REQUIREMENTS,
      affinityRouteId: 'alpha',
      routeStates: { alpha: { healthy: false } },
    });
    expect(unhealthy.selected?.routeId).toBe('cheap');
    expect(unhealthy.selected?.affinityRetained).toBe(false);

    const unavailable = selectRoute(CONFIG, {
      requiredCapabilities: NO_REQUIREMENTS,
      affinityRouteId: 'alpha',
      routeStates: { alpha: { available: false } },
    });
    expect(unavailable.selected?.routeId).toBe('cheap');

    const disabled = selectRoute(CONFIG, {
      requiredCapabilities: NO_REQUIREMENTS,
      affinityRouteId: 'disabled',
    });
    expect(disabled.selected?.routeId).toBe('cheap');

    const incompatible = selectRoute(CONFIG, {
      requiredCapabilities: { ...NO_REQUIREMENTS, vision: true },
      affinityRouteId: 'cheap',
    });
    expect(incompatible.selected?.routeId).toBe('alpha');
  });

  it('records machine-readable reasons for every configured route', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: {
        tools: true,
        parallelToolCalls: true,
        vision: true,
        structuredOutput: true,
        reasoning: true,
        minimumContextTokens: 100_000,
      },
      routeStates: {
        alpha: { healthy: false },
        beta: { available: false },
      },
    });

    expect(decision.candidates.map((entry) => entry.routeId)).toEqual([
      'alpha',
      'beta',
      'cheap',
      'context',
      'disabled',
      'outside',
    ]);
    expect(rejectionCodes(candidate(decision.candidates, 'outside'))).toEqual([
      'not_in_profile',
    ]);
    expect(
      rejectionCodes(candidate(decision.candidates, 'disabled')),
    ).toContain('route_disabled');
    expect(rejectionCodes(candidate(decision.candidates, 'alpha'))).toEqual([
      'route_unhealthy',
    ]);
    expect(rejectionCodes(candidate(decision.candidates, 'beta'))).toEqual([
      'route_unavailable',
    ]);
    expect(candidate(decision.candidates, 'context').rejections).toEqual([
      { code: 'missing_parallel_tool_calls', required: true, actual: false },
      { code: 'missing_vision', required: true, actual: false },
      { code: 'missing_reasoning', required: true, actual: false },
      { code: 'insufficient_context', required: 100_000, actual: 64_000 },
    ]);
  });

  it('returns no selected route when every candidate is rejected', () => {
    const decision = selectRoute(CONFIG, {
      profileId: 'review',
      requiredCapabilities: NO_REQUIREMENTS,
      routeStates: { beta: { healthy: false } },
    });

    expect(decision.selected).toBeUndefined();
    expect(decision.candidates.every((entry) => !entry.accepted)).toBe(true);
  });

  it('is deterministic for identical config, requirements, and state', () => {
    const input = {
      requiredCapabilities: { ...NO_REQUIREMENTS, tools: true },
      routeStates: { context: { healthy: true, available: true } },
    } as const;

    expect(selectRoute(CONFIG, input)).toEqual(selectRoute(CONFIG, input));
  });

  it('rejects unknown profiles instead of silently falling back', () => {
    expect(() =>
      selectRoute(CONFIG, {
        profileId: 'missing',
        requiredCapabilities: NO_REQUIREMENTS,
      }),
    ).toThrow(RoutingSelectionError);
  });
});

describe('RoutingEngine session affinity', () => {
  it('remembers the selected route and retains it on the next request', () => {
    const store = new InMemorySessionAffinityStore(10);
    const engine = new RoutingEngine(CONFIG, store);

    const first = engine.select({
      sessionId: 'session-1',
      requiredCapabilities: NO_REQUIREMENTS,
    });
    expect(first.selected?.routeId).toBe('cheap');

    const second = engine.select({
      sessionId: 'session-1',
      requiredCapabilities: { ...NO_REQUIREMENTS, tools: true },
    });
    expect(second.selected?.routeId).toBe('context');
    expect(second.selected?.affinityRetained).toBe(false);

    const third = engine.select({
      sessionId: 'session-1',
      requiredCapabilities: { ...NO_REQUIREMENTS, tools: true, vision: true },
    });
    expect(third.selected?.routeId).toBe('alpha');
    expect(store.get('session-1')).toBe('alpha');
  });

  it('evicts the least recently used session when bounded capacity is reached', () => {
    const store = new InMemorySessionAffinityStore(2);
    store.remember('one', 'alpha');
    store.remember('two', 'beta');
    expect(store.get('one')).toBe('alpha');
    store.remember('three', 'cheap');

    expect(store.get('two')).toBeUndefined();
    expect(store.get('one')).toBe('alpha');
    expect(store.get('three')).toBe('cheap');
  });

  it('rejects invalid affinity store capacity and identifiers', () => {
    expect(() => new InMemorySessionAffinityStore(0)).toThrow(RangeError);
    const store = new InMemorySessionAffinityStore();
    expect(() => store.remember(' ', 'alpha')).toThrow(RangeError);
    expect(() => store.remember('session', '')).toThrow(RangeError);
  });
});
