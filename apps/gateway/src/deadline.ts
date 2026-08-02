import type { FastifyInstance, FastifyRequest } from 'fastify';

import { sendGatewayError } from './errors.js';

export interface RequestDeadlineOptions {
  readonly skipPaths?: ReadonlySet<string>;
}

export function installRequestDeadline(
  app: FastifyInstance,
  timeoutMs: number,
  options: RequestDeadlineOptions = {},
): void {
  const timers = new WeakMap<FastifyRequest, NodeJS.Timeout>();

  const clearTimer = (request: FastifyRequest): void => {
    const timer = timers.get(request);
    if (timer) {
      clearTimeout(timer);
      timers.delete(request);
    }
  };

  app.addHook('onRequest', (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '/';
    if (options.skipPaths?.has(path)) return Promise.resolve();

    const timer = setTimeout(() => {
      if (!reply.sent) {
        sendGatewayError(
          reply,
          504,
          'request_timeout',
          'The gateway request exceeded its deadline',
          request.id,
        );
      }
    }, timeoutMs);
    timer.unref();
    timers.set(request, timer);
    return Promise.resolve();
  });

  app.addHook('onResponse', (request) => {
    clearTimer(request);
    return Promise.resolve();
  });

  app.addHook('onError', (request) => {
    clearTimer(request);
    return Promise.resolve();
  });
}
