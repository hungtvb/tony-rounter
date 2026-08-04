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

export interface ResponsesTextFormatText extends Readonly<
  Record<string, unknown>
> {
  readonly type: 'text';
}

export interface ResponsesTextFormatJsonSchema extends Readonly<
  Record<string, unknown>
> {
  readonly type: 'json_schema';
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly strict?: boolean;
}

export type ResponsesTextFormat =
  ResponsesTextFormatText | ResponsesTextFormatJsonSchema;

export interface ResponsesTextConfig extends Readonly<Record<string, unknown>> {
  readonly format?: ResponsesTextFormat;
}

export type ResponsesReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type ResponsesReasoningSummary = 'auto' | 'concise' | 'detailed';

export interface ResponsesReasoningConfig extends Readonly<
  Record<string, unknown>
> {
  readonly effort?: ResponsesReasoningEffort;
  readonly summary?: ResponsesReasoningSummary;
}

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
  readonly text?: ResponsesTextConfig;
  readonly reasoning?: ResponsesReasoningConfig;
  readonly store?: false;
  readonly background?: false;
}

type JsonRecord = Readonly<Record<string, unknown>>;

const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

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

function hasPrefix(value: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function matchesImageFormat(mime: string, value: Uint8Array): boolean {
  switch (mime.toLowerCase()) {
    case 'png':
      return hasPrefix(value, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return hasPrefix(value, [0xff, 0xd8, 0xff]);
    case 'gif':
      return (
        Buffer.from(value.subarray(0, 6)).toString('ascii') === 'GIF87a' ||
        Buffer.from(value.subarray(0, 6)).toString('ascii') === 'GIF89a'
      );
    case 'webp':
      return (
        Buffer.from(value.subarray(0, 4)).toString('ascii') === 'RIFF' &&
        Buffer.from(value.subarray(8, 12)).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

function imageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    return invalid('input_image image_url must be a non-empty string');
  }
  if (value !== value.trim()) {
    return invalid(
      'input_image image_url must not contain surrounding whitespace',
    );
  }
  if (value.slice(0, 5).toLowerCase() === 'data:') {
    const match = IMAGE_DATA_URL_PATTERN.exec(value);
    if (!match) {
      return invalid(
        'input_image data URLs must contain base64 PNG, JPEG, GIF, or WEBP image data',
      );
    }
    const mime = match[1];
    const payload = match[2];
    if (mime === undefined || payload === undefined) {
      return invalid('input_image data URL contains invalid base64 image data');
    }
    if (payload.length % 4 === 1) {
      return invalid('input_image data URL contains invalid base64 image data');
    }
    const normalized = payload.replace(/=+$/, '');
    const decoded = Buffer.from(payload, 'base64');
    if (
      decoded.length === 0 ||
      decoded.toString('base64').replace(/=+$/, '') !== normalized ||
      !matchesImageFormat(mime, decoded)
    ) {
      return invalid(
        'input_image data URL bytes must match the declared image format',
      );
    }
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid(
      'input_image image_url must be a valid URL or image data URL',
    );
  }
  if (parsed.protocol !== 'https:') {
    return unsupported(
      'this phase supports only HTTPS image URLs and image data URLs',
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return invalid('input_image image_url must not contain URL credentials');
  }
  return value;
}

function imageDetail(value: unknown): 'auto' | 'low' | 'high' {
  if (value === undefined) return 'auto';
  if (value === 'auto' || value === 'low' || value === 'high') return value;
  return invalid('input_image detail must be auto, low, or high');
}

function inputContent(
  content: unknown,
  role: 'user' | 'assistant' | 'system' | 'developer',
): string | readonly JsonRecord[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    return invalid('message content must be a string or an array');
  }
  if (content.length === 0) {
    return invalid('message content array must contain at least one item');
  }

  const parts: JsonRecord[] = [];
  let hasImage = false;
  for (const part of content) {
    if (!isRecord(part)) {
      return invalid('input content items must be JSON objects');
    }

    if (
      part.type === 'input_text' ||
      (role === 'assistant' && part.type === 'output_text')
    ) {
      if (typeof part.text !== 'string') {
        return invalid('text content must contain a string text value');
      }
      parts.push({ type: 'text', text: part.text });
      continue;
    }

    if (part.type === 'input_image') {
      if (role !== 'user') {
        return unsupported(
          'this phase supports input_image only in user messages',
        );
      }
      if (part.file_id !== undefined && part.file_id !== null) {
        return unsupported(
          'input_image file_id is not implemented in this phase',
        );
      }
      if (part.image_url === undefined) {
        return invalid('input_image must contain image_url');
      }
      hasImage = true;
      parts.push({
        type: 'image_url',
        image_url: {
          url: imageUrl(part.image_url),
          detail: imageDetail(part.detail),
        },
      });
      continue;
    }

    if (part.type === 'input_file') {
      return unsupported('input_file is not implemented in this phase');
    }

    return unsupported(
      'this phase supports input_text, user input_image, and replayed assistant output_text content',
    );
  }

  if (hasImage) return parts;
  return parts.map((part) => String(part.text)).join('');
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
        content: inputContent(item.content, item.role),
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

function unsupportedKeys(
  value: JsonRecord,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unsupportedKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupportedKey !== undefined) {
    unsupported(
      `${label} field ${unsupportedKey} is not implemented in this phase`,
    );
  }
}

const TEXT_CONFIG_KEYS = new Set(['format']);
const TEXT_FORMAT_TEXT_KEYS = new Set(['type']);
const TEXT_FORMAT_JSON_SCHEMA_KEYS = new Set([
  'type',
  'name',
  'description',
  'schema',
  'strict',
]);

function textFormat(value: unknown): ResponsesTextFormat {
  if (!isRecord(value)) {
    return invalid('text.format must be a JSON object');
  }
  if (typeof value.type !== 'string') {
    return invalid('text.format type must be a string');
  }

  if (value.type === 'text') {
    unsupportedKeys(value, TEXT_FORMAT_TEXT_KEYS, 'text.format');
    return { type: 'text' };
  }
  if (value.type === 'json_object') {
    return unsupported(
      'legacy json_object text format is not implemented; use json_schema',
    );
  }
  if (value.type !== 'json_schema') {
    return unsupported(`text.format type ${value.type} is not implemented`);
  }

  unsupportedKeys(value, TEXT_FORMAT_JSON_SCHEMA_KEYS, 'text.format');
  const name = validateFunctionName(value.name, 'text.format name');
  if (!isRecord(value.schema)) {
    return invalid('text.format json_schema schema must be a JSON object');
  }
  if (
    value.description !== undefined &&
    typeof value.description !== 'string'
  ) {
    return invalid(
      'text.format json_schema description must be a string when provided',
    );
  }
  if (value.strict !== undefined && typeof value.strict !== 'boolean') {
    return invalid(
      'text.format json_schema strict must be a boolean when provided',
    );
  }

  return {
    type: 'json_schema',
    name,
    schema: value.schema,
    ...(value.description !== undefined
      ? { description: value.description }
      : {}),
    ...(value.strict !== undefined ? { strict: value.strict } : {}),
  };
}

function textConfig(value: unknown): ResponsesTextConfig {
  if (!isRecord(value)) return invalid('text must be a JSON object');
  unsupportedKeys(value, TEXT_CONFIG_KEYS, 'text');
  if (value.format === undefined) return {};
  return { format: textFormat(value.format) };
}

const REASONING_CONFIG_KEYS = new Set(['effort', 'summary']);
const REASONING_EFFORTS = new Set<ResponsesReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);
const REASONING_SUMMARIES = new Set<ResponsesReasoningSummary>([
  'auto',
  'concise',
  'detailed',
]);

function reasoningConfig(value: unknown): ResponsesReasoningConfig {
  if (!isRecord(value)) return invalid('reasoning must be a JSON object');
  unsupportedKeys(value, REASONING_CONFIG_KEYS, 'reasoning');

  if (
    value.effort !== undefined &&
    (typeof value.effort !== 'string' ||
      !REASONING_EFFORTS.has(value.effort as ResponsesReasoningEffort))
  ) {
    return invalid(
      'reasoning effort must be none, minimal, low, medium, high, or xhigh',
    );
  }
  if (
    value.summary !== undefined &&
    (typeof value.summary !== 'string' ||
      !REASONING_SUMMARIES.has(value.summary as ResponsesReasoningSummary))
  ) {
    return invalid('reasoning summary must be auto, concise, or detailed');
  }

  return {
    ...(value.effort !== undefined
      ? { effort: value.effort as ResponsesReasoningEffort }
      : {}),
    ...(value.summary !== undefined
      ? { summary: value.summary as ResponsesReasoningSummary }
      : {}),
  };
}

function responseReasoning(
  value: ResponsesReasoningConfig | undefined,
): JsonRecord {
  return {
    effort: value?.effort ?? null,
    summary: value?.summary ?? null,
  };
}

function chatResponseFormat(
  value: ResponsesTextConfig | undefined,
): JsonRecord | undefined {
  const format = value?.format;
  if (!format || format.type === 'text') return undefined;
  return {
    type: 'json_schema',
    json_schema: {
      name: format.name,
      schema: format.schema,
      ...(format.description !== undefined
        ? { description: format.description }
        : {}),
      ...(format.strict !== undefined ? { strict: format.strict } : {}),
    },
  };
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
  const normalizedText =
    value.text === undefined ? undefined : textConfig(value.text);
  const normalizedReasoning =
    value.reasoning === undefined
      ? undefined
      : reasoningConfig(value.reasoning);

  return {
    ...value,
    ...(normalizedText !== undefined ? { text: normalizedText } : {}),
    ...(normalizedReasoning !== undefined
      ? { reasoning: normalizedReasoning }
      : {}),
  } as ResponsesRequest;
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
  const responseFormat = chatResponseFormat(request.text);
  if (responseFormat !== undefined) {
    translated.response_format = responseFormat;
  }
  if (request.reasoning?.effort !== undefined) {
    translated.reasoning_effort = request.reasoning.effort;
  }
  if (request.reasoning?.summary !== undefined) {
    translated.reasoning_summary = request.reasoning.summary;
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

  const completionDetails = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : undefined;
  const reasoningTokens = nonNegativeInteger(
    completionDetails?.reasoning_tokens,
    'completion_tokens_details.reasoning_tokens',
  );
  const normalizedInputTokens = inputTokens ?? 0;
  const normalizedOutputTokens = outputTokens ?? 0;
  return {
    input_tokens: normalizedInputTokens,
    output_tokens: normalizedOutputTokens,
    output_tokens_details: { reasoning_tokens: reasoningTokens ?? 0 },
    total_tokens: totalTokens ?? normalizedInputTokens + normalizedOutputTokens,
  };
}

export function chatCompletionToResponse(
  value: Readonly<Record<string, unknown>>,
  requestedModel: string,
  requestedTextFormat: ResponsesTextFormat = { type: 'text' },
  requestedReasoning?: ResponsesReasoningConfig,
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
  const idBase =
    value.id.replace(/[^A-Za-z0-9_-]/g, '').slice(-48) || 'response';

  if (
    message.reasoning_summary !== undefined &&
    message.reasoning_summary !== null
  ) {
    if (
      typeof message.reasoning_summary !== 'string' ||
      message.reasoning_summary.length === 0
    ) {
      return upstreamInvalid(
        'Upstream reasoning_summary must be a non-empty string or null',
      );
    }
    output.push({
      id: `rs_${idBase}`,
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: message.reasoning_summary }],
    });
  }

  const hasText = typeof message.content === 'string';
  const hasRefusal = typeof message.refusal === 'string';
  if (hasText && hasRefusal) {
    return upstreamInvalid(
      'Upstream returned assistant text and refusal together',
    );
  }
  if (
    message.refusal !== undefined &&
    message.refusal !== null &&
    typeof message.refusal !== 'string'
  ) {
    return upstreamInvalid(
      'Upstream assistant refusal must be a string or null',
    );
  }
  if (hasText || hasRefusal) {
    output.push({
      id: `msg_${idBase}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: hasRefusal
        ? [{ type: 'refusal', refusal: message.refusal }]
        : [{ type: 'output_text', text: message.content, annotations: [] }],
    });
  } else if (
    message.content !== undefined &&
    message.content !== null &&
    typeof message.content !== 'string'
  ) {
    return upstreamInvalid(
      'Upstream assistant content must be a string or null',
    );
  }

  if (
    hasRefusal &&
    message.tool_calls !== undefined &&
    message.tool_calls !== null
  ) {
    return upstreamInvalid('Upstream returned refusal and tool calls together');
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
    reasoning: responseReasoning(requestedReasoning),
    text: { format: requestedTextFormat },
    ...(normalizedUsage ? { usage: normalizedUsage } : {}),
  };
}
