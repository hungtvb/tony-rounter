import { readFile } from 'node:fs/promises';

import {
  parseRoutingConfig,
  type CircuitBreakerConfig,
  type FallbackPolicy,
  type RoutingConfig,
} from '@tony-router/core';

const MAX_CONFIG_BYTES = 1024 * 1024;
const LOCAL_UPSTREAM_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const API_KEY_ENV_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface RoutedProviderConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

export interface GatewayRouterConfig {
  readonly registry: RoutingConfig;
  readonly providers: Readonly<Record<string, RoutedProviderConfig>>;
  readonly fallbackPolicy: FallbackPolicy;
  readonly circuitBreaker: CircuitBreakerConfig;
}

export interface LoadGatewayRouterConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

export class GatewayRouterConfigError extends Error {
  override readonly name = 'GatewayRouterConfigError';

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options);
  }
}

function fail(message: string): never {
  throw new GatewayRouterConfigError(message);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function allowedKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    fail(`${path} contains unknown field(s): ${unknown.sort().join(', ')}`);
  }
}

function boundedInteger(
  value: unknown,
  path: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return fail(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeBaseUrl(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(`${path} must be a string`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(`${path} must be an absolute URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail(`${path} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash) {
    return fail(`${path} must not contain credentials, query, or fragment`);
  }
  if (
    url.protocol !== 'https:' &&
    !LOCAL_UPSTREAM_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return fail(`${path} must use https unless it targets loopback development`);
  }
  return url.toString().replace(/\/$/, '');
}

function apiKeyEnvironmentName(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !API_KEY_ENV_PATTERN.test(value)) {
    return fail(`${path} must name an environment variable using ${API_KEY_ENV_PATTERN}`);
  }
  return value;
}

function apiKeyFromEnvironment(
  env: NodeJS.ProcessEnv,
  environmentName: string | undefined,
  path: string,
): string | undefined {
  if (!environmentName) return undefined;
  const value = env[environmentName]?.trim();
  if (!value) return fail(`${path} references missing environment variable ${environmentName}`);
  if (value.length > 2048 || /\s/.test(value)) {
    return fail(`${environmentName} must contain 1 to 2048 non-whitespace characters`);
  }
  return value;
}

function frozenRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  const output = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) output[key] = value;
  return Object.freeze(output);
}

function parseProviderBindings(
  source: string,
  routing: RoutingConfig,
  env: NodeJS.ProcessEnv,
): Readonly<Record<string, RoutedProviderConfig>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail('Provider binding file must contain valid JSON');
  }

  const root = record(parsed, 'root');
  allowedKeys(root, ['version', 'providers'], 'root');
  if (root.version !== 1) fail('root.version must equal 1');

  const providers = record(root.providers, 'root.providers');
  const entries = Object.entries(providers).map(([providerId, rawProvider]) => {
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      fail(`root.providers.${providerId} is not a valid provider ID`);
    }
    if (!(providerId in routing.providers)) {
      fail(`root.providers.${providerId} is not declared in the routing registry`);
    }

    const provider = record(rawProvider, `root.providers.${providerId}`);
    allowedKeys(
      provider,
      ['baseUrl', 'apiKeyEnv', 'timeoutMs'],
      `root.providers.${providerId}`,
    );
    const apiKeyEnv = apiKeyEnvironmentName(
      provider.apiKeyEnv,
      `root.providers.${providerId}.apiKeyEnv`,
    );
    const apiKey = apiKeyFromEnvironment(
      env,
      apiKeyEnv,
      `root.providers.${providerId}.apiKeyEnv`,
    );
    return [
      providerId,
      Object.freeze({
        baseUrl: normalizeBaseUrl(
          provider.baseUrl,
          `root.providers.${providerId}.baseUrl`,
        ),
        ...(apiKey !== undefined ? { apiKey } : {}),
        timeoutMs: boundedInteger(
          provider.timeoutMs,
          `root.providers.${providerId}.timeoutMs`,
          DEFAULT_UPSTREAM_TIMEOUT_MS,
          10,
          10 * 60_000,
        ),
      }),
    ] as const;
  });

  for (const providerId of Object.keys(routing.providers)) {
    if (!Object.prototype.hasOwnProperty.call(providers, providerId)) {
      fail(`Provider binding file is missing routing provider ${providerId}`);
    }
  }
  return frozenRecord(entries);
}

async function readBoundedFile(path: string, label: string): Promise<string> {
  let value: string;
  try {
    value = await readFile(path, 'utf8');
  } catch (error) {
    throw new GatewayRouterConfigError(`Unable to read ${label} at ${path}`, {
      cause: error,
    });
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_CONFIG_BYTES) {
    fail(`${label} exceeds the 1 MiB safety limit`);
  }
  return value;
}

export async function loadGatewayRouterConfig(
  options: LoadGatewayRouterConfigOptions = {},
): Promise<GatewayRouterConfig | undefined> {
  const env = options.env ?? process.env;
  const routingPath = env.TONY_ROUTER_ROUTING_CONFIG_FILE;
  const providersPath = env.TONY_ROUTER_PROVIDER_CONFIG_FILE;

  if (!routingPath && !providersPath) return undefined;
  if (!routingPath || !providersPath) {
    fail(
      'TONY_ROUTER_ROUTING_CONFIG_FILE and TONY_ROUTER_PROVIDER_CONFIG_FILE must be configured together',
    );
  }
  if (
    env.TONY_ROUTER_UPSTREAM_BASE_URL !== undefined ||
    env.TONY_ROUTER_UPSTREAM_API_KEY !== undefined ||
    env.TONY_ROUTER_UPSTREAM_TIMEOUT_MS !== undefined
  ) {
    fail('Legacy TONY_ROUTER_UPSTREAM_* settings cannot be mixed with routed mode');
  }

  const [routingSource, providerSource] = await Promise.all([
    readBoundedFile(routingPath, 'routing configuration'),
    readBoundedFile(providersPath, 'provider binding configuration'),
  ]);
  const registry = parseRoutingConfig(routingSource);
  const providers = parseProviderBindings(providerSource, registry, env);

  return Object.freeze({
    registry,
    providers,
    fallbackPolicy: Object.freeze({
      maxAttemptsPerRoute: 2,
      maxTotalAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      totalDeadlineMs: 30_000,
    }),
    circuitBreaker: Object.freeze({
      failureThreshold: 3,
      cooldownMs: 30_000,
      halfOpenMaxAttempts: 1,
    }),
  });
}

export function routerSensitiveValues(
  config: GatewayRouterConfig | undefined,
): readonly string[] {
  return Object.freeze(
    Object.values(config?.providers ?? {})
      .map((provider) => provider.apiKey)
      .filter((value): value is string => value !== undefined),
  );
}
