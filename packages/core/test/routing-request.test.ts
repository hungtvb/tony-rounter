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
                {
                  type: 'file',
                  file: { file_data: 'JVBERi0xLjQ=', filename: 'spec.pdf' },
                },
              ],
            },
          ],
          response_format: { type: 'json_schema' },
          reasoning_effort: 'high',
          reasoning_summary: 'concise',
        },
        { estimatedInputTokens: 4_000, reservedOutputTokens: 2_000 },
      ),
    ).toEqual({
      tools: true,
      parallelToolCalls: true,
      vision: true,
      structuredOutput: true,
      fileInput: true,
      reasoning: true,
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

  it('requires tool capabilities for replayed tool history without new tools', () => {
    expect(
      deriveChatRequestCapabilities({
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_read',
                type: 'function',
                function: { name: 'read_file', arguments: '{}' },
              },
              {
                id: 'call_stat',
                type: 'function',
                function: { name: 'stat_file', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_read', content: 'hello' },
          { role: 'tool', tool_call_id: 'call_stat', content: '{"size":5}' },
        ],
      }),
    ).toMatchObject({
      tools: true,
      parallelToolCalls: true,
    });
  });

  it('requires tools but not parallel calls for one replayed tool result', () => {
    expect(
      deriveChatRequestCapabilities({
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_read',
                type: 'function',
                function: { name: 'read_file', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_read', content: 'hello' },
        ],
      }),
    ).toMatchObject({
      tools: true,
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

  it('recognizes Responses input_file compatibility parts', () => {
    expect(
      deriveChatRequestCapabilities({
        messages: [
          {
            content: [
              {
                type: 'input_file',
                file_data: 'JVBERi0xLjQ=',
                filename: 'spec.pdf',
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ fileInput: true });
  });

  it('does not require reasoning for effort none without a summary', () => {
    expect(
      deriveChatRequestCapabilities({ reasoning_effort: 'none' }),
    ).not.toHaveProperty('reasoning');
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
