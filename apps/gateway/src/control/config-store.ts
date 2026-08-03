import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

import {
  parseGatewayRouterSources,
  type ParsedGatewayRouterSources,
} from '../routing/config.js';

const STORE_VERSION = 1;
const MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_RETENTION = 10;
const GENERATION_ID_PATTERN = /^\d{8}T\d{6}\.\d{3}Z-[a-f0-9]{12}$/;

export interface ManagedRouterSources {
  readonly routingSource: string;
  readonly bindingSource: string;
  readonly generationId: string;
}

export interface ControlValidationSummary {
  readonly routingVersion: 1 | 2;
  readonly providerCount: number;
  readonly accountCount: number;
  readonly modelCount: number;
  readonly routeCount: number;
  readonly profileCount: number;
  readonly missingCredentialEnvironmentVariables: readonly string[];
  readonly restartReady: boolean;
}

export interface ControlGenerationSummary extends ControlValidationSummary {
  readonly generationId: string;
  readonly createdAt: string;
  readonly active: boolean;
  readonly routingSha256: string;
  readonly bindingSha256: string;
}

export interface ControlApplyResult {
  readonly changed: boolean;
  readonly restartRequired: boolean;
  readonly generation: ControlGenerationSummary;
  readonly previousGenerationId?: string;
}

interface StoredGenerationManifest extends ControlValidationSummary {
  readonly storeVersion: 1;
  readonly generationId: string;
  readonly createdAt: string;
  readonly routingSha256: string;
  readonly bindingSha256: string;
}

interface ActivePointer {
  readonly version: 1;
  readonly generationId: string;
  readonly updatedAt: string;
}

export class LocalConfigStoreError extends Error {
  override readonly name = 'LocalConfigStoreError';

  constructor(
    readonly code: string,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options);
  }
}

function fail(code: string, message: string): never {
  throw new LocalConfigStoreError(code, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSourceSize(value: string, label: string): void {
  if (Buffer.byteLength(value, 'utf8') > MAX_SOURCE_BYTES) {
    fail('config_too_large', `${label} exceeds the 1 MiB safety limit`);
  }
}

function validationSummary(
  parsed: ParsedGatewayRouterSources,
): ControlValidationSummary {
  const { registry } = parsed.config;
  const missing = parsed.missingCredentialEnvironmentVariables;
  return Object.freeze({
    routingVersion: registry.version,
    providerCount: Object.keys(registry.providers).length,
    accountCount: Object.keys(registry.accounts).length,
    modelCount: Object.keys(registry.models).length,
    routeCount: Object.keys(registry.routes).length,
    profileCount: Object.keys(registry.profiles).length,
    missingCredentialEnvironmentVariables: missing,
    restartReady: missing.length === 0,
  });
}

function publicGenerationSummary(
  manifest: StoredGenerationManifest,
  summary: ControlValidationSummary,
  active: boolean,
): ControlGenerationSummary {
  return Object.freeze({
    generationId: manifest.generationId,
    createdAt: manifest.createdAt,
    active,
    routingSha256: manifest.routingSha256,
    bindingSha256: manifest.bindingSha256,
    ...summary,
  });
}

async function bestEffortChmod(path: string, mode: number): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await chmod(path, mode);
  } catch {
    // Some filesystems do not support POSIX permissions.
  }
}

async function writeExclusiveFile(path: string, value: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await bestEffortChmod(path, 0o600);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw error;
  } finally {
    await handle.close();
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  let source: string;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      return fail('unsafe_control_path', `${label} must be a regular file`);
    }
    source = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fail('control_state_missing', `${label} does not exist`);
    }
    throw error;
  }

  if (Buffer.byteLength(source, 'utf8') > 64 * 1024) {
    return fail('invalid_control_state', `${label} is unexpectedly large`);
  }

  try {
    return JSON.parse(source) as T;
  } catch {
    return fail('invalid_control_state', `${label} contains invalid JSON`);
  }
}

function generationId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '');
  return `${timestamp}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function assertGenerationId(value: unknown): string {
  if (typeof value !== 'string' || !GENERATION_ID_PATTERN.test(value)) {
    return fail('invalid_generation_id', 'Generation ID is invalid');
  }
  return value;
}

export class LocalConfigStore {
  readonly #root: string;
  readonly #generations: string;
  readonly #activePointer: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #retention: number;
  #restartRequired = false;

  constructor(
    directory: string,
    options: {
      readonly env?: NodeJS.ProcessEnv;
      readonly retention?: number;
    } = {},
  ) {
    if (!isAbsolute(directory)) {
      fail('invalid_control_directory', 'Control directory must be absolute');
    }
    this.#root = resolve(directory);
    this.#generations = join(this.#root, 'generations');
    this.#activePointer = join(this.#root, 'active.json');
    this.#env = options.env ?? process.env;
    this.#retention = options.retention ?? DEFAULT_RETENTION;
    if (
      !Number.isSafeInteger(this.#retention) ||
      this.#retention < 2 ||
      this.#retention > 100
    ) {
      fail('invalid_retention', 'Control retention must be between 2 and 100');
    }
  }

  get directory(): string {
    return this.#root;
  }

  get restartRequired(): boolean {
    return this.#restartRequired;
  }

  async initialize(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await bestEffortChmod(this.#root, 0o700);
    const info = await lstat(this.#root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail(
        'unsafe_control_directory',
        'Control directory must be a real directory, not a symlink',
      );
    }
    const canonical = await realpath(this.#root);
    if (resolve(canonical) !== this.#root) {
      fail(
        'unsafe_control_directory',
        'Control directory must not resolve through symlinks',
      );
    }
    await mkdir(this.#generations, { recursive: true, mode: 0o700 });
    await bestEffortChmod(this.#generations, 0o700);
    const generationsInfo = await lstat(this.#generations);
    if (!generationsInfo.isDirectory() || generationsInfo.isSymbolicLink()) {
      fail(
        'unsafe_control_directory',
        'Control generations path must be a real directory',
      );
    }
  }

  validate(
    routingSource: string,
    bindingSource: string,
  ): ControlValidationSummary {
    assertSourceSize(routingSource, 'Routing configuration');
    assertSourceSize(bindingSource, 'Provider binding configuration');
    return validationSummary(
      parseGatewayRouterSources(routingSource, bindingSource, {
        env: this.#env,
        requireCredentials: false,
      }),
    );
  }

  async loadActiveSources(): Promise<ManagedRouterSources | undefined> {
    await this.initialize();
    let pointer: ActivePointer;
    try {
      pointer = await readJson<ActivePointer>(
        this.#activePointer,
        'Active configuration pointer',
      );
    } catch (error) {
      if (
        error instanceof LocalConfigStoreError &&
        error.code === 'control_state_missing'
      ) {
        return undefined;
      }
      throw error;
    }
    if (pointer.version !== STORE_VERSION) {
      fail(
        'unsupported_control_state',
        `Unsupported control state version ${String(pointer.version)}`,
      );
    }
    const id = assertGenerationId(pointer.generationId);
    const verified = await this.#verifiedGeneration(id);
    return Object.freeze({
      routingSource: verified.routingSource,
      bindingSource: verified.bindingSource,
      generationId: id,
    });
  }

  async apply(
    routingSource: string,
    bindingSource: string,
  ): Promise<ControlApplyResult> {
    await this.initialize();
    const summary = this.validate(routingSource, bindingSource);
    const routingSha256 = sha256(routingSource);
    const bindingSha256 = sha256(bindingSource);
    const current = await this.#activeGenerationSummary();
    if (
      current?.routingSha256 === routingSha256 &&
      current.bindingSha256 === bindingSha256
    ) {
      return Object.freeze({
        changed: false,
        restartRequired: this.#restartRequired,
        generation: current,
      });
    }

    const id = generationId();
    const createdAt = new Date().toISOString();
    const directory = join(this.#generations, id);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    await bestEffortChmod(directory, 0o700);

    const manifest: StoredGenerationManifest = Object.freeze({
      storeVersion: STORE_VERSION,
      generationId: id,
      createdAt,
      routingSha256,
      bindingSha256,
      ...summary,
    });

    try {
      await writeExclusiveFile(join(directory, 'router.yaml'), routingSource);
      await writeExclusiveFile(
        join(directory, 'providers.json'),
        bindingSource,
      );
      await writeExclusiveFile(
        join(directory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await syncDirectory(directory);
      await syncDirectory(this.#generations);
      await this.#writeActivePointer(id);
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }

    this.#restartRequired = true;
    await this.#pruneGenerations(id).catch(() => undefined);
    return Object.freeze({
      changed: true,
      restartRequired: true,
      generation: publicGenerationSummary(manifest, summary, true),
      ...(current ? { previousGenerationId: current.generationId } : {}),
    });
  }

  async listGenerations(): Promise<readonly ControlGenerationSummary[]> {
    await this.initialize();
    const activeId = await this.#activeGenerationId();
    const entries = await readdir(this.#generations, { withFileTypes: true });
    const generations: ControlGenerationSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !GENERATION_ID_PATTERN.test(entry.name)) {
        continue;
      }
      try {
        const verified = await this.#verifiedGeneration(entry.name);
        generations.push(
          publicGenerationSummary(
            verified.manifest,
            verified.summary,
            verified.manifest.generationId === activeId,
          ),
        );
      } catch {
        // Incomplete or corrupt generations are quarantined by omission.
      }
    }
    return Object.freeze(
      generations.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    );
  }

  async rollback(generation: string): Promise<ControlApplyResult> {
    await this.initialize();
    const id = assertGenerationId(generation);
    const target = await this.#generationSummary(id);
    const current = await this.#activeGenerationSummary();
    if (current?.generationId === id) {
      return Object.freeze({
        changed: false,
        restartRequired: this.#restartRequired,
        generation: target,
      });
    }
    await this.#writeActivePointer(id);
    this.#restartRequired = true;
    return Object.freeze({
      changed: true,
      restartRequired: true,
      generation: Object.freeze({ ...target, active: true }),
      ...(current ? { previousGenerationId: current.generationId } : {}),
    });
  }

  async #activeGenerationId(): Promise<string | undefined> {
    try {
      const pointer = await readJson<ActivePointer>(
        this.#activePointer,
        'Active configuration pointer',
      );
      if (pointer.version !== STORE_VERSION) {
        fail(
          'unsupported_control_state',
          `Unsupported control state version ${String(pointer.version)}`,
        );
      }
      return assertGenerationId(pointer.generationId);
    } catch (error) {
      if (
        error instanceof LocalConfigStoreError &&
        error.code === 'control_state_missing'
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async #activeGenerationSummary(): Promise<
    ControlGenerationSummary | undefined
  > {
    const id = await this.#activeGenerationId();
    return id ? this.#generationSummary(id) : undefined;
  }

  async #generationSummary(id: string): Promise<ControlGenerationSummary> {
    const verified = await this.#verifiedGeneration(id);
    const active = (await this.#activeGenerationId()) === id;
    return publicGenerationSummary(verified.manifest, verified.summary, active);
  }

  async #verifiedGeneration(id: string): Promise<{
    readonly manifest: StoredGenerationManifest;
    readonly routingSource: string;
    readonly bindingSource: string;
    readonly summary: ControlValidationSummary;
  }> {
    const directory = await this.#safeGenerationDirectory(id);
    const manifest = await readJson<StoredGenerationManifest>(
      join(directory, 'manifest.json'),
      `Generation ${id} manifest`,
    );
    if (
      manifest.storeVersion !== STORE_VERSION ||
      manifest.generationId !== id
    ) {
      fail('invalid_control_state', `Generation ${id} manifest is invalid`);
    }
    const [routingSource, bindingSource] = await Promise.all([
      this.#readGenerationFile(directory, 'router.yaml'),
      this.#readGenerationFile(directory, 'providers.json'),
    ]);
    if (
      sha256(routingSource) !== manifest.routingSha256 ||
      sha256(bindingSource) !== manifest.bindingSha256
    ) {
      fail('invalid_control_state', `Generation ${id} failed integrity checks`);
    }
    const summary = this.validate(routingSource, bindingSource);
    if (
      summary.routingVersion !== manifest.routingVersion ||
      summary.providerCount !== manifest.providerCount ||
      summary.accountCount !== manifest.accountCount ||
      summary.modelCount !== manifest.modelCount ||
      summary.routeCount !== manifest.routeCount ||
      summary.profileCount !== manifest.profileCount
    ) {
      fail(
        'invalid_control_state',
        `Generation ${id} metadata is inconsistent`,
      );
    }
    return Object.freeze({
      manifest,
      routingSource,
      bindingSource,
      summary,
    });
  }

  async #safeGenerationDirectory(id: string): Promise<string> {
    assertGenerationId(id);
    const candidate = join(this.#generations, id);
    const info = await lstat(candidate).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return fail('generation_not_found', `Generation ${id} was not found`);
        }
        throw error;
      },
    );
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail('unsafe_control_path', `Generation ${id} must be a real directory`);
    }
    const canonical = await realpath(candidate);
    const prefix = `${await realpath(this.#generations)}${sep}`;
    if (!canonical.startsWith(prefix)) {
      fail('unsafe_control_path', 'Generation path escaped the control store');
    }
    return canonical;
  }

  async #readGenerationFile(
    directory: string,
    name: 'router.yaml' | 'providers.json',
  ): Promise<string> {
    const path = join(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('unsafe_control_path', `${name} must be a regular file`);
    }
    const value = await readFile(path, 'utf8');
    assertSourceSize(value, name);
    return value;
  }

  async #writeActivePointer(id: string): Promise<void> {
    const temporary = join(
      this.#root,
      `.active-${randomUUID().replace(/-/g, '')}.tmp`,
    );
    const pointer: ActivePointer = Object.freeze({
      version: STORE_VERSION,
      generationId: id,
      updatedAt: new Date().toISOString(),
    });
    try {
      await writeExclusiveFile(
        temporary,
        `${JSON.stringify(pointer, null, 2)}\n`,
      );
      await rename(temporary, this.#activePointer);
      await bestEffortChmod(this.#activePointer, 0o600);
      await syncDirectory(this.#root).catch(() => undefined);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #pruneGenerations(activeId: string): Promise<void> {
    const generations = await this.listGenerations();
    const retained = new Set(
      generations.slice(0, this.#retention).map((item) => item.generationId),
    );
    retained.add(activeId);
    for (const generation of generations) {
      if (retained.has(generation.generationId)) continue;
      const directory = await this.#safeGenerationDirectory(
        generation.generationId,
      );
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function loadManagedRouterSources(
  directory: string,
): Promise<ManagedRouterSources | undefined> {
  return new LocalConfigStore(directory).loadActiveSources();
}
