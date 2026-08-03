import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalConfigStore } from '../src/control/config-store.js';

const directories: string[] = [];

const ROUTING_YAML = `version: 2
defaultProfile: tony-auto
providers:
  openai:
    kind: openai-compatible
accounts:
  personal:
    provider: openai
models:
  gpt:
    provider: openai
    upstreamModel: gpt-5
    capabilities:
      tools: true
      parallelToolCalls: true
      vision: false
      structuredOutput: true
      contextTokens: 128000
routes:
  primary:
    model: gpt
    account: personal
profiles:
  tony-auto:
    routes:
      - route: primary
`;

function bindings(baseUrl = 'https://api.openai.example/v1'): string {
  return JSON.stringify(
    {
      version: 2,
      providers: {
        openai: { baseUrl, timeoutMs: 1000 },
      },
      accounts: {
        personal: { provider: 'openai', apiKeyEnv: 'OPENAI_PERSONAL_KEY' },
      },
    },
    null,
    2,
  );
}

async function controlDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tony-router-control-'));
  directories.push(directory);
  return join(directory, 'managed');
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('trusted local configuration store', () => {
  it('validates a complete pair without resolving credentials into files', async () => {
    const store = new LocalConfigStore(await controlDirectory(), { env: {} });

    expect(store.validate(ROUTING_YAML, bindings())).toEqual({
      routingVersion: 2,
      providerCount: 1,
      accountCount: 1,
      modelCount: 1,
      routeCount: 1,
      profileCount: 1,
      missingCredentialEnvironmentVariables: ['OPENAI_PERSONAL_KEY'],
      restartReady: false,
    });
  });

  it('applies immutable generations, detects duplicates, and rolls back atomically', async () => {
    const directory = await controlDirectory();
    const store = new LocalConfigStore(directory, {
      env: { OPENAI_PERSONAL_KEY: 'secret-value' },
    });

    const first = await store.apply(ROUTING_YAML, bindings());
    expect(first.changed).toBe(true);
    expect(first.generation.active).toBe(true);
    expect(first.generation.restartReady).toBe(true);

    const duplicate = await store.apply(ROUTING_YAML, bindings());
    expect(duplicate.changed).toBe(false);
    expect(duplicate.generation.generationId).toBe(
      first.generation.generationId,
    );

    const second = await store.apply(
      ROUTING_YAML,
      bindings('https://backup.openai.example/v1'),
    );
    expect(second.changed).toBe(true);
    expect(second.previousGenerationId).toBe(first.generation.generationId);

    const generations = await store.listGenerations();
    expect(generations).toHaveLength(2);
    expect(generations.filter((generation) => generation.active)).toEqual([
      expect.objectContaining({ generationId: second.generation.generationId }),
    ]);

    const rolledBack = await store.rollback(first.generation.generationId);
    expect(rolledBack.changed).toBe(true);
    expect(rolledBack.previousGenerationId).toBe(
      second.generation.generationId,
    );
    expect((await store.loadActiveSources())?.generationId).toBe(
      first.generation.generationId,
    );

    const active = JSON.parse(
      await readFile(join(directory, 'active.json'), 'utf8'),
    ) as { generationId: string };
    expect(active.generationId).toBe(first.generation.generationId);
    expect(
      await readFile(join(directory, 'active.json'), 'utf8'),
    ).not.toContain('secret-value');
  });

  it('keeps the active generation unchanged after invalid or partial candidates', async () => {
    const directory = await controlDirectory();
    const store = new LocalConfigStore(directory, {
      env: { OPENAI_PERSONAL_KEY: 'secret-value' },
    });
    const first = await store.apply(ROUTING_YAML, bindings());

    await expect(store.apply('version: 99\n', bindings())).rejects.toThrow();
    expect((await store.loadActiveSources())?.generationId).toBe(
      first.generation.generationId,
    );

    const partial = join(
      directory,
      'generations',
      '20260803T000000.000Z-aaaaaaaaaaaa',
    );
    await mkdir(partial, { recursive: true });
    await writeFile(join(partial, 'router.yaml'), ROUTING_YAML);
    expect(await store.listGenerations()).toHaveLength(1);
  });

  it.runIf(process.platform !== 'win32')(
    'rejects a symlinked control directory',
    async () => {
      const parent = await mkdtemp(join(tmpdir(), 'tony-router-control-link-'));
      directories.push(parent);
      const target = join(parent, 'target');
      const link = join(parent, 'link');
      await mkdir(target);
      await symlink(target, link, 'dir');

      const store = new LocalConfigStore(link);
      await expect(store.initialize()).rejects.toMatchObject({
        code: 'unsafe_control_directory',
      });
    },
  );
});
