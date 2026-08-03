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

  it('replays assistant output, function calls, and tool results as chat history', () => {
    const translated = responsesToChatCompletion(
      parseResponsesRequest({
        model: 'coding',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Write the file.' }],
          },
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: 'I will write it now.',
                annotations: [],
              },
            ],
          },
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'write_file',
            arguments: '{"path":"a.txt","content":"hello"}',
            status: 'completed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: '{"ok":true}',
          },
        ],
      }),
    );

    expect(translated.messages).toEqual([
      { role: 'user', content: 'Write the file.' },
      {
        role: 'assistant',
        content: 'I will write it now.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"a.txt","content":"hello"}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ]);
  });

  it('preserves parallel call and output ordering', () => {
    const translated = responsesToChatCompletion(
      parseResponsesRequest({
        model: 'coding',
        input: [
          {
            type: 'function_call',
            call_id: 'call_read',
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
            status: 'completed',
          },
          {
            type: 'function_call',
            call_id: 'call_stat',
            name: 'stat_file',
            arguments: '{"path":"a.txt"}',
            status: 'completed',
          },
          {
            type: 'function_call_output',
            call_id: 'call_stat',
            output: [{ type: 'input_text', text: '{"size":5}' }],
          },
          {
            type: 'function_call_output',
            call_id: 'call_read',
            output: 'hello',
          },
        ],
      }),
    );

    expect(translated.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_read',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            },
          },
          {
            id: 'call_stat',
            type: 'function',
            function: {
              name: 'stat_file',
              arguments: '{"path":"a.txt"}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_stat', content: '{"size":5}' },
      { role: 'tool', tool_call_id: 'call_read', content: 'hello' },
    ]);
  });

  it('supports multiple completed function-call turns in one manual history', () => {
    const translated = responsesToChatCompletion(
      parseResponsesRequest({
        model: 'coding',
        input: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'hello',
          },
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'write_file',
            arguments: '{"path":"b.txt"}',
          },
          {
            type: 'function_call',
            call_id: 'call_3',
            name: 'stat_file',
            arguments: '{"path":"b.txt"}',
          },
          {
            type: 'function_call_output',
            call_id: 'call_2',
            output: 'written',
          },
          {
            type: 'function_call_output',
            call_id: 'call_3',
            output: '{"size":0}',
          },
        ],
      }),
    );

    expect(translated.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"b.txt"}',
            },
          },
          {
            id: 'call_3',
            type: 'function',
            function: {
              name: 'stat_file',
              arguments: '{"path":"b.txt"}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_2', content: 'written' },
      { role: 'tool', tool_call_id: 'call_3', content: '{"size":0}' },
    ]);
  });

  it('rejects malformed or incomplete manual function history', () => {
    const invalidInputs = [
      [
        {
          type: 'function_call_output',
          call_id: 'call_missing',
          output: 'orphan',
        },
      ],
      [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
      ],
      [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      ],
      [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
        { type: 'function_call_output', call_id: 'call_1', output: 'again' },
      ],
      [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
        { type: 'message', role: 'user', content: 'continue' },
      ],
      [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: [
            { type: 'input_image', image_url: 'data:image/png;base64,x' },
          ],
        },
      ],
      [
        {
          type: 'function_call',
          call_id: 'invalid call id',
          name: 'write_file',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'invalid call id',
          output: 'ok',
        },
      ],
    ];

    for (const input of invalidInputs) {
      expect(() =>
        responsesToChatCompletion(
          parseResponsesRequest({ model: 'coding', input }),
        ),
      ).toThrowError(GatewayHttpError);
    }
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

  it('keeps server-side previous_response_id chaining unsupported', () => {
    expect(() =>
      parseResponsesRequest({
        model: 'coding',
        previous_response_id: 'resp_previous',
        input: [
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'done',
          },
        ],
      }),
    ).toThrowError(/chained responses are not implemented/);
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
