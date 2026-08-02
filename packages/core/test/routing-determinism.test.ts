import { describe, expect, it } from 'vitest';

import { parseRoutingConfig, selectRoute } from '../src/index.js';

const CONFIG = parseRoutingConfig(`
version: 1
defaultProfile: default
providers:
  provider:
    kind: openai-compatible
models:
  model:
    provider: provider
    upstreamModel: upstream
    capabilities:
      tools: false
      parallelToolCalls: false
      vision: false
      structuredOutput: false
      contextTokens: 8000
routes:
  a-route:
    model: model
    priority: 0
  B-route:
    model: model
    priority: 0
profiles:
  default:
    routes:
      - route: a-route
        priority: 0
      - route: B-route
        priority: 0
`);

const REQUIREMENTS = {
  tools: false,
  parallelToolCalls: false,
  vision: false,
  structuredOutput: false,
} as const;

describe('routing determinism hardening', () => {
  it('uses code-unit route ordering rather than locale-sensitive collation', () => {
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: REQUIREMENTS,
    });

    expect(decision.candidates.map((candidate) => candidate.routeId)).toEqual([
      'B-route',
      'a-route',
    ]);
    expect(decision.selected?.routeId).toBe('B-route');
  });

  it('returns an immutable snapshot independent from caller mutation', () => {
    const mutableRequirements: {
      tools: boolean;
      parallelToolCalls: boolean;
      vision: boolean;
      structuredOutput: boolean;
    } = { ...REQUIREMENTS };
    const decision = selectRoute(CONFIG, {
      requiredCapabilities: mutableRequirements,
    });

    mutableRequirements.tools = true;

    expect(decision.requiredCapabilities.tools).toBe(false);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.requiredCapabilities)).toBe(true);
    expect(Object.isFrozen(decision.candidates)).toBe(true);
    expect(Object.isFrozen(decision.candidates[0])).toBe(true);
    expect(Object.isFrozen(decision.candidates[0]?.rejections)).toBe(true);
  });
});
