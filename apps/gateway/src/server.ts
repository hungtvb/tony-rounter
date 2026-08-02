import { buildGateway } from './app.js';
import { loadGatewayConfig } from './config.js';
import { createJsonLogger } from './logger.js';
import {
  createGracefulShutdown,
  installSignalHandlers,
} from './shutdown.js';

async function main(): Promise<void> {
  const config = await loadGatewayConfig();
  const logger = createJsonLogger({ sensitiveValues: [config.token] });
  const app = buildGateway({ config, logger });
  const shutdown = createGracefulShutdown(
    app,
    config.shutdownGraceMs,
    logger,
  );
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
