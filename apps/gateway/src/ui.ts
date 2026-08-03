import type { FastifyInstance, FastifyReply } from 'fastify';

import type { GatewayRouterConfig } from './routing/config.js';
import type { GatewayTelemetry } from './telemetry.js';
import { UI_JS } from './ui-assets/client.js';
import { UI_HTML } from './ui-assets/html.js';
import { UI_CSS } from './ui-assets/styles.js';

export type UiProviderMode =
  'routed' | 'openai-compatible' | 'static-registry' | 'unconfigured';

export interface UiProviderInventoryItem {
  readonly id: string;
  readonly kind: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly accountCount: number;
  readonly modelCount: number;
  readonly routeCount: number;
}

export interface UiAccountInventoryItem {
  readonly id: string;
  readonly providerId: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly credentialConfigured: boolean;
  readonly modelCount: number;
  readonly routeCount: number;
}

export interface UiProfileInventoryItem {
  readonly id: string;
  readonly routeCount: number;
  readonly accountCount: number;
}

export interface UiRoutingInventory {
  readonly version: 1 | 2;
  readonly defaultProfileId: string;
  readonly providers: readonly UiProviderInventoryItem[];
  readonly accounts: readonly UiAccountInventoryItem[];
  readonly profiles: readonly UiProfileInventoryItem[];
}

export interface UiRuntimeInfo {
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly tokenSource: 'environment' | 'file' | 'generated';
  readonly provider: {
    readonly mode: UiProviderMode;
    readonly baseUrl?: string;
    readonly providerCount?: number;
    readonly accountCount?: number;
    readonly credentialConfigured: boolean;
  };
  readonly routing?: UiRoutingInventory;
}

export interface InstallUiRoutesOptions {
  readonly telemetry: GatewayTelemetry;
  readonly runtime: UiRuntimeInfo;
}

function distinctCount(values: readonly string[]): number {
  return new Set(values).size;
}

export function buildUiRoutingInventory(
  config: GatewayRouterConfig | undefined,
): UiRoutingInventory | undefined {
  if (!config) return undefined;

  const { registry } = config;
  const routes = Object.values(registry.routes);
  const models = Object.values(registry.models);
  const accounts = Object.values(registry.accounts);

  const providerItems = Object.values(registry.providers)
    .map((provider): UiProviderInventoryItem => {
      const providerAccounts = accounts.filter(
        (account) => account.providerId === provider.id,
      );
      const accountIds = new Set(providerAccounts.map((account) => account.id));
      const providerRoutes = routes.filter((route) =>
        accountIds.has(route.accountId),
      );
      const binding = config.providers[provider.id];
      return Object.freeze({
        id: provider.id,
        kind: provider.kind,
        baseUrl: binding?.baseUrl ?? '',
        timeoutMs: binding?.timeoutMs ?? 0,
        accountCount: providerAccounts.length,
        modelCount: models.filter((model) => model.providerId === provider.id)
          .length,
        routeCount: providerRoutes.length,
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const accountItems = accounts
    .map((account): UiAccountInventoryItem => {
      const accountRoutes = routes.filter(
        (route) => route.accountId === account.id,
      );
      const binding = config.accounts?.[account.id];
      const providerBinding = config.providers[account.providerId];
      return Object.freeze({
        id: account.id,
        providerId: account.providerId,
        baseUrl: binding?.baseUrl ?? providerBinding?.baseUrl ?? '',
        timeoutMs: binding?.timeoutMs ?? providerBinding?.timeoutMs ?? 0,
        credentialConfigured: Boolean(binding?.apiKey),
        modelCount: distinctCount(accountRoutes.map((route) => route.modelId)),
        routeCount: accountRoutes.length,
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const profileItems = Object.values(registry.profiles)
    .map((profile): UiProfileInventoryItem => {
      const profileRoutes = profile.routes
        .map((entry) => registry.routes[entry.routeId])
        .filter((route) => route !== undefined);
      return Object.freeze({
        id: profile.id,
        routeCount: profileRoutes.length,
        accountCount: distinctCount(
          profileRoutes.map((route) => route.accountId),
        ),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return Object.freeze({
    version: registry.version,
    defaultProfileId: registry.defaultProfileId,
    providers: Object.freeze(providerItems),
    accounts: Object.freeze(accountItems),
    profiles: Object.freeze(profileItems),
  });
}

function secureUiHeaders(reply: FastifyReply): void {
  reply.header(
    'content-security-policy',
    "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('cache-control', 'no-store');
}

export function installUiRoutes(
  app: FastifyInstance,
  options: InstallUiRoutesOptions,
): void {
  app.get('/', (_request, reply) => {
    reply.code(302).header('location', '/ui').send();
  });

  const renderUi = (_request: unknown, reply: FastifyReply) => {
    secureUiHeaders(reply);
    return reply.type('text/html; charset=utf-8').send(UI_HTML);
  };

  app.get('/ui', renderUi);
  app.get('/ui/', renderUi);

  app.get('/ui/styles.css', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/css; charset=utf-8').send(UI_CSS);
  });

  app.get('/ui/app.js', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/javascript; charset=utf-8').send(UI_JS);
  });

  app.get('/ui/api/dashboard', () => ({
    gateway: {
      version: options.runtime.version,
      host: options.runtime.host,
      port: options.runtime.port,
      tokenSource: options.runtime.tokenSource,
    },
    provider: options.runtime.provider,
    ...(options.runtime.routing ? { routing: options.runtime.routing } : {}),
    telemetry: options.telemetry.snapshot(),
  }));
}
