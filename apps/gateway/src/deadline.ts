import type { FastifyInstance, FastifyRequest } from 'fastify';

import { sendGatewayError } from './errors.js';

export function installRequestDeadline(
  app: FastifyInstance,
  timeoutMs: number,
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
