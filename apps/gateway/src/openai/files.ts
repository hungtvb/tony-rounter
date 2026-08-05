import { GatewayHttpError } from '../errors.js';

export type FilePurpose = 'user_data';
export type FileListOrder = 'asc' | 'desc';

export interface ProviderFileUpload {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly contentType: string;
  readonly purpose: FilePurpose;
}

export interface ProviderFileListQuery {
  readonly after?: string;
  readonly limit: number;
  readonly order: FileListOrder;
  readonly purpose: FilePurpose;
}

export interface ProviderFileContent {
  readonly bytes: Uint8Array;
  readonly contentType: string;
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

export interface CanonicalFileList extends Readonly<Record<string, unknown>> {
  readonly object: 'list';
  readonly data: readonly CanonicalFileObject[];
  readonly first_id: string | null;
  readonly last_id: string | null;
  readonly has_more: boolean;
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
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

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

function safeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
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
    !MEDIA_TYPE_PATTERN.test(normalized)
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_file_upload',
      'Uploaded file content type is invalid',
    );
  }
  return normalized;
}

export function upstreamFileContentType(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'application/octet-stream';
  }
  if (
    typeof value !== 'string' ||
    value.length > MAX_CONTENT_TYPE_LENGTH ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return upstreamInvalid('Upstream returned an invalid file content type');
  }
  const [mediaType, ...parameters] = value.split(';');
  const normalizedMediaType = mediaType?.trim().toLowerCase();
  if (!normalizedMediaType || !MEDIA_TYPE_PATTERN.test(normalizedMediaType)) {
    return upstreamInvalid('Upstream returned an invalid file content type');
  }
  for (const parameter of parameters) {
    const candidate = parameter.trim();
    if (
      candidate.length === 0 ||
      candidate.length > 100 ||
      !/^[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+\-:/]+|"[\x20-\x21\x23-\x7e]*")$/.test(
        candidate,
      )
    ) {
      return upstreamInvalid('Upstream returned an invalid file content type');
    }
  }
  return [normalizedMediaType, ...parameters.map((item) => item.trim())].join(
    '; ',
  );
}

export function normalizeFileObject(value: unknown): CanonicalFileObject {
  if (
    !isRecord(value) ||
    value.object !== 'file' ||
    !safeIdentifier(value.id)
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

export function normalizeRetrievedFile(
  value: unknown,
  expectedId: string,
): CanonicalFileObject {
  const file = normalizeFileObject(value);
  if (file.id !== expectedId) {
    return upstreamInvalid('Upstream returned metadata for a different file');
  }
  return file;
}

export function normalizeFileList(value: unknown): CanonicalFileList {
  if (
    !isRecord(value) ||
    value.object !== 'list' ||
    !Array.isArray(value.data) ||
    value.data.length > 10_000 ||
    typeof value.has_more !== 'boolean'
  ) {
    return upstreamInvalid('Upstream returned an invalid file list');
  }
  const data = Object.freeze(value.data.map(normalizeFileObject));
  const expectedFirst = data[0]?.id ?? null;
  const expectedLast = data[data.length - 1]?.id ?? null;
  const firstId = value.first_id ?? null;
  const lastId = value.last_id ?? null;
  if (
    (firstId !== null && !safeIdentifier(firstId)) ||
    (lastId !== null && !safeIdentifier(lastId)) ||
    firstId !== expectedFirst ||
    lastId !== expectedLast
  ) {
    return upstreamInvalid('Upstream returned invalid file-list cursors');
  }
  return Object.freeze({
    object: 'list' as const,
    data,
    first_id: expectedFirst,
    last_id: expectedLast,
    has_more: value.has_more,
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
