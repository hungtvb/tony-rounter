import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import { normalizeDeletedFile, normalizeFileObject } from './files.js';

function expectUpstreamInvalid(run: () => unknown): void {
  try {
    run();
    throw new Error('Expected upstream validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayHttpError);
    expect((error as GatewayHttpError).statusCode).toBe(502);
    expect((error as GatewayHttpError).code).toBe('upstream_invalid_response');
  }
}

describe('Files API upstream normalization', () => {
  it('accepts a canonical user_data File object', () => {
    expect(
      normalizeFileObject({
        id: 'file-upstream-1',
        object: 'file',
        bytes: 42,
        created_at: 1_700_000_000,
        expires_at: 1_800_000_000,
        filename: 'spec.pdf',
        purpose: 'user_data',
      }),
    ).toEqual({
      id: 'file-upstream-1',
      object: 'file',
      bytes: 42,
      created_at: 1_700_000_000,
      expires_at: 1_800_000_000,
      filename: 'spec.pdf',
      purpose: 'user_data',
    });
  });

  it.each([
    ['wrong object discriminator', { object: 'upload' }],
    ['unsafe filename', { filename: '../spec.pdf' }],
    ['wrong purpose', { purpose: 'assistants' }],
    ['zero expiry', { expires_at: 0 }],
  ] as const)('rejects %s', (_label, override) => {
    expectUpstreamInvalid(() =>
      normalizeFileObject({
        id: 'file-upstream-1',
        object: 'file',
        bytes: 42,
        created_at: 1_700_000_000,
        filename: 'spec.pdf',
        purpose: 'user_data',
        ...override,
      }),
    );
  });

  it('requires a canonical deletion object', () => {
    expect(
      normalizeDeletedFile(
        { id: 'file-upstream-1', object: 'file', deleted: true },
        'file-upstream-1',
      ),
    ).toEqual({ id: 'file-upstream-1', object: 'file', deleted: true });

    expectUpstreamInvalid(() =>
      normalizeDeletedFile(
        { id: 'file-upstream-1', deleted: true },
        'file-upstream-1',
      ),
    );
  });
});
