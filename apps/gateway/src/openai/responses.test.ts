import { describe, expect, it } from 'vitest';

import { GatewayHttpError } from '../errors.js';
import {
  chatCompletionToResponse,
  parseResponsesRequest,
  responsesToChatCompletion,
} from './responses.js';

describe('Responses API protocol translation', () => {
  it('translates string input and instructions into chat messages', () => {
    const parsed = parseResponsesRequest({
      model: 'coding',
      instructions: 'Be precise.',
      input: 'Fix the bug.',
      max_output_tokens: 800,
    });

    expect(responsesToChatCompletion(parsed)).toEqual({
      model: 'coding',
      messages: [
        { role: 'developer', content: 'Be precise.' },
        { role: 'user', content: 'Fix the bug.' },
      ],
      stream: false,
      max_completion_tokens: 800,
    });
  });

  it('accepts message input_text blocks', () => {
    const translated = responsesToChatCompletion(
      parseResponsesRequest({
        model: 'coding',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'first' },
              { type: 'input_text', text: ' second' },
            ],
          },
        ],
      }),
    );

    expect(translated.messages).toEqual([
      { role: 'user', content: 'first second' },
    ]);
  });

  it('translates Responses function tools and named tool choice', () => {
    const translated = responsesToChatCompletion(
      parseResponsesRequest({
        model: 'coding',
        input: 'Write a file.',
        tools: [
          {
            type: 'function',
            name: 'write_file',
            description: 'Write content to disk',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
            strict: true,
          },
        ],
        tool_choice: { type: 'function', name: 'write_file' },
      }),
    );

    expect(translated).toMatchObject({
      tools: [
        {
          type: 'function',
          function: {
            name: 'write_file',
            description: 'Write content to disk',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
            strict: true,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'write_file' } },
    });
  });

  it('allows explicitly disabled storage and background execution', () => {
    expect(
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        store: false,
        background: false,
      }),
    ).toMatchObject({ store: false, background: false });
  });

  it('rejects malformed generation controls with stable invalid_request errors', () => {
    const invalidRequests = [
      { max_output_tokens: 0 },
      { max_output_tokens: '100' },
      { temperature: -0.1 },
      { temperature: 2.1 },
      { top_p: -0.1 },
      { top_p: 1.1 },
      { parallel_tool_calls: 'yes' },
      { stream: 'yes' },
    ];

    for (const fields of invalidRequests) {
      try {
        parseResponsesRequest({ model: 'coding', input: 'hello', ...fields });
        throw new Error('Expected request parsing to fail');
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 400,
          code: 'invalid_request',
        });
      }
    }
  });

  it('rejects invalid function tool boundaries', () => {
    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        tools: [{ type: 'function', name: 'bad name', strict: 'yes' }],
      }),
    ).toThrowError(GatewayHttpError);

    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        tools: [{ type: 'function', name: 'valid_name', strict: 'yes' }],
      }),
    ).toThrowError(/strict must be a boolean/);
  });

  it('translates streaming function tools with usage reporting enabled', () => {
    expect(
      responsesToChatCompletion(
        parseResponsesRequest({
          model: 'coding',
          input: 'hello',
          stream: true,
          max_output_tokens: 100,
          tools: [
            {
              type: 'function',
              name: 'write_file',
              parameters: { type: 'object', properties: {} },
            },
          ],
          tool_choice: { type: 'function', name: 'write_file' },
          parallel_tool_calls: false,
        }),
      ),
    ).toMatchObject({
      model: 'coding',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 100,
      tools: [
        {
          type: 'function',
          function: {
            name: 'write_file',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'write_file' } },
      parallel_tool_calls: false,
    });
  });

  it('rejects ambiguous tool configuration before routing', () => {
    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        stream: true,
        tool_choice: 'required',
      }),
    ).toThrowError(/at least one function tool/);

    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        stream: true,
        tools: [
          {
            type: 'function',
            name: 'write_file',
            parameters: { type: 'object', properties: {} },
          },
        ],
        tool_choice: { type: 'function', name: 'read_file' },
      }),
    ).toThrowError(/not present in tools/);

    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        input: 'hello',
        tools: [
          { type: 'function', name: 'write_file' },
          { type: 'function', name: 'write_file' },
        ],
      }),
    ).toThrowError(/duplicated/);
  });

  it('rejects image input rather than silently dropping capability requirements', () => {
    expect(() =>
      responsesToChatCompletion(
        parseResponsesRequest({
          model: 'coding',
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: 'https://example.test/a.png',
                },
              ],
            },
          ],
        }),
      ),
    ).toThrowError(/only input_text/);
  });

  it('normalizes assistant text, tool calls, public model, and usage', () => {
    expect(
      chatCompletionToResponse(
        {
          id: 'chatcmpl_123',
          created: 123,
          model: 'private-upstream-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Done.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"a"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
        'coding',
      ),
    ).toMatchObject({
      id: 'chatcmpl_123',
      object: 'response',
      created_at: 123,
      status: 'completed',
      model: 'coding',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
        },
        {
          type: 'function_call',
          id: 'call_1',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{"path":"a"}',
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  });

  it('fails closed for malformed upstream function calls', () => {
    expect(() =>
      chatCompletionToResponse(
        {
          id: 'chatcmpl_bad_tool',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'write_file', arguments: 123 },
                  },
                ],
              },
            },
          ],
        },
        'coding',
      ),
    ).toThrowError(/malformed function call/);
  });

  it('fails closed for invalid upstream usage values', () => {
    expect(() =>
      chatCompletionToResponse(
        {
          id: 'chatcmpl_bad_usage',
          choices: [
            {
              message: { role: 'assistant', content: 'hello' },
            },
          ],
          usage: { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
        },
        'coding',
      ),
    ).toThrowError(/prompt_tokens/);
  });
});
