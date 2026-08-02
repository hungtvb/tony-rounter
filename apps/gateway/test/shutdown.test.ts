import { setTimeout as delay } from 'node:timers/promises';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createGracefulShutdown, createNullLogger } from '../src/index.js';

describe('createGracefulShutdown', () => {
  it('closes an idle gateway gracefully and is idempotent', async () => {
    const app = Fastify();
    await app.ready();
    const shutdown = createGracefulShutdown(app, 100, createNullLogger());

    const first = shutdown();
    const second = shutdown();

    expect(second).toBe(first);
    await expect(first).resolves.toBe('closed');
  });

  it('forces connection closure when graceful hooks exceed the deadline', async () => {
    const app = Fastify();
    app.addHook('onClose', async () => {
      await delay(40);
    });
    await app.ready();
    const shutdown = createGracefulShutdown(app, 5, createNullLogger());

    await expect(shutdown()).resolves.toBe('forced');
    await delay(50);
  });
});
