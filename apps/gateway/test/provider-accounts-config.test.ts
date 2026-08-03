import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGatewayRouterConfig } from '../src/routing/config.js';

const directories: string[] = [];

const ROUTING_YAML = `version: 2
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
  work-route:
    model: gpt
    account: work
profiles:
  tony-auto:
    routes:
      - route: personal-route
      - route: work-route
`;

async function configFiles(binding: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'tony-router-accounts-'));
  directories.push(directory);
  const routingPath = join(directory, 'routing.yaml');
  const providerPath = join(directory, 'providers.json');
  await Promise.all([
    writeFile(routingPath, ROUTING_YAML),
    writeFile(providerPath, JSON.stringify(binding)),
  ]);
  return { routingPath, providerPath };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('provider account configuration', () => {
  it('loads two credentials under one provider with account overrides', async () => {
    const paths = await configFiles({
      version: 2,
      providers: {
        openai: {
          baseUrl: 'https://api.openai.example/v1',
          timeoutMs: 5000,
        },
      },
      accounts: {
        personal: {
          provider: 'openai',
          apiKeyEnv: 'OPENAI_PERSONAL_KEY',
        },
        work: {
          provider: 'openai',
          baseUrl: 'https://work-gateway.example/v1',
          apiKeyEnv: 'OPENAI_WORK_KEY',
          timeoutMs: 9000,
        },
      },
    });

    const config = await loadGatewayRouterConfig({
      env: {
        TONY_ROUTER_ROUTING_CONFIG_FILE: paths.routingPath,
        TONY_ROUTER_PROVIDER_CONFIG_FILE: paths.providerPath,
        OPENAI_PERSONAL_KEY: 'personal-secret',
        OPENAI_WORK_KEY: 'work-secret',
      },
    });

    expect(config?.providers.openai).toEqual({
      baseUrl: 'https://api.openai.example/v1',
      timeoutMs: 5000,
    });
    expect(config?.accounts?.personal).toEqual({
      providerId: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'personal-secret',
      timeoutMs: 5000,
    });
    expect(config?.accounts?.work).toEqual({
      providerId: 'openai',
      baseUrl: 'https://work-gateway.example/v1',
      apiKey: 'work-secret',
      timeoutMs: 9000,
    });
  });

  it('rejects raw credentials and mismatched account providers', async () => {
    const rawSecret = await configFiles({
      version: 2,
      providers: {
        openai: { baseUrl: 'https://api.example.test' },
      },
      accounts: {
        personal: { provider: 'openai', apiKey: 'not-allowed' },
        work: { provider: 'openai' },
      },
    });
    await expect(
      loadGatewayRouterConfig({
        env: {
          TONY_ROUTER_ROUTING_CONFIG_FILE: rawSecret.routingPath,
          TONY_ROUTER_PROVIDER_CONFIG_FILE: rawSecret.providerPath,
        },
      }),
    ).rejects.toThrow(/unknown field.*apiKey/i);

    const wrongProvider = await configFiles({
      version: 2,
      providers: {
        openai: { baseUrl: 'https://api.example.test' },
      },
      accounts: {
        personal: { provider: 'other' },
        work: { provider: 'openai' },
      },
    });
    await expect(
      loadGatewayRouterConfig({
        env: {
          TONY_ROUTER_ROUTING_CONFIG_FILE: wrongProvider.routingPath,
          TONY_ROUTER_PROVIDER_CONFIG_FILE: wrongProvider.providerPath,
        },
      }),
    ).rejects.toThrow(/must equal routing provider openai/);
  });
});
