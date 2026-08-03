import { GatewayHttpError } from '../errors.js';
import type { ChatCompletionRequest } from './protocol.js';

export interface ResponsesFunctionTool extends Readonly<
  Record<string, unknown>
> {
  readonly type: 'function';
  readonly name: string;
  readonly description?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly strict?: boolean;
}

export type ResponsesToolChoice =
  'none' | 'auto' | 'required' | Readonly<{ type: 'function'; name: string }>;

export interface ResponsesRequest extends Readonly<Record<string, unknown>> {
  readonly model: string;
  readonly input: string | readonly unknown[];
  readonly instructions?: string;
  readonly stream?: boolean;
  readonly max_output_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly parallel_tool_calls?: boolean;
  readonly tools?: readonly ResponsesFunctionTool[];
  readonly tool_choice?: ResponsesToolChoice;
  readonly store?: false;
  readonly background?: false;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new GatewayHttpError(400, 'invalid_request', message);
}

function unsupported(message: string): never {
  throw new GatewayHttpError(400, 'unsupported_responses_feature', message);
}

function upstreamInvalid(message: string): never {
  throw new GatewayHttpError(502, 'upstream_invalid_response', message);
}

function validateOptionalInteger(
  value: unknown,
  name: string,
  minimum: number,
): void {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    invalid(
      `${name} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
}

function validateOptionalNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (value === undefined) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(
      `${name} must be a finite number between ${minimum} and ${maximum}`,
    );
  }
}

function inputText(
  content: unknown,
  role: 'user' | 'assistant' | 'system' | 'developer',
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    return invalid('message content must be a string or an array');
  }
  if (content.length === 0) {
    return invalid('message content array must contain at least one item');
  }

  const text: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      return invalid('input content items must be JSON objects');
    }
    const supportedType =
      part.type === 'input_text' ||
      (role === 'assistant' && part.type === 'output_text');
    if (!supportedType) {
      return unsupported(
        'this phase supports only input_text content and replayed assistant output_text content',
      );
    }
    if (typeof part.text !== 'string') {
      return invalid('input_text content must contain a string text value');
    }
    text.push(part.text);
  }
  return text.join('');
}

function toolOutputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) {
    return invalid('function_call_output output must be a string or an array');
  }
  if (output.length === 0) {
    return invalid('function_call_output output array must not be empty');
  }

  const text: string[] = [];
  for (const part of output) {
    if (!isRecord(part)) {
      return invalid('function_call_output content items must be JSON objects');
    }
    if (part.type !== 'input_text') {
      return unsupported(
        'this phase supports only input_text function_call_output content',
      );
    }
    if (typeof part.text !== 'string') {
      return invalid(
        'function_call_output input_text content must contain a string text value',
      );
    }
    text.push(part.text);
  }
  return text.join('');
}

function validateCompletedStatus(value: unknown, label: string): void {
  if (value === undefined || value === 'completed') return;
  if (value !== 'in_progress' && value !== 'incomplete') {
    return invalid(`${label} status is invalid`);
  }
  invalid(`${label} must be completed before it can be replayed`);
}

function validateCallId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CALL_ID_PATTERN.test(value)) {
    return invalid(
      `${label} must contain 1 to 200 letters, numbers, underscores, or dashes`,
    );
  }
  return value;
}

function responseInputMessages(
  input: ResponsesRequest['input'],
): readonly JsonRecord[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) {
    return invalid('input must be a string or an array');
  }
  if (input.length === 0) {
    return invalid('input array must contain at least one item');
  }

  const messages: Record<string, unknown>[] = [];
  const calls = new Map<string, { readonly resolved: boolean }>();
  const pendingCallIds = new Set<string>();
  let toolOutputsStarted = false;
  let assistantToolMessage: Record<string, unknown> | undefined;
  let assistantToolCalls: JsonRecord[] | undefined;

  for (const item of input) {
    if (!isRecord(item)) return invalid('input items must be JSON objects');

    if (item.type === undefined || item.type === 'message') {
      if (pendingCallIds.size > 0) {
        return invalid(
          'all preceding function calls need outputs before the next message',
        );
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
      validateCompletedStatus(item.status, 'message input item');
      const message: Record<string, unknown> = {
        role: item.role,
        content: inputText(item.content, item.role),
      };
      messages.push(message);
      assistantToolMessage = item.role === 'assistant' ? message : undefined;
      assistantToolCalls = assistantToolMessage ? [] : undefined;
      toolOutputsStarted = false;
      continue;
    }

    if (item.type === 'function_call') {
      if (pendingCallIds.size === 0 && !assistantToolMessage) {
        toolOutputsStarted = false;
      }
      if (toolOutputsStarted && pendingCallIds.size > 0) {
        return invalid(
          'function calls must be listed before outputs for the current assistant turn',
        );
      }
      validateCompletedStatus(item.status, 'function_call input item');
      if (
        item.id !== undefined &&
        (typeof item.id !== 'string' || item.id.length === 0)
      ) {
        return invalid(
          'function_call id must be a non-empty string when provided',
        );
      }
      const callId = validateCallId(item.call_id, 'function_call call_id');
      if (calls.has(callId)) {
        return invalid(`function_call call_id ${callId} is duplicated`);
      }
      const name = validateFunctionName(item.name, 'function_call name');
      if (typeof item.arguments !== 'string') {
        return invalid('function_call arguments must be a string');
      }

      if (!assistantToolMessage) {
        assistantToolCalls = [];
        assistantToolMessage = {
          role: 'assistant',
          content: null,
          tool_calls: assistantToolCalls,
        };
        messages.push(assistantToolMessage);
      }
      assistantToolCalls ??= [];
      assistantToolCalls.push({
        id: callId,
        type: 'function',
        function: { name, arguments: item.arguments },
      });
      assistantToolMessage.tool_calls = assistantToolCalls;
      calls.set(callId, { resolved: false });
      pendingCallIds.add(callId);
      continue;
    }

    if (item.type === 'function_call_output') {
      validateCompletedStatus(item.status, 'function_call_output input item');
      const callId = validateCallId(
        item.call_id,
        'function_call_output call_id',
      );
      const call = calls.get(callId);
      if (!call) {
        return invalid(
          `function_call_output ${callId} does not reference a preceding function_call`,
        );
      }
      if (call.resolved) {
        return invalid(`function_call_output ${callId} is duplicated`);
      }
      const content = toolOutputText(item.output);
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content,
      });
      calls.set(callId, { resolved: true });
      pendingCallIds.delete(callId);
      assistantToolMessage = undefined;
      assistantToolCalls = undefined;
      toolOutputsStarted = true;
      continue;
    }

    return unsupported(
      'this phase supports only message, function_call, and function_call_output input items',
    );
  }

  if (pendingCallIds.size > 0) {
    return invalid(
      'every function_call input item requires one function_call_output',
    );
  }
  return messages;
}

function validateFunctionName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FUNCTION_NAME_PATTERN.test(value)) {
    return invalid(
      `${label} must contain 1 to 64 letters, numbers, underscores, or dashes`,
    );
  }
  return value;
}

function translateTools(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    return invalid('tools must be an array when provided');
  }
  const names = new Set<string>();
  return value.map((tool) => {
    if (!isRecord(tool)) return invalid('tool entries must be JSON objects');
    if (tool.type !== 'function') {
      return unsupported('this phase supports only function tools');
    }
    const name = validateFunctionName(tool.name, 'function tool name');
    if (names.has(name)) {
      return invalid(`function tool name ${name} is duplicated`);
    }
    names.add(name);
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
    if (tool.strict !== undefined && typeof tool.strict !== 'boolean') {
      return invalid('function tool strict must be a boolean when provided');
    }
    return {
      type: 'function',
      function: {
        name,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      },
    };
  });
}

function translateToolChoice(value: unknown): unknown {
  if (value === 'none' || value === 'auto' || value === 'required') {
    return value;
  }
  if (!isRecord(value)) return invalid('tool_choice is invalid');
  if (value.type !== 'function') {
    return unsupported('this phase supports only named function tool_choice');
  }
  const name = validateFunctionName(value.name, 'tool_choice function name');
  return { type: 'function', function: { name } };
}

function validateToolChoiceAgainstTools(value: JsonRecord): void {
  if (value.tool_choice === undefined) return;

  const names = new Set<string>();
  if (value.tools !== undefined) {
    for (const translated of translateTools(value.tools)) {
      if (!isRecord(translated.function)) {
        return invalid('translated function tool is invalid');
      }
      const name = translated.function.name;
      if (typeof name !== 'string') {
        return invalid('translated function tool name is invalid');
      }
      names.add(name);
    }
  }

  if (value.tool_choice === 'required' && names.size === 0) {
    invalid('tool_choice required needs at least one function tool');
  }
  if (isRecord(value.tool_choice) && value.tool_choice.type === 'function') {
    const name = validateFunctionName(
      value.tool_choice.name,
      'tool_choice function name',
    );
    if (!names.has(name)) {
      invalid(`tool_choice function ${name} is not present in tools`);
    }
  }
}

function validateDisabledFeature(
  value: unknown,
  name: 'store' | 'background',
): void {
  if (value === undefined || value === false) return;
  if (value !== true) return invalid(`${name} must be a boolean when provided`);
  unsupported(`${name}: true is not implemented in this phase`);
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
  if (value.stream !== undefined && typeof value.stream !== 'boolean') {
    return invalid('stream must be a boolean when provided');
  }
  if (value.previous_response_id !== undefined) {
    return unsupported('chained responses are not implemented in this phase');
  }

  validateDisabledFeature(value.store, 'store');
  validateDisabledFeature(value.background, 'background');
  validateOptionalInteger(value.max_output_tokens, 'max_output_tokens', 1);
  validateOptionalNumber(value.temperature, 'temperature', 0, 2);
  validateOptionalNumber(value.top_p, 'top_p', 0, 1);

  if (
    value.parallel_tool_calls !== undefined &&
    typeof value.parallel_tool_calls !== 'boolean'
  ) {
    return invalid('parallel_tool_calls must be a boolean when provided');
  }
  if (value.tools !== undefined) translateTools(value.tools);
  if (value.tool_choice !== undefined) translateToolChoice(value.tool_choice);
  validateToolChoiceAgainstTools(value);

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

  const streaming = request.stream === true;
  const translated: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: streaming,
    ...(streaming ? { stream_options: { include_usage: true } } : {}),
  };
  if (request.max_output_tokens !== undefined) {
    translated.max_completion_tokens = request.max_output_tokens;
  }
  if (request.temperature !== undefined) {
    translated.temperature = request.temperature;
  }
  if (request.top_p !== undefined) translated.top_p = request.top_p;
  if (request.tools !== undefined) {
    translated.tools = translateTools(request.tools);
  }
  if (request.tool_choice !== undefined) {
    translated.tool_choice = translateToolChoice(request.tool_choice);
  }
  if (request.parallel_tool_calls !== undefined) {
    translated.parallel_tool_calls = request.parallel_tool_calls;
  }

  return translated as ChatCompletionRequest;
}

function nonNegativeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return upstreamInvalid(
      `Upstream ${name} must be a non-negative safe integer`,
    );
  }
  return value;
}

function usage(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = nonNegativeInteger(value.prompt_tokens, 'prompt_tokens');
  const outputTokens = nonNegativeInteger(
    value.completion_tokens,
    'completion_tokens',
  );
  const totalTokens = nonNegativeInteger(value.total_tokens, 'total_tokens');

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  const normalizedInputTokens = inputTokens ?? 0;
  const normalizedOutputTokens = outputTokens ?? 0;
  return {
    input_tokens: normalizedInputTokens,
    output_tokens: normalizedOutputTokens,
    total_tokens: totalTokens ?? normalizedInputTokens + normalizedOutputTokens,
  };
}

export function chatCompletionToResponse(
  value: Readonly<Record<string, unknown>>,
  requestedModel: string,
): Readonly<Record<string, unknown>> {
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return upstreamInvalid('Upstream returned an invalid response ID');
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first: unknown = choices[0];
  if (!isRecord(first)) {
    return upstreamInvalid('Upstream returned no response message');
  }
  const rawMessage: unknown = first.message;
  if (!isRecord(rawMessage)) {
    return upstreamInvalid('Upstream returned no response message');
  }

  const message = rawMessage;
  const output: JsonRecord[] = [];
  if (typeof message.content === 'string') {
    output.push({
      id: `msg_${
        value.id.replace(/[^A-Za-z0-9_-]/g, '').slice(-48) || 'response'
      }`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        { type: 'output_text', text: message.content, annotations: [] },
      ],
    });
  } else if (message.content !== undefined && message.content !== null) {
    return upstreamInvalid(
      'Upstream assistant content must be a string or null',
    );
  }

  if (message.tool_calls !== undefined && message.tool_calls !== null) {
    if (!Array.isArray(message.tool_calls)) {
      return upstreamInvalid('Upstream tool_calls must be an array or null');
    }
    for (const entry of message.tool_calls) {
      if (!isRecord(entry) || !isRecord(entry.function)) {
        return upstreamInvalid('Upstream returned a malformed function call');
      }
      if (entry.type !== undefined && entry.type !== 'function') {
        return upstreamInvalid(
          'Upstream returned an unsupported tool call type',
        );
      }
      const callId = entry.id;
      const name = entry.function.name;
      const argumentsValue = entry.function.arguments;
      if (
        typeof callId !== 'string' ||
        callId.length === 0 ||
        typeof name !== 'string' ||
        !FUNCTION_NAME_PATTERN.test(name) ||
        typeof argumentsValue !== 'string'
      ) {
        return upstreamInvalid('Upstream returned a malformed function call');
      }
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

  if (output.length === 0) {
    return upstreamInvalid('Upstream response contained no supported output');
  }

  const normalizedUsage = usage(value.usage);
  return {
    id: value.id,
    object: 'response',
    created_at:
      typeof value.created === 'number' &&
      Number.isSafeInteger(value.created) &&
      value.created >= 0
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
