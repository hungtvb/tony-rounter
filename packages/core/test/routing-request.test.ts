import { describe, expect, it } from 'vitest';

import { deriveChatRequestCapabilities } from '../src/index.js';

describe('deriveChatRequestCapabilities', () => {
  it('extracts tools, parallel calls, vision, structured output, and context', () => {
    expect(
      deriveChatRequestCapabilities(
        {
          tools: [{ type: 'function', function: { name: 'search' } }],
          parallel_tool_calls: true,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this' },
                { type: 'image_url', image_url: { url: 'data:image/png' } },
              ],
            },
          ],
          response_format: { type: 'json_schema' },
        },
        { estimatedInputTokens: 4_000, reservedOutputTokens: 2_000 },
      ),
    ).toEqual({
      tools: true,
      parallelToolCalls: true,
      vision: true,
      structuredOutput: true,
      minimumContextTokens: 6_000,
    });
  });

  it('does not require parallel tool calls without a non-empty tools array', () => {
    expect(
      deriveChatRequestCapabilities({
        tools: [],
        parallel_tool_calls: true,
      }),
    ).toMatchObject({
      tools: false,
      parallelToolCalls: false,
    });
  });

  it('recognizes input_image and json_object compatibility forms', () => {
    expect(
      deriveChatRequestCapabilities({
        messages: [
          {
            content: [
              { type: 'input_image', image_url: 'https://example.test' },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    ).toMatchObject({
      vision: true,
      structuredOutput: true,
    });
  });

  it('treats malformed or unknown request shapes as having no hard features', () => {
    expect(deriveChatRequestCapabilities(null)).toEqual({
      tools: false,
      parallelToolCalls: false,
      vision: false,
      structuredOutput: false,
    });

    expect(
      deriveChatRequestCapabilities({
        tools: 'invalid',
        messages: [{ content: [{ type: 'audio' }] }],
        response_format: { type: 'text' },
      }),
    ).toEqual({
      tools: false,
      parallelToolCalls: false,
      vision: false,
      structuredOutput: false,
    });
  });
});
