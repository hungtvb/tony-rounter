import { GatewayHttpError } from '../errors.js';
import { normalizeChatCompletionChunk } from './protocol.js';

export interface CanonicalSseEvent {
  readonly wire: string;
  readonly done: boolean;
}

function parseEventBlock(block: string): string | undefined {
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line === 'data') {
      dataLines.push('');
      continue;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  return dataLines.length > 0 ? dataLines.join('\n') : undefined;
}

export class OpenAISseDecoder {
  readonly #decoder = new TextDecoder('utf-8', { fatal: true });
  #buffer = '';

  push(chunk: Uint8Array): readonly string[] {
    try {
      this.#buffer += this.#decoder.decode(chunk, { stream: true });
    } catch {
      throw new GatewayHttpError(
        502,
        'upstream_invalid_stream',
        'Upstream stream contains invalid UTF-8',
      );
    }
    return this.#drainCompleteEvents();
  }

  finish(): readonly string[] {
    try {
      this.#buffer += this.#decoder.decode();
    } catch {
      throw new GatewayHttpError(
        502,
        'upstream_invalid_stream',
        'Upstream stream contains invalid UTF-8',
      );
    }

    const events = this.#drainCompleteEvents();
    if (this.#buffer.trim().length > 0) {
      throw new GatewayHttpError(
        502,
        'upstream_truncated_stream',
        'Upstream stream ended with an incomplete SSE event',
      );
    }
    this.#buffer = '';
    return events;
  }

  #drainCompleteEvents(): readonly string[] {
    const events: string[] = [];

    while (true) {
      const delimiter = /\r?\n\r?\n/.exec(this.#buffer);
      if (!delimiter) break;

      const block = this.#buffer.slice(0, delimiter.index);
      this.#buffer = this.#buffer.slice(delimiter.index + delimiter[0].length);
      const data = parseEventBlock(block);
      if (data !== undefined) events.push(data);
    }

    return events;
  }
}

export function canonicalizeChatSseData(
  data: string,
  requestedModel?: string,
): CanonicalSseEvent {
  if (data.trim() === '[DONE]') {
    return { wire: 'data: [DONE]\n\n', done: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new GatewayHttpError(
      502,
      'upstream_invalid_stream',
      'Upstream emitted malformed streaming JSON',
    );
  }

  const chunk = normalizeChatCompletionChunk(parsed, requestedModel);
  return {
    wire: `data: ${JSON.stringify(chunk)}\n\n`,
    done: false,
  };
}

export function canonicalStreamError(
  requestId: string,
  code: string,
  message: string,
): string {
  return `data: ${JSON.stringify({
    error: {
      code,
      message,
      request_id: requestId,
    },
  })}\n\n`;
}
