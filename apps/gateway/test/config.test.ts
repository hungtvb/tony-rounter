import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GatewayConfigError, loadGatewayConfig } from '../src/index.js';

const TOKEN = 'configured-token-'.padEnd(48, 'y');
const UPSTREAM_KEY = 'upstream-key-'.padEnd(48, 'z');
const FILE_ID_KEY = 'file-id-key-'.padEnd(48, 'f');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadGatewayConfig', () => {
  it('generates and reuses a private local token file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tony-router-'));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, 'credentials', 'token');
    const fileIdKeyFile = join(directory, 'credentials', 'file-id-key');

    const first = await loadGatewayConfig({
      env: {},
      tokenFile,
      fileIdKeyFile,
    });
    const second = await loadGatewayConfig({
      env: {},
      tokenFile,
      fileIdKeyFile,
    });

    expect(first.tokenSource).toBe('generated');
    expect(second.tokenSource).toBe('file');
    expect(second.token).toBe(first.token);
    expect(first.token).toHaveLength(43);
    expect(first.fileIdKeySource).toBe('generated');
    expect(second.fileIdKeySource).toBe('file');
    expect(second.fileIdKey).toBe(first.fileIdKey);
    expect(first.fileIdKey).toHaveLength(43);

    if (process.platform !== 'win32') {
      const tokenMetadata = await stat(tokenFile);
      const fileIdKeyMetadata = await stat(fileIdKeyFile);
      expect(tokenMetadata.mode & 0o777).toBe(0o600);
      expect(fileIdKeyMetadata.mode & 0o777).toBe(0o600);
    }
  });

  it('requires the server-only file ID key to differ from the client bearer token', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: TOKEN,
        },
      }),
    ).rejects.toThrow(
      'TONY_ROUTER_FILE_ID_KEY must differ from TONY_ROUTER_TOKEN',
    );
  });

  it('rejects malformed server-only file ID keys', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: 'too-short',
        },
      }),
    ).rejects.toThrow(
      'TONY_ROUTER_FILE_ID_KEY must contain between 32 and 512 characters',
    );
  });

  it('rejects non-loopback binding unless explicitly enabled', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_HOST: '0.0.0.0',
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
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
        TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
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

  it('loads a loopback development upstream and strips its trailing slash', async () => {
    const resolved = await loadGatewayConfig({
      env: {
        TONY_ROUTER_TOKEN: TOKEN,
        TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
        TONY_ROUTER_UPSTREAM_BASE_URL: 'http://127.0.0.1:9001/v1/',
        TONY_ROUTER_UPSTREAM_API_KEY: UPSTREAM_KEY,
        TONY_ROUTER_UPSTREAM_TIMEOUT_MS: '1234',
      },
    });

    expect(resolved).toMatchObject({
      version: '0.2.0',
      upstream: {
        baseUrl: 'http://127.0.0.1:9001/v1',
        apiKey: UPSTREAM_KEY,
        timeoutMs: 1234,
      },
    });
  });

  it('requires TLS for a remote upstream', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_UPSTREAM_BASE_URL: 'http://example.com/v1',
        },
      }),
    ).rejects.toThrow('Remote upstreams must use https');
  });

  it('rejects partial upstream configuration without a base URL', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_UPSTREAM_API_KEY: UPSTREAM_KEY,
        },
      }),
    ).rejects.toThrow('TONY_ROUTER_UPSTREAM_BASE_URL is required');
  });

  it('fails startup on malformed numeric or boolean values', async () => {
    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_PORT: '12.5',
        },
      }),
    ).rejects.toThrow('TONY_ROUTER_PORT must be an integer');

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_ALLOW_NON_LOOPBACK: 'yes',
        },
      }),
    ).rejects.toThrow(
      'TONY_ROUTER_ALLOW_NON_LOOPBACK must be either true or false',
    );
  });
  it('enables trusted local control only on loopback with an absolute isolated directory', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tony-router-control-config-'),
    );
    temporaryDirectories.push(directory);

    const resolved = await loadGatewayConfig({
      env: {
        TONY_ROUTER_TOKEN: TOKEN,
        TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
        TONY_ROUTER_CONTROL_DIR: directory,
      },
    });
    expect(resolved.controlDir).toBe(directory);

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_CONTROL_DIR: 'relative/control',
        },
      }),
    ).rejects.toThrow('must be an absolute local path');

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_HOST: '0.0.0.0',
          TONY_ROUTER_ALLOW_NON_LOOPBACK: 'true',
          TONY_ROUTER_CONTROL_DIR: directory,
        },
      }),
    ).rejects.toThrow('allowed only when the gateway binds to loopback');
  });

  it('rejects ambiguous managed, explicit-file, and legacy provider modes', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'tony-router-control-mode-'),
    );
    temporaryDirectories.push(directory);

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_CONTROL_DIR: directory,
          TONY_ROUTER_ROUTING_CONFIG_FILE: '/tmp/router.yaml',
          TONY_ROUTER_PROVIDER_CONFIG_FILE: '/tmp/providers.json',
        },
      }),
    ).rejects.toThrow('cannot be mixed with explicit routed config file paths');

    await expect(
      loadGatewayConfig({
        env: {
          TONY_ROUTER_TOKEN: TOKEN,
          TONY_ROUTER_FILE_ID_KEY: FILE_ID_KEY,
          TONY_ROUTER_CONTROL_DIR: directory,
          TONY_ROUTER_UPSTREAM_BASE_URL: 'https://api.example.test/v1',
        },
      }),
    ).rejects.toThrow('cannot be mixed with legacy upstream settings');
  });
});
