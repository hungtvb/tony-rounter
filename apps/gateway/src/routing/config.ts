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
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface RoutedProviderConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

export interface RoutedAccountConfig extends RoutedProviderConfig {
  readonly providerId: string;
  readonly apiKey?: string;
}

export interface GatewayRouterConfig {
  readonly registry: RoutingConfig;
  readonly providers: Readonly<Record<string, RoutedProviderConfig>>;
  readonly accounts?: Readonly<Record<string, RoutedAccountConfig>>;
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

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return fail(`${path} must be a valid identifier`);
  }
  return value;
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
    return fail(
      `${path} must use https unless it targets loopback development`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

function apiKeyEnvironmentName(
  value: unknown,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !API_KEY_ENV_PATTERN.test(value)) {
    return fail(
      `${path} must name an environment variable using ${API_KEY_ENV_PATTERN}`,
    );
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
  if (!value) {
    return fail(
      `${path} references missing environment variable ${environmentName}`,
    );
  }
  if (value.length > 2048 || /\s/.test(value)) {
    return fail(
      `${environmentName} must contain 1 to 2048 non-whitespace characters`,
    );
  }
  return value;
}

function frozenRecord<T>(
  entries: readonly (readonly [string, T])[],
): Readonly<Record<string, T>> {
  const output = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) output[key] = value;
  return Object.freeze(output);
}

function ensureExactRegistry(
  label: string,
  itemLabel: string,
  configured: UnknownRecord,
  expectedIds: readonly string[],
): void {
  for (const id of expectedIds) {
    if (!Object.prototype.hasOwnProperty.call(configured, id)) {
      fail(`${label} is missing routing ${itemLabel} ${id}`);
    }
  }
  for (const id of Object.keys(configured)) {
    if (!expectedIds.includes(id)) {
      fail(`${label}.${id} is not declared in the routing registry`);
    }
  }
}

function parseProviderDefaults(
  value: unknown,
  routing: RoutingConfig,
): Readonly<Record<string, RoutedProviderConfig>> {
  const providers = record(value, 'root.providers');
  ensureExactRegistry(
    'root.providers',
    'provider',
    providers,
    Object.keys(routing.providers),
  );

  return frozenRecord(
    Object.entries(providers).map(([providerId, rawProvider]) => {
      identifier(providerId, `root.providers.${providerId}`);
      const provider = record(rawProvider, `root.providers.${providerId}`);
      allowedKeys(
        provider,
        ['baseUrl', 'timeoutMs'],
        `root.providers.${providerId}`,
      );
      return [
        providerId,
        Object.freeze({
          baseUrl: normalizeBaseUrl(
            provider.baseUrl,
            `root.providers.${providerId}.baseUrl`,
          ),
          timeoutMs: boundedInteger(
            provider.timeoutMs,
            `root.providers.${providerId}.timeoutMs`,
            DEFAULT_UPSTREAM_TIMEOUT_MS,
            10,
            10 * 60_000,
          ),
        }),
      ] as const;
    }),
  );
}

function parseVersionOneBindings(
  root: UnknownRecord,
  routing: RoutingConfig,
  env: NodeJS.ProcessEnv,
): {
  readonly providers: Readonly<Record<string, RoutedProviderConfig>>;
  readonly accounts: Readonly<Record<string, RoutedAccountConfig>>;
} {
  allowedKeys(root, ['version', 'providers'], 'root');
  const rawProviders = record(root.providers, 'root.providers');
  ensureExactRegistry(
    'root.providers',
    'provider',
    rawProviders,
    Object.keys(routing.providers),
  );

  const providers: Array<readonly [string, RoutedProviderConfig]> = [];
  const accounts: Array<readonly [string, RoutedAccountConfig]> = [];
  for (const [providerId, rawProvider] of Object.entries(rawProviders)) {
    const provider = record(rawProvider, `root.providers.${providerId}`);
    allowedKeys(
      provider,
      ['baseUrl', 'apiKeyEnv', 'timeoutMs'],
      `root.providers.${providerId}`,
    );
    const baseUrl = normalizeBaseUrl(
      provider.baseUrl,
      `root.providers.${providerId}.baseUrl`,
    );
    const timeoutMs = boundedInteger(
      provider.timeoutMs,
      `root.providers.${providerId}.timeoutMs`,
      DEFAULT_UPSTREAM_TIMEOUT_MS,
      10,
      10 * 60_000,
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
    providers.push([
      providerId,
      Object.freeze({
        baseUrl,
        timeoutMs,
        ...(apiKey !== undefined ? { apiKey } : {}),
      }),
    ]);
    accounts.push([
      providerId,
      Object.freeze({
        providerId,
        baseUrl,
        timeoutMs,
        ...(apiKey !== undefined ? { apiKey } : {}),
      }),
    ]);
  }
  return {
    providers: frozenRecord(providers),
    accounts: frozenRecord(accounts),
  };
}

function parseVersionTwoBindings(
  root: UnknownRecord,
  routing: RoutingConfig,
  env: NodeJS.ProcessEnv,
): {
  readonly providers: Readonly<Record<string, RoutedProviderConfig>>;
  readonly accounts: Readonly<Record<string, RoutedAccountConfig>>;
} {
  allowedKeys(root, ['version', 'providers', 'accounts'], 'root');
  const providers = parseProviderDefaults(root.providers, routing);
  const rawAccounts = record(root.accounts, 'root.accounts');
  ensureExactRegistry(
    'root.accounts',
    'account',
    rawAccounts,
    Object.keys(routing.accounts),
  );

  const accounts = frozenRecord(
    Object.entries(rawAccounts).map(([accountId, rawAccount]) => {
      identifier(accountId, `root.accounts.${accountId}`);
      const account = record(rawAccount, `root.accounts.${accountId}`);
      allowedKeys(
        account,
        ['provider', 'baseUrl', 'apiKeyEnv', 'timeoutMs'],
        `root.accounts.${accountId}`,
      );
      const providerId = identifier(
        account.provider,
        `root.accounts.${accountId}.provider`,
      );
      const routingAccount = routing.accounts[accountId];
      if (!routingAccount || routingAccount.providerId !== providerId) {
        fail(
          `root.accounts.${accountId}.provider must equal routing provider ${routingAccount?.providerId ?? 'unknown'}`,
        );
      }
      const provider = providers[providerId];
      if (!provider) {
        fail(
          `root.accounts.${accountId} references missing provider ${providerId}`,
        );
      }
      const apiKeyEnv = apiKeyEnvironmentName(
        account.apiKeyEnv,
        `root.accounts.${accountId}.apiKeyEnv`,
      );
      const apiKey = apiKeyFromEnvironment(
        env,
        apiKeyEnv,
        `root.accounts.${accountId}.apiKeyEnv`,
      );
      return [
        accountId,
        Object.freeze({
          providerId,
          baseUrl:
            account.baseUrl === undefined
              ? provider.baseUrl
              : normalizeBaseUrl(
                  account.baseUrl,
                  `root.accounts.${accountId}.baseUrl`,
                ),
          timeoutMs: boundedInteger(
            account.timeoutMs,
            `root.accounts.${accountId}.timeoutMs`,
            provider.timeoutMs,
            10,
            10 * 60_000,
          ),
          ...(apiKey !== undefined ? { apiKey } : {}),
        }),
      ] as const;
    }),
  );
  return { providers, accounts };
}

function parseBindings(
  source: string,
  routing: RoutingConfig,
  env: NodeJS.ProcessEnv,
): {
  readonly providers: Readonly<Record<string, RoutedProviderConfig>>;
  readonly accounts: Readonly<Record<string, RoutedAccountConfig>>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail('Provider binding file must contain valid JSON');
  }

  const root = record(parsed, 'root');
  if (root.version !== routing.version) {
    fail(
      `root.version must equal routing configuration version ${routing.version}`,
    );
  }
  return routing.version === 1
    ? parseVersionOneBindings(root, routing, env)
    : parseVersionTwoBindings(root, routing, env);
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
    fail(
      'Legacy TONY_ROUTER_UPSTREAM_* settings cannot be mixed with routed mode',
    );
  }

  const [routingSource, bindingSource] = await Promise.all([
    readBoundedFile(routingPath, 'routing configuration'),
    readBoundedFile(providersPath, 'provider binding configuration'),
  ]);
  const registry = parseRoutingConfig(routingSource);
  const bindings = parseBindings(bindingSource, registry, env);

  return Object.freeze({
    registry,
    providers: bindings.providers,
    accounts: bindings.accounts,
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
    [
      ...Object.values(config?.providers ?? {}).map(
        (provider) => provider.apiKey,
      ),
      ...Object.values(config?.accounts ?? {}).map((account) => account.apiKey),
    ].filter((value): value is string => value !== undefined),
  );
}
