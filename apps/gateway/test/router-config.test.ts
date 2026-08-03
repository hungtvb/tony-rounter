import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GatewayRouterConfigError,
  loadGatewayRouterConfig,
} from '../src/routing/config.js';

const directories: string[] = [];

const ROUTING_YAML = `version: 1
defaultProfile: tony-auto
providers:
  primary:
    kind: openai-compatible
models:
  primary-model:
    provider: primary
    upstreamModel: vendor-model
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: false
      structuredOutput: true
      contextTokens: 128000
routes:
  primary-route:
    model: primary-model
    priority: 10
profiles:
  tony-auto:
    routes:
      - route: primary-route
        priority: 10
`;

async function files(providerJson: unknown): Promise<{
  readonly routingPath: string;
  readonly providerPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'tony-router-config-'));
  directories.push(directory);
  const routingPath = join(directory, 'routing.yaml');
  const providerPath = join(directory, 'providers.json');
  await Promise.all([
    writeFile(routingPath, ROUTING_YAML),
    writeFile(providerPath, JSON.stringify(providerJson)),
  ]);
  return { routingPath, providerPath };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('gateway routed provider configuration', () => {
  it('loads strict routing and resolves API keys through environment names', async () => {
    const paths = await files({
      version: 1,
      providers: {
        primary: {
          baseUrl: 'https://api.example.test/v1',
          apiKeyEnv: 'PRIMARY_API_KEY',
          timeoutMs: 1234,
        },
      },
    });

    const config = await loadGatewayRouterConfig({
      env: {
        TONY_ROUTER_ROUTING_CONFIG_FILE: paths.routingPath,
        TONY_ROUTER_PROVIDER_CONFIG_FILE: paths.providerPath,
        PRIMARY_API_KEY: 'secret-key',
      },
    });

    expect(config?.registry.defaultProfileId).toBe('tony-auto');
    expect(config?.providers.primary).toEqual({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'secret-key',
      timeoutMs: 1234,
    });
  });

  it('rejects raw API keys in provider binding files', async () => {
    const paths = await files({
      version: 1,
      providers: {
        primary: {
          baseUrl: 'https://api.example.test',
          apiKey: 'must-not-live-in-file',
        },
      },
    });

    await expect(
      loadGatewayRouterConfig({
        env: {
          TONY_ROUTER_ROUTING_CONFIG_FILE: paths.routingPath,
          TONY_ROUTER_PROVIDER_CONFIG_FILE: paths.providerPath,
        },
      }),
    ).rejects.toThrow(/unknown field.*apiKey/i);
  });

  it('rejects missing referenced secret environment variables', async () => {
    const paths = await files({
      version: 1,
      providers: {
        primary: {
          baseUrl: 'https://api.example.test',
          apiKeyEnv: 'MISSING_KEY',
        },
      },
    });

    await expect(
      loadGatewayRouterConfig({
        env: {
          TONY_ROUTER_ROUTING_CONFIG_FILE: paths.routingPath,
          TONY_ROUTER_PROVIDER_CONFIG_FILE: paths.providerPath,
        },
      }),
    ).rejects.toThrow(/missing environment variable MISSING_KEY/);
  });

  it('requires both routed config files and forbids mixing legacy mode', async () => {
    await expect(
      loadGatewayRouterConfig({
        env: { TONY_ROUTER_ROUTING_CONFIG_FILE: '/tmp/routing.yaml' },
      }),
    ).rejects.toBeInstanceOf(GatewayRouterConfigError);

    const paths = await files({
      version: 1,
      providers: {
        primary: { baseUrl: 'https://api.example.test' },
      },
    });
    await expect(
      loadGatewayRouterConfig({
        env: {
          TONY_ROUTER_ROUTING_CONFIG_FILE: paths.routingPath,
          TONY_ROUTER_PROVIDER_CONFIG_FILE: paths.providerPath,
          TONY_ROUTER_UPSTREAM_BASE_URL: 'https://legacy.example.test',
        },
      }),
    ).rejects.toThrow(/cannot be mixed/);
  });
});
