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
      max_tokens: 800,
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

  it('rejects streaming until the Responses SSE contract is implemented', () => {
    expect(() =>
      parseResponsesRequest({ model: 'coding', input: 'hello', stream: true }),
    ).toThrowError(GatewayHttpError);

    try {
      parseResponsesRequest({ model: 'coding', input: 'hello', stream: true });
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        code: 'unsupported_responses_feature',
      });
    }
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
});
