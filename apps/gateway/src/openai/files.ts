import { GatewayHttpError } from '../errors.js';

export type FilePurpose = 'user_data';

export interface ProviderFileUpload {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly contentType: string;
  readonly purpose: FilePurpose;
}

export interface CanonicalFileObject extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly object: 'file';
  readonly bytes: number;
  readonly created_at: number;
  readonly filename: string;
  readonly purpose: FilePurpose;
  readonly expires_at?: number;
}

export interface CanonicalDeletedFile extends Readonly<
  Record<string, unknown>
> {
  readonly id: string;
  readonly object: 'file';
  readonly deleted: true;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const MAX_FILENAME_LENGTH = 255;
const MAX_CONTENT_TYPE_LENGTH = 200;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function upstreamInvalid(message: string): never {
  throw new GatewayHttpError(502, 'upstream_invalid_response', message);
}

function nonNegativeSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function positiveSafeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function safeFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_FILENAME_LENGTH &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

export function filePurpose(value: unknown): FilePurpose {
  if (value === 'user_data') return value;
  if (typeof value !== 'string') {
    throw new GatewayHttpError(
      400,
      'invalid_file_purpose',
      'File purpose must be user_data',
    );
  }
  throw new GatewayHttpError(
    400,
    'unsupported_file_purpose',
    'This phase supports only purpose=user_data',
  );
}

export function uploadedFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'Uploaded file must include a filename',
    );
  }
  if (
    value !== value.trim() ||
    value.length > MAX_FILENAME_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'Uploaded filename must be a bounded basename without control characters',
    );
  }
  return value;
}

export function uploadContentType(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return 'application/octet-stream';
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_CONTENT_TYPE_LENGTH ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'Uploaded file content type is invalid',
    );
  }
  return normalized;
}

export function normalizeFileObject(value: unknown): CanonicalFileObject {
  if (
    !isRecord(value) ||
    value.object !== 'file' ||
    typeof value.id !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.id)
  ) {
    return upstreamInvalid('Upstream returned an invalid file object');
  }
  const bytes = nonNegativeSafeInteger(value.bytes);
  const createdAt = nonNegativeSafeInteger(value.created_at);
  const expiresAt =
    value.expires_at === undefined || value.expires_at === null
      ? undefined
      : positiveSafeInteger(value.expires_at);
  if (
    bytes === undefined ||
    createdAt === undefined ||
    !safeFilename(value.filename) ||
    value.purpose !== 'user_data' ||
    (value.expires_at !== undefined &&
      value.expires_at !== null &&
      expiresAt === undefined)
  ) {
    return upstreamInvalid('Upstream returned invalid file metadata');
  }
  return Object.freeze({
    id: value.id,
    object: 'file' as const,
    bytes,
    created_at: createdAt,
    filename: value.filename,
    purpose: 'user_data' as const,
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
  });
}

export function normalizeDeletedFile(
  value: unknown,
  expectedId: string,
): CanonicalDeletedFile {
  if (
    !isRecord(value) ||
    value.id !== expectedId ||
    value.deleted !== true ||
    value.object !== 'file'
  ) {
    return upstreamInvalid('Upstream returned an invalid file deletion result');
  }
  return Object.freeze({
    id: expectedId,
    object: 'file' as const,
    deleted: true,
  });
}
