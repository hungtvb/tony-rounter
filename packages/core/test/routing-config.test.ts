import { describe, expect, it } from 'vitest';

import { parseRoutingConfig, RoutingConfigError } from '../src/index.js';

const VALID_CONFIG = `
version: 1
defaultProfile: coding
providers:
  primary:
    kind: openai-compatible
models:
  capable:
    provider: primary
    upstreamModel: capable-model
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: true
      structuredOutput: true
      contextTokens: 128000
routes:
  primary-route:
    model: capable
    enabled: true
    priority: 10
profiles:
  coding:
    routes:
      - route: primary-route
        priority: 100
`;

describe('parseRoutingConfig', () => {
  it('parses and freezes a valid versioned registry', () => {
    const config = parseRoutingConfig(VALID_CONFIG);

    expect(config).toMatchObject({
      version: 1,
      defaultProfileId: 'coding',
      providers: {
        primary: { id: 'primary', kind: 'openai-compatible' },
      },
      accounts: {
        primary: { id: 'primary', providerId: 'primary' },
      },
      models: {
        capable: {
          id: 'capable',
          providerId: 'primary',
          upstreamModel: 'capable-model',
        },
      },
      routes: {
        'primary-route': {
          id: 'primary-route',
          modelId: 'capable',
          accountId: 'primary',
          enabled: true,
          priority: 10,
        },
      },
      profiles: {
        coding: {
          id: 'coding',
          routes: [{ routeId: 'primary-route', priority: 100 }],
        },
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.getPrototypeOf(config.providers)).toBeNull();
  });

  it('rejects duplicate YAML keys', () => {
    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('version: 1', 'version: 1\nversion: 1'),
      ),
    ).toThrow(RoutingConfigError);
  });

  it('rejects aliases to avoid expansion and hidden shared state', () => {
    const source = VALID_CONFIG.replace(
      'providers:\n  primary:',
      'providers:\n  primary: &provider',
    ).replace(
      'models:\n  capable:',
      'models:\n  copied: *provider\n  capable:',
    );

    expect(() => parseRoutingConfig(source)).toThrow(RoutingConfigError);
  });

  it('rejects unknown critical fields', () => {
    expect(() =>
      parseRoutingConfig(`${VALID_CONFIG}\nunknownRoot: true\n`),
    ).toThrow(/unknownRoot/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace(
          'kind: openai-compatible',
          'kind: openai-compatible\n    secretField: nope',
        ),
      ),
    ).toThrow(/secretField/);
  });

  it('rejects unsupported versions and provider kinds', () => {
    expect(() =>
      parseRoutingConfig(VALID_CONFIG.replace('version: 1', 'version: 3')),
    ).toThrow(/must equal 1 or 2/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('openai-compatible', 'anthropic'),
      ),
    ).toThrow(/openai-compatible/);
  });

  it('rejects dangling provider, model, route, and profile references', () => {
    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('provider: primary', 'provider: missing'),
      ),
    ).toThrow(/unknown provider missing/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('model: capable', 'model: missing'),
      ),
    ).toThrow(/unknown model missing/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('route: primary-route', 'route: missing'),
      ),
    ).toThrow(/unknown route missing/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace(
          'defaultProfile: coding',
          'defaultProfile: missing',
        ),
      ),
    ).toThrow(/unknown profile missing/);
  });

  it('rejects duplicate routes within a profile', () => {
    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace(
          '      - route: primary-route\n        priority: 100',
          '      - route: primary-route\n        priority: 100\n      - route: primary-route\n        priority: 50',
        ),
      ),
    ).toThrow(/duplicate route primary-route/);
  });

  it('rejects invalid capability combinations and context limits', () => {
    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace(
          'tools: true\n      parallelToolCalls: true',
          'tools: false\n      parallelToolCalls: true',
        ),
      ),
    ).toThrow(/parallelToolCalls requires tools=true/);

    expect(() =>
      parseRoutingConfig(
        VALID_CONFIG.replace('contextTokens: 128000', 'contextTokens: 0'),
      ),
    ).toThrow(/between 1 and 10000000/);
  });

  it('rejects empty and oversized sources', () => {
    expect(() => parseRoutingConfig('')).toThrow(/source is empty/);
    expect(() => parseRoutingConfig('x'.repeat(1024 * 1024 + 1))).toThrow(
      /1 MiB/,
    );
  });
});
