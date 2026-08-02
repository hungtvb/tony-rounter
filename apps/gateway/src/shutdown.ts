import type { FastifyInstance } from 'fastify';

import type { JsonLogger } from './logger.js';

export type ShutdownResult = 'closed' | 'forced';

async function settlesWithin(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createGracefulShutdown(
  app: FastifyInstance,
  graceMs: number,
  logger?: JsonLogger,
): () => Promise<ShutdownResult> {
  let inFlight: Promise<ShutdownResult> | undefined;

  const execute = async (): Promise<ShutdownResult> => {
    logger?.info('gateway_shutdown_started', { graceMs });
    const closePromise = app.close();
    if (await settlesWithin(closePromise, graceMs)) {
      logger?.info('gateway_shutdown_completed');
      return 'closed';
    }

    logger?.warn('gateway_shutdown_forced', { graceMs });
    app.server.closeAllConnections();
    await settlesWithin(closePromise, Math.min(graceMs, 1_000));
    return 'forced';
  };

  return () => {
    inFlight ??= execute();
    return inFlight;
  };
}

export function installSignalHandlers(
  shutdown: () => Promise<ShutdownResult>,
  logger: JsonLogger,
  exit: (code: number) => never = (code) => process.exit(code),
): () => void {
  const signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handler = (): void => {
      logger.info('gateway_signal_received', { signal });
      void shutdown().then(
        () => exit(0),
        (error: unknown) => {
          logger.error('gateway_shutdown_failed', { signal, error });
          exit(1);
        },
      );
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}
