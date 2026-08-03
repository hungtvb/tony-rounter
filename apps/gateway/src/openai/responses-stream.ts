import { GatewayHttpError } from '../errors.js';
import type {
  ResponsesFunctionTool,
  ResponsesToolChoice,
} from './responses.js';

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ResponsesStreamOptions {
  readonly model: string;
  readonly instructions?: string;
  readonly maxOutputTokens?: number;
  readonly parallelToolCalls?: boolean;
  readonly temperature?: number;
  readonly topP?: number;
  readonly tools?: readonly ResponsesFunctionTool[];
  readonly toolChoice?: ResponsesToolChoice;
  readonly nowSeconds?: () => number;
}

interface MessageOutputState {
  readonly kind: 'message';
  readonly outputIndex: number;
  readonly itemId: string;
  text: string;
}

interface FunctionCallOutputState {
  readonly kind: 'function_call';
  readonly toolIndex: number;
  readonly outputIndex: number;
  readonly itemId: string;
  readonly callId: string;
  readonly name: string;
  arguments: string;
}

type OutputState = MessageOutputState | FunctionCallOutputState;

const FUNCTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_FUNCTION_CALLS = 32;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: string, message: string): never {
  throw new GatewayHttpError(502, code, message);
}

function streamFailure(message: string): never {
  return fail('upstream_invalid_stream', message);
}

function unsupported(message: string): never {
  return fail('upstream_unsupported_stream_event', message);
}

function parseJson(data: string): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return streamFailure('Upstream emitted malformed streaming JSON');
  }
  if (!isRecord(parsed)) {
    return streamFailure('Upstream emitted a non-object streaming event');
  }
  if ('error' in parsed) {
    return fail(
      'upstream_stream_error',
      'Upstream emitted an error during streaming',
    );
  }
  return parsed;
}

function safeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return streamFailure(
      `Upstream ${name} must be a non-negative safe integer`,
    );
  }
  return value;
}

function usage(value: unknown): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    return streamFailure('Upstream usage must be an object');
  }

  const inputTokens = safeInteger(value.prompt_tokens, 'prompt_tokens');
  const outputTokens = safeInteger(
    value.completion_tokens,
    'completion_tokens',
  );
  const totalTokens = safeInteger(value.total_tokens, 'total_tokens');
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  const normalizedInput = inputTokens ?? 0;
  const normalizedOutput = outputTokens ?? 0;
  return {
    input_tokens: normalizedInput,
    output_tokens: normalizedOutput,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: totalTokens ?? normalizedInput + normalizedOutput,
  };
}

function idSuffix(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(-64) || 'tony_router';
}

function wire(event: JsonRecord): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
}

function namedToolChoice(
  value: ResponsesToolChoice | undefined,
): string | undefined {
  if (!isRecord(value) || value.type !== 'function') return undefined;
  return typeof value.name === 'string' ? value.name : undefined;
}

function configuredFunctionNames(
  tools: readonly ResponsesFunctionTool[] | undefined,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const tool of tools ?? []) {
    names.add(tool.name);
  }
  return names;
}

export class ResponsesStreamEncoder {
  readonly #options: ResponsesStreamOptions;
  readonly #nowSeconds: () => number;
  readonly #configuredFunctionNames: ReadonlySet<string>;
  readonly #namedToolChoice: string | undefined;
  readonly #outputs: OutputState[] = [];
  readonly #toolCalls = new Map<number, FunctionCallOutputState>();
  readonly #callIds = new Set<string>();
  #sequence = 0;
  #started = false;
  #done = false;
  #finishSeen = false;
  #finishReason: 'stop' | 'tool_calls' | undefined;
  #upstreamId: string | undefined;
  #responseId: string | undefined;
  #createdAt: number | undefined;
  #message: MessageOutputState | undefined;
  #usage: JsonRecord | undefined;

  constructor(options: ResponsesStreamOptions) {
    if (options.model.trim().length === 0) {
      throw new TypeError('model must be a non-empty string');
    }
    this.#options = options;
    this.#nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.#configuredFunctionNames = configuredFunctionNames(options.tools);
    this.#namedToolChoice = namedToolChoice(options.toolChoice);
  }

  push(data: string): readonly string[] {
    if (this.#done) {
      return streamFailure('Upstream emitted data after the terminal event');
    }
    if (data.trim() === '[DONE]') return this.#complete();

    const chunk = parseJson(data);
    if (typeof chunk.id !== 'string' || chunk.id.length === 0) {
      return streamFailure('Upstream streaming chunk has no valid ID');
    }
    if (!Array.isArray(chunk.choices) || !chunk.choices.every(isRecord)) {
      return streamFailure('Upstream streaming choices are invalid');
    }
    if (!this.#started && chunk.choices.length === 0) {
      return streamFailure('Upstream stream started without an output choice');
    }
    if (chunk.choices.length > 1) {
      return unsupported('Responses streaming supports exactly one choice');
    }

    const events: string[] = [];
    if (!this.#started) events.push(...this.#start(chunk));
    if (chunk.id !== this.#upstreamId) {
      return streamFailure('Upstream streaming response ID changed mid-stream');
    }
    if (this.#finishSeen && chunk.choices.length > 0) {
      return streamFailure('Upstream emitted output after a finish reason');
    }

    const normalizedUsage = usage(chunk.usage);
    if (normalizedUsage) this.#usage = normalizedUsage;

    const choice = chunk.choices[0];
    if (!choice) return events;
    if (choice.index !== undefined && choice.index !== 0) {
      return unsupported('Responses streaming supports only choice index zero');
    }
    if (!isRecord(choice.delta)) {
      return streamFailure('Upstream streaming choice delta is invalid');
    }

    const delta = choice.delta;
    if (delta.role !== undefined && delta.role !== 'assistant') {
      return unsupported('Responses streaming supports only assistant output');
    }
    if (delta.function_call !== undefined || delta.refusal !== undefined) {
      return unsupported('Upstream emitted an unsupported streaming delta');
    }
    if (
      typeof delta.content === 'string' &&
      delta.content.length > 0 &&
      Array.isArray(delta.tool_calls) &&
      delta.tool_calls.length > 0
    ) {
      return unsupported(
        'Upstream emitted text and function calls in the same delta',
      );
    }

    events.push(...this.#textEvents(delta.content));
    events.push(...this.#toolCallEvents(delta.tool_calls));
    this.#finish(choice.finish_reason);
    return events;
  }

  end(): void {
    if (!this.#done) {
      streamFailure('Upstream stream ended before the terminal event');
    }
  }

  #start(chunk: JsonRecord): readonly string[] {
    this.#started = true;
    this.#upstreamId = chunk.id as string;
    this.#responseId = `resp_${idSuffix(this.#upstreamId)}`;
    this.#createdAt =
      safeInteger(chunk.created, 'created') ?? this.#nowSeconds();
    const response = this.#response('in_progress', []);
    return [
      this.#event('response.created', { response }),
      this.#event('response.in_progress', { response }),
    ];
  }

  #textEvents(value: unknown): readonly string[] {
    if (value === undefined || value === null) return [];
    if (typeof value !== 'string') {
      return streamFailure('Upstream text delta must be a string');
    }
    if (value.length === 0) return [];

    const events: string[] = [];
    if (!this.#message) {
      const message: MessageOutputState = {
        kind: 'message',
        outputIndex: this.#outputs.length,
        itemId: `msg_${idSuffix(this.#requiredUpstreamId())}`,
        text: '',
      };
      this.#message = message;
      this.#outputs.push(message);
      events.push(
        this.#event('response.output_item.added', {
          output_index: message.outputIndex,
          item: this.#messageItem(message, 'in_progress'),
        }),
        this.#event('response.content_part.added', {
          item_id: message.itemId,
          output_index: message.outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text: '',
            annotations: [],
            logprobs: [],
          },
        }),
      );
    }

    this.#message.text += value;
    events.push(
      this.#event('response.output_text.delta', {
        item_id: this.#message.itemId,
        output_index: this.#message.outputIndex,
        content_index: 0,
        delta: value,
        logprobs: [],
      }),
    );
    return events;
  }

  #toolCallEvents(value: unknown): readonly string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every(isRecord)) {
      return streamFailure('Upstream tool call deltas must be an array');
    }

    const events: string[] = [];
    const indices = new Set<number>();
    for (const entry of value) {
      const toolIndex = safeInteger(entry.index, 'tool call index');
      if (toolIndex === undefined || toolIndex >= MAX_FUNCTION_CALLS) {
        return streamFailure(
          `Upstream tool call index must be less than ${MAX_FUNCTION_CALLS}`,
        );
      }
      if (indices.has(toolIndex)) {
        return streamFailure(
          'Upstream repeated a tool call index in one chunk',
        );
      }
      indices.add(toolIndex);
      events.push(...this.#toolCallDelta(toolIndex, entry));
    }
    return events;
  }

  #toolCallDelta(toolIndex: number, entry: JsonRecord): readonly string[] {
    if (entry.type !== undefined && entry.type !== 'function') {
      return unsupported('Upstream emitted an unsupported tool call type');
    }
    if (!isRecord(entry.function)) {
      return streamFailure('Upstream function call delta is invalid');
    }

    const functionDelta = entry.function;
    let state = this.#toolCalls.get(toolIndex);
    const events: string[] = [];
    if (!state) {
      if (toolIndex !== this.#toolCalls.size) {
        return streamFailure(
          'Upstream introduced a non-contiguous function call index',
        );
      }
      if (
        this.#options.parallelToolCalls === false &&
        this.#toolCalls.size > 0
      ) {
        return streamFailure(
          'Upstream emitted multiple calls when parallel_tool_calls is false',
        );
      }
      if (typeof entry.id !== 'string' || !CALL_ID_PATTERN.test(entry.id)) {
        return streamFailure('Upstream function call has no valid call ID');
      }
      if (
        typeof functionDelta.name !== 'string' ||
        !FUNCTION_NAME_PATTERN.test(functionDelta.name)
      ) {
        return streamFailure('Upstream function call has no valid name');
      }
      if (this.#callIds.has(entry.id)) {
        return streamFailure('Upstream reused a function call ID');
      }
      if (this.#configuredFunctionNames.size === 0) {
        return streamFailure(
          'Upstream emitted a function call without configured tools',
        );
      }
      if (!this.#configuredFunctionNames.has(functionDelta.name)) {
        return streamFailure('Upstream called an unconfigured function');
      }
      if (
        this.#namedToolChoice !== undefined &&
        functionDelta.name !== this.#namedToolChoice
      ) {
        return streamFailure(
          'Upstream called a function other than tool_choice',
        );
      }
      if (this.#options.toolChoice === 'none') {
        return streamFailure(
          'Upstream emitted a function call for tool_choice none',
        );
      }
      if (
        functionDelta.arguments !== undefined &&
        typeof functionDelta.arguments !== 'string'
      ) {
        return streamFailure(
          'Upstream function arguments delta must be a string',
        );
      }

      state = {
        kind: 'function_call',
        toolIndex,
        outputIndex: this.#outputs.length,
        itemId: `fc_${idSuffix(entry.id)}_${toolIndex}`,
        callId: entry.id,
        name: functionDelta.name,
        arguments: '',
      };
      this.#toolCalls.set(toolIndex, state);
      this.#callIds.add(state.callId);
      this.#outputs.push(state);
      events.push(
        this.#event('response.output_item.added', {
          output_index: state.outputIndex,
          item: this.#functionCallItem(state, 'in_progress'),
        }),
      );
    } else {
      if (entry.id !== undefined && entry.id !== state.callId) {
        return streamFailure('Upstream function call ID changed mid-stream');
      }
      if (
        functionDelta.name !== undefined &&
        functionDelta.name !== state.name
      ) {
        return streamFailure('Upstream function call name changed mid-stream');
      }
      if (
        functionDelta.arguments !== undefined &&
        typeof functionDelta.arguments !== 'string'
      ) {
        return streamFailure(
          'Upstream function arguments delta must be a string',
        );
      }
    }

    const argumentsDelta = functionDelta.arguments;
    if (typeof argumentsDelta === 'string' && argumentsDelta.length > 0) {
      state.arguments += argumentsDelta;
      events.push(
        this.#event('response.function_call_arguments.delta', {
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: argumentsDelta,
        }),
      );
    }
    return events;
  }

  #finish(value: unknown): void {
    if (value === undefined || value === null) return;
    if (value !== 'stop' && value !== 'tool_calls') {
      return unsupported('Upstream emitted an unsupported finish reason');
    }
    if (this.#finishSeen) {
      return streamFailure('Upstream emitted multiple finish reasons');
    }
    if (value === 'tool_calls' && this.#toolCalls.size === 0) {
      return streamFailure(
        'Upstream finished for tool calls without a function call',
      );
    }
    if (value === 'stop' && this.#toolCalls.size > 0) {
      return streamFailure('Upstream finished with stop after a function call');
    }
    if (
      value === 'stop' &&
      (this.#options.toolChoice === 'required' ||
        this.#namedToolChoice !== undefined)
    ) {
      return streamFailure(
        'Upstream completed without the required function call',
      );
    }
    this.#finishSeen = true;
    this.#finishReason = value;
  }

  #complete(): readonly string[] {
    if (!this.#started) {
      return streamFailure('Upstream stream ended before any output event');
    }
    if (!this.#finishSeen || !this.#finishReason) {
      return streamFailure('Upstream stream ended before a finish reason');
    }
    if (this.#outputs.length === 0) {
      return streamFailure('Upstream stream contained no supported output');
    }

    const events: string[] = [];
    const completedOutputs: JsonRecord[] = [];
    for (const output of this.#outputs) {
      if (output.kind === 'message') {
        const part = {
          type: 'output_text',
          text: output.text,
          annotations: [],
          logprobs: [],
        };
        const item = this.#messageItem(output, 'completed');
        events.push(
          this.#event('response.output_text.done', {
            item_id: output.itemId,
            output_index: output.outputIndex,
            content_index: 0,
            text: output.text,
            logprobs: [],
          }),
          this.#event('response.content_part.done', {
            item_id: output.itemId,
            output_index: output.outputIndex,
            content_index: 0,
            part,
          }),
          this.#event('response.output_item.done', {
            output_index: output.outputIndex,
            item,
          }),
        );
        completedOutputs.push(item);
      } else {
        const item = this.#functionCallItem(output, 'completed');
        events.push(
          this.#event('response.function_call_arguments.done', {
            item_id: output.itemId,
            output_index: output.outputIndex,
            arguments: output.arguments,
          }),
          this.#event('response.output_item.done', {
            output_index: output.outputIndex,
            item,
          }),
        );
        completedOutputs.push(item);
      }
    }

    const response = this.#response('completed', completedOutputs);
    this.#done = true;
    events.push(this.#event('response.completed', { response }));
    return events;
  }

  #event(type: string, fields: JsonRecord): string {
    const event = {
      type,
      ...fields,
      sequence_number: this.#sequence,
    };
    this.#sequence += 1;
    return wire(event);
  }

  #messageItem(
    output: MessageOutputState,
    status: 'in_progress' | 'completed',
  ): JsonRecord {
    return {
      id: output.itemId,
      type: 'message',
      status,
      role: 'assistant',
      content:
        status === 'completed'
          ? [
              {
                type: 'output_text',
                text: output.text,
                annotations: [],
                logprobs: [],
              },
            ]
          : [],
    };
  }

  #functionCallItem(
    output: FunctionCallOutputState,
    status: 'in_progress' | 'completed',
  ): JsonRecord {
    return {
      id: output.itemId,
      type: 'function_call',
      status,
      call_id: output.callId,
      name: output.name,
      arguments: output.arguments,
    };
  }

  #response(
    status: 'in_progress' | 'completed',
    output: readonly JsonRecord[],
  ): JsonRecord {
    const completed = status === 'completed';
    return {
      id: this.#requiredResponseId(),
      object: 'response',
      created_at: this.#requiredCreatedAt(),
      completed_at: completed ? this.#nowSeconds() : null,
      status,
      error: null,
      incomplete_details: null,
      instructions: this.#options.instructions ?? null,
      max_output_tokens: this.#options.maxOutputTokens ?? null,
      model: this.#options.model,
      output,
      parallel_tool_calls: this.#options.parallelToolCalls ?? true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: this.#options.temperature ?? 1,
      text: { format: { type: 'text' } },
      tool_choice: this.#options.toolChoice ?? 'auto',
      tools: this.#options.tools ?? [],
      top_p: this.#options.topP ?? 1,
      truncation: 'disabled',
      usage: completed ? (this.#usage ?? null) : null,
      metadata: {},
    };
  }

  #requiredUpstreamId(): string {
    if (!this.#upstreamId) {
      return streamFailure('Response stream was not initialized');
    }
    return this.#upstreamId;
  }

  #requiredResponseId(): string {
    if (!this.#responseId) {
      return streamFailure('Response stream was not initialized');
    }
    return this.#responseId;
  }

  #requiredCreatedAt(): number {
    if (this.#createdAt === undefined) {
      return streamFailure('Response stream was not initialized');
    }
    return this.#createdAt;
  }
}
