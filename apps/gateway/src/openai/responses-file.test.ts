import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import {
  parseResponsesRequest,
  responsesToChatCompletion,
} from './responses.js';

const PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PD4+CmVuZG9iagp0cmFpbGVyCjw8Pj4KJSVFT0YK';

function translate(
  content: readonly Readonly<Record<string, unknown>>[],
  role: 'user' | 'assistant' | 'system' | 'developer' = 'user',
) {
  return responsesToChatCompletion(
    parseResponsesRequest({
      model: 'coding',
      input: [{ role, content }],
    }),
  );
}

function requestError(
  content: readonly Readonly<Record<string, unknown>>[],
  role: 'user' | 'assistant' | 'system' | 'developer' = 'user',
): GatewayHttpError {
  try {
    translate(content, role);
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayHttpError);
    return error as GatewayHttpError;
  }
  throw new Error('Expected request translation to fail');
}

describe('Responses inline PDF translation', () => {
  it('preserves mixed text, image, and PDF content order', () => {
    expect(
      translate([
        { type: 'input_text', text: 'Compare ' },
        {
          type: 'input_file',
          file_data: PDF_BASE64,
          filename: 'spec.pdf',
        },
        { type: 'input_text', text: ' with ' },
        {
          type: 'input_image',
          image_url: 'https://images.example.test/status.png',
          detail: 'low',
        },
      ]).messages,
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Compare ' },
          {
            type: 'file',
            file: { file_data: PDF_BASE64, filename: 'spec.pdf' },
          },
          { type: 'text', text: ' with ' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://images.example.test/status.png',
              detail: 'low',
            },
          },
        ],
      },
    ]);
  });

  it('accepts nullable alternate sources and unsupported optional fields', () => {
    expect(
      translate([
        {
          type: 'input_file',
          file_id: null,
          file_url: null,
          file_data: PDF_BASE64,
          filename: 'REPORT.PDF',
          detail: null,
          prompt_cache_breakpoint: null,
        },
      ]).messages,
    ).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            file: { file_data: PDF_BASE64, filename: 'REPORT.PDF' },
          },
        ],
      },
    ]);
  });

  it('preserves virtual file IDs for gateway ownership resolution', () => {
    expect(
      translate([{ type: 'input_file', file_id: 'file-tr-v1_public' }])
        .messages,
    ).toEqual([
      {
        role: 'user',
        content: [{ type: 'file', file: { file_id: 'file-tr-v1_public' } }],
      },
    ]);
  });

  it.each([
    [
      'missing source',
      { type: 'input_file', filename: 'spec.pdf' },
      'invalid_request',
    ],
    [
      'combined sources',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        file_url: 'https://files.example.test/spec.pdf',
        filename: 'spec.pdf',
      },
      'invalid_request',
    ],
    [
      'file URL',
      {
        type: 'input_file',
        file_url: 'https://files.example.test/spec.pdf',
        filename: 'spec.pdf',
      },
      'unsupported_responses_feature',
    ],
    [
      'missing filename',
      { type: 'input_file', file_data: PDF_BASE64 },
      'invalid_request',
    ],
    [
      'non-PDF filename',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        filename: 'spec.txt',
      },
      'unsupported_responses_feature',
    ],
    [
      'path filename',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        filename: '../spec.pdf',
      },
      'invalid_request',
    ],
    [
      'invalid base64',
      { type: 'input_file', file_data: '%%%%', filename: 'spec.pdf' },
      'invalid_request',
    ],
    [
      'base64 whitespace',
      {
        type: 'input_file',
        file_data: `${PDF_BASE64}\n`,
        filename: 'spec.pdf',
      },
      'invalid_request',
    ],
    [
      'non-PDF bytes',
      {
        type: 'input_file',
        file_data: Buffer.from('plain text').toString('base64'),
        filename: 'spec.pdf',
      },
      'invalid_request',
    ],
    [
      'missing EOF marker',
      {
        type: 'input_file',
        file_data: Buffer.from('%PDF-1.4\nbody').toString('base64'),
        filename: 'spec.pdf',
      },
      'invalid_request',
    ],
    [
      'file detail',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        filename: 'spec.pdf',
        detail: 'high',
      },
      'unsupported_responses_feature',
    ],
    [
      'cache breakpoint',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        filename: 'spec.pdf',
        prompt_cache_breakpoint: { type: 'ephemeral' },
      },
      'unsupported_responses_feature',
    ],
    [
      'unknown field',
      {
        type: 'input_file',
        file_data: PDF_BASE64,
        filename: 'spec.pdf',
        media_type: 'application/pdf',
      },
      'unsupported_responses_feature',
    ],
  ] as const)('rejects %s', (_label, part, code) => {
    expect(requestError([part]).code).toBe(code);
  });

  it.each(['assistant', 'system', 'developer'] as const)(
    'rejects inline PDF content in a %s message',
    (role) => {
      expect(
        requestError(
          [
            {
              type: 'input_file',
              file_data: PDF_BASE64,
              filename: 'spec.pdf',
            },
          ],
          role,
        ).code,
      ).toBe('unsupported_responses_feature');
    },
  );
});
