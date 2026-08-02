import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;

export class GatewayConfigError extends Error {
  override readonly name = 'GatewayConfigError';
}

export interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly allowNonLoopback: boolean;
  readonly token: string;
  readonly tokenFile: string;
  readonly tokenSource: 'environment' | 'file' | 'generated';
  readonly bodyLimitBytes: number;
  readonly requestTimeoutMs: number;
  readonly shutdownGraceMs: number;
  readonly version: string;
}

export interface LoadGatewayConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly tokenFile?: string;
}

function parseBoolean(name: string, value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new GatewayConfigError(`${name} must be either true or false`);
}

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new GatewayConfigError(`${name} must be an integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GatewayConfigError(
      `${name} must be between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

function validateToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 32 || normalized.length > 512) {
    throw new GatewayConfigError(
      'TONY_ROUTER_TOKEN must contain between 32 and 512 characters',
    );
  }
  if (/\s/.test(normalized)) {
    throw new GatewayConfigError('TONY_ROUTER_TOKEN must not contain whitespace');
  }
  return normalized;
}

async function bestEffortChmod(path: string, mode: number): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await chmod(path, mode);
  } catch {
    // The containing filesystem may not support POSIX permissions.
  }
}

async function loadOrCreateToken(
  tokenFile: string,
): Promise<{ token: string; source: 'file' | 'generated' }> {
  const directory = dirname(tokenFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await bestEffortChmod(directory, 0o700);

  const generated = randomBytes(32).toString('base64url');

  try {
    const handle = await open(tokenFile, 'wx', 0o600);
    try {
      await handle.writeFile(`${generated}\n`, { encoding: 'utf8' });
    } finally {
      await handle.close();
    }
    await bestEffortChmod(tokenFile, 0o600);
    return { token: generated, source: 'generated' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;
  }

  const existing = validateToken(await readFile(tokenFile, 'utf8'));
  await bestEffortChmod(tokenFile, 0o600);
  return { token: existing, source: 'file' };
}

export async function loadGatewayConfig(
  options: LoadGatewayConfigOptions = {},
): Promise<GatewayConfig> {
  const env = options.env ?? process.env;
  const host = env.TONY_ROUTER_HOST ?? '127.0.0.1';
  const allowNonLoopback = parseBoolean(
    'TONY_ROUTER_ALLOW_NON_LOOPBACK',
    env.TONY_ROUTER_ALLOW_NON_LOOPBACK,
  );

  if (!LOOPBACK_HOSTS.has(host) && !allowNonLoopback) {
    throw new GatewayConfigError(
      'Non-loopback binding requires TONY_ROUTER_ALLOW_NON_LOOPBACK=true',
    );
  }

  const tokenFile =
    options.tokenFile ??
    env.TONY_ROUTER_TOKEN_FILE ??
    join(homedir(), '.tony-router', 'token');

  const credential = env.TONY_ROUTER_TOKEN
    ? {
        token: validateToken(env.TONY_ROUTER_TOKEN),
        source: 'environment' as const,
      }
    : await loadOrCreateToken(tokenFile);

  return Object.freeze({
    host,
    port: parseInteger('TONY_ROUTER_PORT', env.TONY_ROUTER_PORT, 8787, 0, 65_535),
    allowNonLoopback,
    token: credential.token,
    tokenFile,
    tokenSource: credential.source,
    bodyLimitBytes: parseInteger(
      'TONY_ROUTER_BODY_LIMIT_BYTES',
      env.TONY_ROUTER_BODY_LIMIT_BYTES,
      DEFAULT_BODY_LIMIT_BYTES,
      1024,
      16 * 1024 * 1024,
    ),
    requestTimeoutMs: parseInteger(
      'TONY_ROUTER_REQUEST_TIMEOUT_MS',
      env.TONY_ROUTER_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      10,
      5 * 60_000,
    ),
    shutdownGraceMs: parseInteger(
      'TONY_ROUTER_SHUTDOWN_GRACE_MS',
      env.TONY_ROUTER_SHUTDOWN_GRACE_MS,
      DEFAULT_SHUTDOWN_GRACE_MS,
      10,
      60_000,
    ),
    version: '0.1.0',
  });
}
