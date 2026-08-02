import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GatewayConfigError,
  loadGatewayConfig,
} from '../src/index.js';

const TOKEN = 'configured-token-'.padEnd(48, 'y');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('loadGatewayConfig', () => {
  it('generates and reuses a private local token file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tony-router-'));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, 'credentials', 'token');

    const first = await loadGatewayConfig({ env: {}, tokenFile });
    const second = await loadGatewayConfig({ env: {}, tokenFile });

    expect(first.tokenSource).toBe('generated');
    expect(second.tokenSource).toBe('file');
    expect(second.token).toBe(first.token);
    expect(first.token).toHaveLength(43);

    if (process.platform !== 'win32') {
      const metadata = await stat(tokenFile);
      expect(metadata.mode & 0o777).toBe(0o600);
    }
  });

  it('rejects non-loopback binding unless explicitly enabled', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_HOST: '0.0.0.0',
          TONY_ROUTER_TOKEN: TOKEN,
        },
      }),
    ).rejects.toThrow(GatewayConfigError);
  });

  it('accepts explicit non-loopback binding opt-in', async () => {
    const resolved = await loadGatewayConfig({
      env: {
        TONY_ROUTER_HOST: '0.0.0.0',
        TONY_ROUTER_ALLOW_NON_LOOPBACK: 'true',
        TONY_ROUTER_TOKEN: TOKEN,
        TONY_ROUTER_PORT: '9000',
      },
    });

    expect(resolved).toMatchObject({
      host: '0.0.0.0',
      port: 9000,
      allowNonLoopback: true,
      tokenSource: 'environment',
    });
  });

  it('fails startup on malformed numeric or boolean values', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_PORT: '12.5',
        },
      }),
    ).rejects.toThrow('TONY_ROUTER_PORT must be an integer');

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_ALLOW_NON_LOOPBACK: 'yes',
        },
      }),
    ).rejects.toThrow(
      'TONY_ROUTER_ALLOW_NON_LOOPBACK must be either true or false',
    );
  });
});
