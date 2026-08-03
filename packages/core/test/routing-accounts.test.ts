import { describe, expect, it } from 'vitest';

import { parseRoutingConfig, selectRoute } from '../src/index.js';

const VERSION_TWO = `
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
        priority: 20
      - route: work-route
        priority: 10
`;

const REQUIREMENTS = {
  tools: false,
  parallelToolCalls: false,
  vision: false,
  structuredOutput: false,
} as const;

describe('provider accounts routing schema', () => {
  it('routes two accounts through one provider and one model catalog entry', () => {
    const config = parseRoutingConfig(VERSION_TWO);
    const decision = selectRoute(config, {
      requiredCapabilities: REQUIREMENTS,
    });

    expect(config.version).toBe(2);
    expect(config.providers).toHaveProperty('openai');
    expect(config.accounts).toMatchObject({
      personal: { id: 'personal', providerId: 'openai' },
      work: { id: 'work', providerId: 'openai' },
    });
    expect(decision.selected).toMatchObject({
      routeId: 'personal-route',
      providerId: 'openai',
      accountId: 'personal',
      modelId: 'gpt',
      upstreamModel: 'gpt-5',
    });
    expect(decision.candidates.map((candidate) => candidate.accountId)).toEqual([
      'personal',
      'work',
    ]);
  });

  it('normalizes version 1 providers into implicit same-ID accounts', () => {
    const config = parseRoutingConfig(`
version: 1
defaultProfile: default
providers:
  legacy:
    kind: openai-compatible
models:
  model:
    provider: legacy
    upstreamModel: upstream
    capabilities:
      tools: false
      parallelToolCalls: false
      vision: false
      structuredOutput: false
      contextTokens: 8000
routes:
  route:
    model: model
profiles:
  default:
    routes:
      - route: route
`);

    expect(config.accounts.legacy).toEqual({
      id: 'legacy',
      providerId: 'legacy',
    });
    expect(config.routes.route?.accountId).toBe('legacy');
  });

  it('rejects accounts that do not belong to the model provider', () => {
    expect(() =>
      parseRoutingConfig(
        VERSION_TWO.replace(
          'providers:\n  openai:\n    kind: openai-compatible',
          'providers:\n  openai:\n    kind: openai-compatible\n  other:\n    kind: openai-compatible',
        ).replace('work:\n    provider: openai', 'work:\n    provider: other'),
      ),
    ).toThrow(/belongs to provider other.*model gpt belongs to provider openai/);
  });

  it('requires explicit accounts and route account references in version 2', () => {
    expect(() =>
      parseRoutingConfig(VERSION_TWO.replace(/accounts:[\s\S]*?models:/, 'models:')),
    ).toThrow(/accounts/);
    expect(() =>
      parseRoutingConfig(VERSION_TWO.replace('    account: personal\n', '')),
    ).toThrow(/routes\.personal-route\.account/);
  });
});
