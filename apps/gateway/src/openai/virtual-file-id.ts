import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { GatewayHttpError } from '../errors.js';

const PREFIX = 'file-tr-v1';
const AAD = Buffer.from('tony-router:file-id:v1', 'utf8');
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_PUBLIC_ID_LENGTH = 4096;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;

export type VirtualFileOwner =
  | Readonly<{
      mode: 'direct';
      bindingId: string;
    }>
  | Readonly<{
      mode: 'routed';
      accountId: string;
      providerId: string;
    }>;

export interface VirtualFileIdentity {
  readonly owner: VirtualFileOwner;
  readonly upstreamFileId: string;
  readonly expiresAt?: number;
}

interface SerializedVirtualFileIdentity {
  readonly v: 1;
  readonly m: 'd' | 'r';
  readonly f: string;
  readonly a?: string;
  readonly p?: string;
  readonly b?: string;
  readonly e?: number;
}

function invalidFileId(): never {
  throw new GatewayHttpError(
    400,
    'invalid_file_id',
    'The supplied file ID is invalid for this Tony Router instance',
  );
}

function expiredFileId(): never {
  throw new GatewayHttpError(
    400,
    'expired_file_id',
    'The supplied file ID has expired',
  );
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalidFileId();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) return invalidFileId();
  return decoded;
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256')
    .update('tony-router:file-id:key:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function serialized(
  identity: VirtualFileIdentity,
): SerializedVirtualFileIdentity {
  if (!validIdentifier(identity.upstreamFileId)) return invalidFileId();
  if (
    identity.expiresAt !== undefined &&
    (!Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= 0)
  ) {
    return invalidFileId();
  }

  if (identity.owner.mode === 'direct') {
    if (!validIdentifier(identity.owner.bindingId)) return invalidFileId();
    return {
      v: 1,
      m: 'd',
      f: identity.upstreamFileId,
      b: identity.owner.bindingId,
      ...(identity.expiresAt !== undefined ? { e: identity.expiresAt } : {}),
    };
  }
  if (
    !validIdentifier(identity.owner.accountId) ||
    !validIdentifier(identity.owner.providerId)
  ) {
    return invalidFileId();
  }
  return {
    v: 1,
    m: 'r',
    f: identity.upstreamFileId,
    a: identity.owner.accountId,
    p: identity.owner.providerId,
    ...(identity.expiresAt !== undefined ? { e: identity.expiresAt } : {}),
  };
}

function parsePayload(value: unknown): VirtualFileIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidFileId();
  }
  const payload = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(['v', 'm', 'f', 'a', 'p', 'b', 'e']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return invalidFileId();
  }
  if (payload.v !== 1 || !validIdentifier(payload.f)) {
    return invalidFileId();
  }
  if (
    payload.e !== undefined &&
    (!Number.isSafeInteger(payload.e) || (payload.e as number) <= 0)
  ) {
    return invalidFileId();
  }

  if (payload.m === 'd') {
    if (
      payload.a !== undefined ||
      payload.p !== undefined ||
      !validIdentifier(payload.b)
    ) {
      return invalidFileId();
    }
    return {
      owner: { mode: 'direct', bindingId: payload.b },
      upstreamFileId: payload.f,
      ...(payload.e !== undefined ? { expiresAt: payload.e as number } : {}),
    };
  }
  if (
    payload.m !== 'r' ||
    payload.b !== undefined ||
    !validIdentifier(payload.a) ||
    !validIdentifier(payload.p)
  ) {
    return invalidFileId();
  }
  return {
    owner: {
      mode: 'routed',
      accountId: payload.a,
      providerId: payload.p,
    },
    upstreamFileId: payload.f,
    ...(payload.e !== undefined ? { expiresAt: payload.e as number } : {}),
  };
}

export class VirtualFileIdCodec {
  readonly #key: Buffer;
  readonly #now: () => number;

  constructor(secret: string, now: () => number = Date.now) {
    if (secret.length < 32 || secret.length > 512 || /\s/.test(secret)) {
      throw new GatewayHttpError(
        500,
        'invalid_file_id_key',
        'Virtual file IDs require a 32 to 512 character server-only key without whitespace',
      );
    }
    this.#key = deriveKey(secret);
    this.#now = now;
  }

  encode(identity: VirtualFileIdentity): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(AAD);
    const plaintext = Buffer.from(JSON.stringify(serialized(identity)), 'utf8');
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      PREFIX,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  decode(publicId: string): VirtualFileIdentity {
    if (
      typeof publicId !== 'string' ||
      publicId.length === 0 ||
      publicId.length > MAX_PUBLIC_ID_LENGTH
    ) {
      return invalidFileId();
    }
    const segments = publicId.split('.');
    if (segments.length !== 4 || segments[0] !== PREFIX) {
      return invalidFileId();
    }

    try {
      const iv = decodeCanonicalBase64Url(segments[1] ?? '');
      const ciphertext = decodeCanonicalBase64Url(segments[2] ?? '');
      const tag = decodeCanonicalBase64Url(segments[3] ?? '');
      if (
        iv.length !== IV_BYTES ||
        ciphertext.length === 0 ||
        tag.length !== AUTH_TAG_BYTES
      ) {
        return invalidFileId();
      }
      const decipher = createDecipheriv('aes-256-gcm', this.#key, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
      const identity = parsePayload(JSON.parse(plaintext) as unknown);
      if (
        identity.expiresAt !== undefined &&
        identity.expiresAt <= Math.floor(this.#now() / 1000)
      ) {
        return expiredFileId();
      }
      return identity;
    } catch (error) {
      if (error instanceof GatewayHttpError) throw error;
      return invalidFileId();
    }
  }
}

export interface ResolvedVirtualFileRequest<TRequest> {
  readonly request: TRequest;
  readonly owner?: VirtualFileOwner;
}

function sameOwner(left: VirtualFileOwner, right: VirtualFileOwner): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode === 'direct' && right.mode === 'direct') {
    return left.bindingId === right.bindingId;
  }
  if (left.mode === 'direct' || right.mode === 'direct') return false;
  return (
    left.accountId === right.accountId && left.providerId === right.providerId
  );
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveVirtualFileIds<
  TRequest extends Readonly<{
    readonly messages: readonly unknown[];
  }>,
>(
  request: TRequest,
  codec: VirtualFileIdCodec,
): ResolvedVirtualFileRequest<TRequest> {
  let owner: VirtualFileOwner | undefined;
  let changed = false;
  const messages = request.messages.map((message) => {
    if (!record(message) || !Array.isArray(message.content)) return message;
    let messageChanged = false;
    const originalContent: readonly unknown[] = message.content;
    const content = originalContent.map((part) => {
      if (!record(part) || part.type !== 'file' || !record(part.file)) {
        return part;
      }
      const publicId = part.file.file_id;
      if (typeof publicId !== 'string') return part;
      const identity = codec.decode(publicId);
      if (owner && !sameOwner(owner, identity.owner)) {
        throw new GatewayHttpError(
          400,
          'mixed_file_ownership',
          'A single request cannot combine files owned by different provider accounts',
        );
      }
      owner = identity.owner;
      changed = true;
      messageChanged = true;
      return Object.freeze({
        ...part,
        file: Object.freeze({
          ...part.file,
          file_id: identity.upstreamFileId,
        }),
      });
    });
    return messageChanged ? Object.freeze({ ...message, content }) : message;
  });

  return Object.freeze({
    request: changed ? Object.freeze({ ...request, messages }) : request,
    ...(owner ? { owner } : {}),
  });
}
