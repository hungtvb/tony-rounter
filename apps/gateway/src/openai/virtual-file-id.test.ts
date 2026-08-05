import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import {
  resolveVirtualFileIds,
  VirtualFileIdCodec,
} from './virtual-file-id.js';

const KEY = 'server-only-file-id-key-'.padEnd(48, 'k');

describe('VirtualFileIdCodec', () => {
  it.each(['short', 'server-only key with whitespace'.padEnd(48, 'x')])(
    'rejects a weak server-only key: %s',
    (secret) => {
      expect(() => new VirtualFileIdCodec(secret)).toThrowError(
        GatewayHttpError,
      );
    },
  );

  it('round-trips routed ownership without exposing upstream identity', () => {
    const codec = new VirtualFileIdCodec(KEY, () => 1_700_000_000_000);
    const publicId = codec.encode({
      owner: {
        mode: 'routed',
        accountId: 'work',
        providerId: 'openai',
      },
      upstreamFileId: 'file-upstream-secret',
      expiresAt: 1_800_000_000,
    });

    expect(publicId).toMatch(
      /^file-tr-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(publicId).not.toContain('work');
    expect(publicId).not.toContain('openai');
    expect(publicId).not.toContain('upstream');
    expect(codec.decode(publicId)).toEqual({
      owner: {
        mode: 'routed',
        accountId: 'work',
        providerId: 'openai',
      },
      upstreamFileId: 'file-upstream-secret',
      expiresAt: 1_800_000_000,
    });
  });

  it('rejects tampering and keys from another gateway instance', () => {
    const codec = new VirtualFileIdCodec(KEY);
    const publicId = codec.encode({
      owner: { mode: 'direct', bindingId: 'direct-binding' },
      upstreamFileId: 'file-upstream',
    });
    const tampered = `${publicId.slice(0, -1)}${publicId.endsWith('A') ? 'B' : 'A'}`;

    expect(() => codec.decode(tampered)).toThrowError(GatewayHttpError);
    expect(() =>
      new VirtualFileIdCodec('different-server-key-'.padEnd(48, 'd')).decode(
        publicId,
      ),
    ).toThrowError(GatewayHttpError);
    expect(() =>
      new VirtualFileIdCodec('client-bearer-token-'.padEnd(48, 'b')).decode(
        publicId,
      ),
    ).toThrowError(GatewayHttpError);
  });

  it('rejects expired virtual IDs', () => {
    const codec = new VirtualFileIdCodec(KEY, () => 2_000_000_000_000);
    const publicId = codec.encode({
      owner: { mode: 'direct', bindingId: 'direct-binding' },
      upstreamFileId: 'file-expired',
      expiresAt: 1_999_999_999,
    });

    try {
      codec.decode(publicId);
      throw new Error('Expected expiration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayHttpError);
      expect((error as GatewayHttpError).code).toBe('expired_file_id');
    }
  });
});

describe('resolveVirtualFileIds', () => {
  it('replaces public IDs while preserving a single routed owner', () => {
    const codec = new VirtualFileIdCodec(KEY);
    const first = codec.encode({
      owner: { mode: 'routed', accountId: 'work', providerId: 'openai' },
      upstreamFileId: 'file-1',
    });
    const second = codec.encode({
      owner: { mode: 'routed', accountId: 'work', providerId: 'openai' },
      upstreamFileId: 'file-2',
    });

    const resolved = resolveVirtualFileIds(
      {
        model: 'tony-auto',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Compare' },
              { type: 'file', file: { file_id: first } },
              { type: 'file', file: { file_id: second } },
            ],
          },
        ],
      },
      codec,
    );

    expect(resolved.owner).toEqual({
      mode: 'routed',
      accountId: 'work',
      providerId: 'openai',
    });
    expect(resolved.request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Compare' },
          { type: 'file', file: { file_id: 'file-1' } },
          { type: 'file', file: { file_id: 'file-2' } },
        ],
      },
    ]);
  });

  it('rejects mixed ownership before provider invocation', () => {
    const codec = new VirtualFileIdCodec(KEY);
    const work = codec.encode({
      owner: { mode: 'routed', accountId: 'work', providerId: 'openai' },
      upstreamFileId: 'file-1',
    });
    const personal = codec.encode({
      owner: { mode: 'routed', accountId: 'personal', providerId: 'openai' },
      upstreamFileId: 'file-2',
    });

    expect(() =>
      resolveVirtualFileIds(
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', file: { file_id: work } },
                { type: 'file', file: { file_id: personal } },
              ],
            },
          ],
        },
        codec,
      ),
    ).toThrowError(/different provider accounts/);
  });
});
