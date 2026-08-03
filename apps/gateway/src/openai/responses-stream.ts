import { GatewayHttpError } from '../errors.js';

type JsonRecord = Readonly<Record<string, unknown>>;

export interface ResponsesTextStreamOptions {
  readonly model: string;
  readonly instructions?: string;
  readonly maxOutputTokens?: number;
  readonly parallelToolCalls?: boolean;
  readonly temperature?: number;
  readonly topP?: number;
  readonly nowSeconds?: () => number;
}

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
  if (!isRecord(value))
    return streamFailure('Upstream usage must be an object');

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

export class ResponsesTextStreamEncoder {
  readonly #options: ResponsesTextStreamOptions;
  readonly #nowSeconds: () => number;
  #sequence = 0;
  #started = false;
  #done = false;
  #finishSeen = false;
  #upstreamId: string | undefined;
  #responseId: string | undefined;
  #itemId: string | undefined;
  #createdAt: number | undefined;
  #text = '';
  #usage: JsonRecord | undefined;

  constructor(options: ResponsesTextStreamOptions) {
    if (options.model.trim().length === 0) {
      throw new TypeError('model must be a non-empty string');
    }
    this.#options = options;
    this.#nowSeconds =
      options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
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
      return unsupported(
        'Text Responses streaming supports exactly one choice',
      );
    }

    const events: string[] = [];
    if (!this.#started) events.push(...this.#start(chunk));
    if (chunk.id !== this.#upstreamId) {
      return streamFailure('Upstream streaming response ID changed mid-stream');
    }

    const normalizedUsage = usage(chunk.usage);
    if (normalizedUsage) this.#usage = normalizedUsage;

    const choice = chunk.choices[0];
    if (!choice) return events;
    if (choice.index !== undefined && choice.index !== 0) {
      return unsupported(
        'Text Responses streaming supports only choice index zero',
      );
    }
    if (!isRecord(choice.delta)) {
      return streamFailure('Upstream streaming choice delta is invalid');
    }

    const delta = choice.delta;
    if (delta.role !== undefined && delta.role !== 'assistant') {
      return unsupported(
        'Text Responses streaming supports only assistant output',
      );
    }
    if (
      delta.tool_calls !== undefined ||
      delta.function_call !== undefined ||
      delta.refusal !== undefined
    ) {
      return unsupported('This slice supports only text deltas');
    }
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') {
        return streamFailure('Upstream text delta must be a string');
      }
      if (delta.content.length > 0) {
        this.#text += delta.content;
        events.push(
          this.#event('response.output_text.delta', {
            item_id: this.#requiredItemId(),
            output_index: 0,
            content_index: 0,
            delta: delta.content,
            logprobs: [],
          }),
        );
      }
    }

    const finishReason = choice.finish_reason;
    if (finishReason !== undefined && finishReason !== null) {
      if (finishReason !== 'stop') {
        return unsupported('Upstream emitted an unsupported finish reason');
      }
      if (this.#finishSeen) {
        return streamFailure('Upstream emitted multiple finish reasons');
      }
      this.#finishSeen = true;
    }
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
    const suffix = idSuffix(this.#upstreamId);
    this.#responseId = `resp_${suffix}`;
    this.#itemId = `msg_${suffix}`;
    this.#createdAt =
      safeInteger(chunk.created, 'created') ?? this.#nowSeconds();

    const response = this.#response('in_progress', []);
    const item = this.#message('in_progress', []);
    return [
      this.#event('response.created', { response }),
      this.#event('response.in_progress', { response }),
      this.#event('response.output_item.added', {
        output_index: 0,
        item,
      }),
      this.#event('response.content_part.added', {
        item_id: this.#requiredItemId(),
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
      }),
    ];
  }

  #complete(): readonly string[] {
    if (!this.#started) {
      return streamFailure('Upstream stream ended before any output event');
    }
    if (!this.#finishSeen) {
      return streamFailure('Upstream stream ended before a finish reason');
    }

    const part = {
      type: 'output_text',
      text: this.#text,
      annotations: [],
      logprobs: [],
    };
    const item = this.#message('completed', [part]);
    const response = this.#response('completed', [item]);
    this.#done = true;

    return [
      this.#event('response.output_text.done', {
        item_id: this.#requiredItemId(),
        output_index: 0,
        content_index: 0,
        text: this.#text,
        logprobs: [],
      }),
      this.#event('response.content_part.done', {
        item_id: this.#requiredItemId(),
        output_index: 0,
        content_index: 0,
        part,
      }),
      this.#event('response.output_item.done', {
        output_index: 0,
        item,
      }),
      this.#event('response.completed', { response }),
    ];
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

  #message(
    status: 'in_progress' | 'completed',
    content: readonly JsonRecord[],
  ): JsonRecord {
    return {
      id: this.#requiredItemId(),
      type: 'message',
      status,
      role: 'assistant',
      content,
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
      tool_choice: 'auto',
      tools: [],
      top_p: this.#options.topP ?? 1,
      truncation: 'disabled',
      usage: completed ? (this.#usage ?? null) : null,
      metadata: {},
    };
  }

  #requiredResponseId(): string {
    if (!this.#responseId)
      return streamFailure('Response stream was not initialized');
    return this.#responseId;
  }

  #requiredItemId(): string {
    if (!this.#itemId)
      return streamFailure('Response stream was not initialized');
    return this.#itemId;
  }

  #requiredCreatedAt(): number {
    if (this.#createdAt === undefined) {
      return streamFailure('Response stream was not initialized');
    }
    return this.#createdAt;
  }
}
