import { parseDocument } from 'yaml';

import type { ModelCapabilities } from '../capabilities.js';
import type {
  ProviderKind,
  RoutingAccount,
  RoutingConfig,
  RoutingConfigVersion,
  RoutingModel,
  RoutingProfile,
  RoutingProfileRoute,
  RoutingProvider,
  RoutingRoute,
} from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PRIORITY = 10_000;
const MAX_CONTEXT_TOKENS = 10_000_000;

type UnknownRecord = Readonly<Record<string, unknown>>;

export class RoutingConfigError extends Error {
  override readonly name = 'RoutingConfigError';

  constructor(readonly issues: readonly string[]) {
    super(`Invalid routing configuration:\n- ${issues.join('\n- ')}`);
  }
}

function fail(path: string, message: string): never {
  throw new RoutingConfigError([`${path}: ${message}`]);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be an object');
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
    fail(path, `contains unknown field(s): ${unknown.sort().join(', ')}`);
  }
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    return fail(path, 'must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/');
  }
  return value;
}

function nonEmptyString(
  value: unknown,
  path: string,
  maximumLength = 200,
): string {
  if (typeof value !== 'string') return fail(path, 'must be a string');
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    return fail(path, `must contain between 1 and ${maximumLength} characters`);
  }
  return normalized;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return fail(path, `must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function frozenRecord<T>(
  entries: readonly (readonly [string, T])[],
): Readonly<Record<string, T>> {
  const output = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) output[key] = value;
  return Object.freeze(output);
}

function parseCapabilities(value: unknown, path: string): ModelCapabilities {
  const input = record(value, path);
  allowedKeys(
    input,
    [
      'tools',
      'parallelToolCalls',
      'vision',
      'structuredOutput',
      'contextTokens',
    ],
    path,
  );

  const tools = boolean(input.tools, `${path}.tools`);
  const parallelToolCalls = boolean(
    input.parallelToolCalls,
    `${path}.parallelToolCalls`,
  );
  if (parallelToolCalls && !tools) {
    fail(path, 'parallelToolCalls requires tools=true');
  }

  return Object.freeze({
    tools,
    parallelToolCalls,
    vision: boolean(input.vision, `${path}.vision`),
    structuredOutput: boolean(
      input.structuredOutput,
      `${path}.structuredOutput`,
    ),
    contextTokens: integer(
      input.contextTokens,
      `${path}.contextTokens`,
      1,
      MAX_CONTEXT_TOKENS,
    ),
  });
}

function parseProviders(
  value: unknown,
): Readonly<Record<string, RoutingProvider>> {
  const input = record(value, 'providers');
  const entries = Object.entries(input);
  if (entries.length === 0) {
    fail('providers', 'must define at least one provider');
  }

  return frozenRecord(
    entries.map(([rawId, rawProvider]) => {
      const id = identifier(rawId, `providers.${rawId}`);
      const provider = record(rawProvider, `providers.${id}`);
      allowedKeys(provider, ['kind'], `providers.${id}`);
      const kind = nonEmptyString(
        provider.kind,
        `providers.${id}.kind`,
      ) as ProviderKind;
      if (kind !== 'openai-compatible') {
        fail(`providers.${id}.kind`, 'must currently be openai-compatible');
      }
      return [id, Object.freeze({ id, kind })] as const;
    }),
  );
}

function implicitAccounts(
  providers: Readonly<Record<string, RoutingProvider>>,
): Readonly<Record<string, RoutingAccount>> {
  return frozenRecord(
    Object.values(providers).map((provider) => [
      provider.id,
      Object.freeze({ id: provider.id, providerId: provider.id }),
    ] as const),
  );
}

function parseAccounts(
  value: unknown,
  providers: Readonly<Record<string, RoutingProvider>>,
): Readonly<Record<string, RoutingAccount>> {
  const input = record(value, 'accounts');
  const entries = Object.entries(input);
  if (entries.length === 0) {
    fail('accounts', 'must define at least one account');
  }

  const accounts = frozenRecord(
    entries.map(([rawId, rawAccount]) => {
      const id = identifier(rawId, `accounts.${rawId}`);
      const account = record(rawAccount, `accounts.${id}`);
      allowedKeys(account, ['provider'], `accounts.${id}`);
      return [
        id,
        Object.freeze({
          id,
          providerId: identifier(
            account.provider,
            `accounts.${id}.provider`,
          ),
        }),
      ] as const;
    }),
  );

  for (const account of Object.values(accounts)) {
    if (!own(providers, account.providerId)) {
      fail(
        `accounts.${account.id}.provider`,
        `references unknown provider ${account.providerId}`,
      );
    }
  }
  return accounts;
}

function parseModels(value: unknown): Readonly<Record<string, RoutingModel>> {
  const input = record(value, 'models');
  const entries = Object.entries(input);
  if (entries.length === 0) fail('models', 'must define at least one model');

  return frozenRecord(
    entries.map(([rawId, rawModel]) => {
      const id = identifier(rawId, `models.${rawId}`);
      const model = record(rawModel, `models.${id}`);
      allowedKeys(
        model,
        ['provider', 'upstreamModel', 'capabilities'],
        `models.${id}`,
      );
      return [
        id,
        Object.freeze({
          id,
          providerId: identifier(model.provider, `models.${id}.provider`),
          upstreamModel: nonEmptyString(
            model.upstreamModel,
            `models.${id}.upstreamModel`,
          ),
          capabilities: parseCapabilities(
            model.capabilities,
            `models.${id}.capabilities`,
          ),
        }),
      ] as const;
    }),
  );
}

function parseRoutes(
  value: unknown,
  version: RoutingConfigVersion,
  models: Readonly<Record<string, RoutingModel>>,
): Readonly<Record<string, RoutingRoute>> {
  const input = record(value, 'routes');
  const entries = Object.entries(input);
  if (entries.length === 0) fail('routes', 'must define at least one route');

  return frozenRecord(
    entries.map(([rawId, rawRoute]) => {
      const id = identifier(rawId, `routes.${rawId}`);
      const route = record(rawRoute, `routes.${id}`);
      allowedKeys(
        route,
        version === 1
          ? ['model', 'enabled', 'priority']
          : ['model', 'account', 'enabled', 'priority'],
        `routes.${id}`,
      );
      const modelId = identifier(route.model, `routes.${id}.model`);
      const model = models[modelId];
      if (!model) {
        fail(`routes.${id}.model`, `references unknown model ${modelId}`);
      }
      const accountId =
        version === 1
          ? model.providerId
          : identifier(route.account, `routes.${id}.account`);

      return [
        id,
        Object.freeze({
          id,
          modelId,
          accountId,
          enabled:
            route.enabled === undefined
              ? true
              : boolean(route.enabled, `routes.${id}.enabled`),
          priority:
            route.priority === undefined
              ? 0
              : integer(
                  route.priority,
                  `routes.${id}.priority`,
                  -MAX_PRIORITY,
                  MAX_PRIORITY,
                ),
        }),
      ] as const;
    }),
  );
}

function parseProfileRoute(value: unknown, path: string): RoutingProfileRoute {
  const input = record(value, path);
  allowedKeys(input, ['route', 'priority'], path);
  return Object.freeze({
    routeId: identifier(input.route, `${path}.route`),
    priority:
      input.priority === undefined
        ? 0
        : integer(
            input.priority,
            `${path}.priority`,
            -MAX_PRIORITY,
            MAX_PRIORITY,
          ),
  });
}

function parseProfiles(
  value: unknown,
): Readonly<Record<string, RoutingProfile>> {
  const input = record(value, 'profiles');
  const entries = Object.entries(input);
  if (entries.length === 0) {
    fail('profiles', 'must define at least one profile');
  }

  return frozenRecord(
    entries.map(([rawId, rawProfile]) => {
      const id = identifier(rawId, `profiles.${rawId}`);
      const profile = record(rawProfile, `profiles.${id}`);
      allowedKeys(profile, ['routes'], `profiles.${id}`);
      if (!Array.isArray(profile.routes) || profile.routes.length === 0) {
        fail(`profiles.${id}.routes`, 'must be a non-empty array');
      }

      const routes = profile.routes.map((route, index) =>
        parseProfileRoute(route, `profiles.${id}.routes[${index}]`),
      );
      const seen = new Set<string>();
      for (const route of routes) {
        if (seen.has(route.routeId)) {
          fail(
            `profiles.${id}.routes`,
            `contains duplicate route ${route.routeId}`,
          );
        }
        seen.add(route.routeId);
      }

      return [
        id,
        Object.freeze({ id, routes: Object.freeze(routes) }),
      ] as const;
    }),
  );
}

function validateReferences(config: RoutingConfig): void {
  for (const model of Object.values(config.models)) {
    if (!own(config.providers, model.providerId)) {
      fail(
        `models.${model.id}.provider`,
        `references unknown provider ${model.providerId}`,
      );
    }
  }
  for (const route of Object.values(config.routes)) {
    const account = config.accounts[route.accountId];
    if (!account) {
      fail(
        `routes.${route.id}.account`,
        `references unknown account ${route.accountId}`,
      );
    }
    const model = config.models[route.modelId];
    if (!model) {
      fail(
        `routes.${route.id}.model`,
        `references unknown model ${route.modelId}`,
      );
    }
    if (account.providerId !== model.providerId) {
      fail(
        `routes.${route.id}`,
        `account ${account.id} belongs to provider ${account.providerId}, but model ${model.id} belongs to provider ${model.providerId}`,
      );
    }
  }
  for (const profile of Object.values(config.profiles)) {
    for (const route of profile.routes) {
      if (!own(config.routes, route.routeId)) {
        fail(
          `profiles.${profile.id}.routes`,
          `references unknown route ${route.routeId}`,
        );
      }
    }
  }
  if (!own(config.profiles, config.defaultProfileId)) {
    fail(
      'defaultProfile',
      `references unknown profile ${config.defaultProfileId}`,
    );
  }
}

export function parseRoutingConfig(source: string): RoutingConfig {
  if (source.length === 0) throw new RoutingConfigError(['source is empty']);
  if (source.length > 1024 * 1024) {
    throw new RoutingConfigError(['source exceeds the 1 MiB safety limit']);
  }

  let document;
  try {
    document = parseDocument(source, {
      merge: false,
      prettyErrors: true,
      resolveKnownTags: false,
      schema: 'core',
      uniqueKeys: true,
      version: '1.2',
    });
  } catch (error) {
    throw new RoutingConfigError([
      error instanceof Error ? error.message : 'YAML parser failed',
    ]);
  }

  const parserIssues = [...document.errors, ...document.warnings].map(
    (issue) => issue.message,
  );
  if (parserIssues.length > 0) throw new RoutingConfigError(parserIssues);

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new RoutingConfigError([
      error instanceof Error ? error.message : 'YAML conversion failed',
    ]);
  }

  const root = record(value, 'root');
  const version = root.version;
  if (version !== 1 && version !== 2) {
    fail('version', 'must equal 1 or 2');
  }
  allowedKeys(
    root,
    version === 1
      ? ['version', 'defaultProfile', 'providers', 'models', 'routes', 'profiles']
      : [
          'version',
          'defaultProfile',
          'providers',
          'accounts',
          'models',
          'routes',
          'profiles',
        ],
    'root',
  );

  const providers = parseProviders(root.providers);
  const accounts =
    version === 1
      ? implicitAccounts(providers)
      : parseAccounts(root.accounts, providers);
  const models = parseModels(root.models);
  const config: RoutingConfig = Object.freeze({
    version,
    defaultProfileId: identifier(root.defaultProfile, 'defaultProfile'),
    providers,
    accounts,
    models,
    routes: parseRoutes(root.routes, version, models),
    profiles: parseProfiles(root.profiles),
  });
  validateReferences(config);
  return config;
}
