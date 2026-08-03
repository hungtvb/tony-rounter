import { GatewayHttpError } from '../errors.js';
import type { ChatCompletionRequest } from './protocol.js';

export interface ResponsesRequest extends Readonly<Record<string, unknown>> {
  readonly model: string;
  readonly input: string | readonly unknown[];
  readonly instructions?: string;
  readonly stream?: false;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new GatewayHttpError(400, 'invalid_request', message);
}

function unsupported(message: string): never {
  throw new GatewayHttpError(400, 'unsupported_responses_feature', message);
}

function inputText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content))
    return invalid('message content must be a string or an array');

  const text: string[] = [];
  for (const part of content) {
    if (!isRecord(part))
      return invalid('input content items must be JSON objects');
    if (part.type === 'input_text' && typeof part.text === 'string') {
      text.push(part.text);
      continue;
    }
    unsupported('this phase supports only input_text message content');
  }
  return text.join('');
}

function responseInputMessages(
  input: ResponsesRequest['input'],
): readonly JsonRecord[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input))
    return invalid('input must be a string or an array');

  return input.map((item) => {
    if (!isRecord(item)) return invalid('input items must be JSON objects');
    if (item.type !== undefined && item.type !== 'message') {
      return unsupported('this phase supports only message input items');
    }
    if (
      item.role !== 'user' &&
      item.role !== 'assistant' &&
      item.role !== 'system' &&
      item.role !== 'developer'
    ) {
      return invalid(
        'message role must be user, assistant, system, or developer',
      );
    }
    return { role: item.role, content: inputText(item.content) };
  });
}

function translateTools(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value))
    return invalid('tools must be an array when provided');
  return value.map((tool) => {
    if (!isRecord(tool)) return invalid('tool entries must be JSON objects');
    if (tool.type !== 'function') {
      return unsupported('this phase supports only function tools');
    }
    if (typeof tool.name !== 'string' || tool.name.trim().length === 0) {
      return invalid('function tool name must be a non-empty string');
    }
    if (
      tool.description !== undefined &&
      typeof tool.description !== 'string'
    ) {
      return invalid(
        'function tool description must be a string when provided',
      );
    }
    if (tool.parameters !== undefined && !isRecord(tool.parameters)) {
      return invalid(
        'function tool parameters must be a JSON object when provided',
      );
    }
    return {
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
        ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
      },
    };
  });
}

function translateToolChoice(value: unknown): unknown {
  if (value === 'none' || value === 'auto' || value === 'required')
    return value;
  if (!isRecord(value)) return invalid('tool_choice is invalid');
  if (value.type !== 'function' || typeof value.name !== 'string') {
    return unsupported('this phase supports only named function tool_choice');
  }
  return { type: 'function', function: { name: value.name } };
}

export function parseResponsesRequest(value: unknown): ResponsesRequest {
  if (!isRecord(value)) return invalid('Request body must be a JSON object');
  if (typeof value.model !== 'string' || value.model.trim().length === 0) {
    return invalid('model must be a non-empty string');
  }
  if (value.input === undefined) return invalid('input is required');
  if (
    value.instructions !== undefined &&
    typeof value.instructions !== 'string'
  ) {
    return invalid('instructions must be a string when provided');
  }
  if (value.stream === true) {
    return unsupported(
      'streaming Responses API is not implemented in this phase',
    );
  }
  if (value.stream !== undefined && value.stream !== false) {
    return invalid('stream must be a boolean when provided');
  }
  if (
    value.previous_response_id !== undefined ||
    value.background !== undefined ||
    value.store !== undefined
  ) {
    return unsupported(
      'stored, background, and chained responses are not implemented',
    );
  }
  return value as ResponsesRequest;
}

export function responsesToChatCompletion(
  request: ResponsesRequest,
): ChatCompletionRequest {
  const messages: JsonRecord[] = [];
  if (request.instructions) {
    messages.push({ role: 'developer', content: request.instructions });
  }
  messages.push(...responseInputMessages(request.input));

  const translated: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: false,
  };
  if (request.max_output_tokens !== undefined) {
    translated.max_tokens = request.max_output_tokens;
  }
  if (request.temperature !== undefined)
    translated.temperature = request.temperature;
  if (request.top_p !== undefined) translated.top_p = request.top_p;
  if (request.tools !== undefined)
    translated.tools = translateTools(request.tools);
  if (request.tool_choice !== undefined) {
    translated.tool_choice = translateToolChoice(request.tool_choice);
  }
  if (request.parallel_tool_calls !== undefined) {
    if (typeof request.parallel_tool_calls !== 'boolean') {
      return invalid('parallel_tool_calls must be a boolean when provided');
    }
    translated.parallel_tool_calls = request.parallel_tool_calls;
  }

  return translated as ChatCompletionRequest;
}

function usage(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens =
    typeof value.prompt_tokens === 'number' ? value.prompt_tokens : 0;
  const outputTokens =
    typeof value.completion_tokens === 'number' ? value.completion_tokens : 0;
  const totalTokens =
    typeof value.total_tokens === 'number'
      ? value.total_tokens
      : inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

export function chatCompletionToResponse(
  value: Readonly<Record<string, unknown>>,
  requestedModel: string,
): Readonly<Record<string, unknown>> {
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first: unknown = choices[0];
  if (!isRecord(first)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream returned no response message',
    );
  }
  const rawMessage: unknown = first.message;
  if (!isRecord(rawMessage)) {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_response',
      'Upstream returned no response message',
    );
  }

  const message = rawMessage;
  const output: JsonRecord[] = [];
  if (typeof message.content === 'string') {
    output.push({
      id: `msg_${
        String(value.id)
          .replace(/[^A-Za-z0-9_-]/g, '')
          .slice(-48) || 'response'
      }`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        { type: 'output_text', text: message.content, annotations: [] },
      ],
    });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const entry of message.tool_calls) {
      if (!isRecord(entry) || !isRecord(entry.function)) continue;
      const callId = typeof entry.id === 'string' ? entry.id : undefined;
      const name =
        typeof entry.function.name === 'string'
          ? entry.function.name
          : undefined;
      const argumentsValue =
        typeof entry.function.arguments === 'string'
          ? entry.function.arguments
          : '{}';
      if (callId && name) {
        output.push({
          type: 'function_call',
          id: callId,
          call_id: callId,
          name,
          arguments: argumentsValue,
          status: 'completed',
        });
      }
    }
  }

  const normalizedUsage = usage(value.usage);
  return {
    id: typeof value.id === 'string' ? value.id : 'resp_tony_router',
    object: 'response',
    created_at:
      typeof value.created === 'number'
        ? value.created
        : Math.floor(Date.now() / 1000),
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    model: requestedModel,
    output,
    parallel_tool_calls: true,
    ...(normalizedUsage ? { usage: normalizedUsage } : {}),
  };
}
