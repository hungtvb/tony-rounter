import { buildGateway } from './app.js';
import { LocalConfigStore } from './control/config-store.js';
import { loadGatewayConfig } from './config.js';
import { createJsonLogger } from './logger.js';
import {
  loadGatewayRouterConfig,
  routerSensitiveValues,
} from './routing/config.js';
import { createGracefulShutdown, installSignalHandlers } from './shutdown.js';

async function main(): Promise<void> {
  const config = await loadGatewayConfig();
  const controlStore = config.controlDir
    ? new LocalConfigStore(config.controlDir)
    : undefined;
  const managedSources = await controlStore?.loadActiveSources();
  const router = await loadGatewayRouterConfig(
    managedSources
      ? {
          sources: {
            routingSource: managedSources.routingSource,
            bindingSource: managedSources.bindingSource,
          },
        }
      : {},
  );
  const logger = createJsonLogger({
    sensitiveValues: [
      config.token,
      ...(config.upstream?.apiKey ? [config.upstream.apiKey] : []),
      ...routerSensitiveValues(router),
    ],
  });
  const app = buildGateway({
    config,
    logger,
    ...(router ? { router } : {}),
    ...(controlStore ? { controlStore } : {}),
  });
  const shutdown = createGracefulShutdown(app, config.shutdownGraceMs, logger);
  const uninstallSignals = installSignalHandlers(shutdown, logger);

  try {
    await app.listen({ host: config.host, port: config.port });
    const address = app.server.address();
    logger.info('gateway_started', {
      host: config.host,
      port:
        typeof address === 'object' && address !== null
          ? address.port
          : config.port,
      tokenSource: config.tokenSource,
      upstreamConfigured: config.upstream !== undefined,
      routedProviders: router
        ? Object.keys(router.registry.providers).length
        : 0,
      routedAccounts: router ? Object.keys(router.registry.accounts).length : 0,
      localControlEnabled: controlStore !== undefined,
      ...(managedSources
        ? { activeConfigGeneration: managedSources.generationId }
        : {}),
      ...(config.tokenSource === 'environment'
        ? {}
        : { tokenFile: config.tokenFile }),
    });
  } catch (error) {
    uninstallSignals();
    logger.error('gateway_start_failed', { error });
    process.exitCode = 1;
    await shutdown().catch(() => undefined);
  }
}

void main();
