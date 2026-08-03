import { Readable } from 'node:stream';

import { GatewayHttpError } from '../errors.js';
import { OpenAISseDecoder } from './sse.js';
import {
  ResponsesTextStreamEncoder,
  type ResponsesTextStreamOptions,
} from './responses-stream.js';

function byteChunk(value: unknown): Uint8Array {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return value;
  throw new GatewayHttpError(
    502,
    'upstream_invalid_stream',
    'Upstream emitted a non-text response chunk',
  );
}

function mappedError(error: unknown): GatewayHttpError {
  if (error instanceof GatewayHttpError) return error;
  return new GatewayHttpError(
    502,
    'upstream_invalid_stream',
    'Upstream response stream failed unexpectedly',
  );
}

function errorWire(sequenceNumber: number, error: GatewayHttpError): string {
  return `event: error\ndata: ${JSON.stringify({
    type: 'error',
    sequence_number: sequenceNumber,
    code: error.code,
    message: error.publicMessage,
    param: null,
  })}\n\n`;
}

function encodeDataEvents(
  decoder: OpenAISseDecoder,
  encoder: ResponsesTextStreamEncoder,
  chunk: unknown,
): readonly string[] {
  return decoder.push(byteChunk(chunk)).flatMap((data) => encoder.push(data));
}

function finishEvents(
  decoder: OpenAISseDecoder,
  encoder: ResponsesTextStreamEncoder,
): readonly string[] {
  const wires = decoder.finish().flatMap((data) => encoder.push(data));
  encoder.end();
  return wires;
}

async function closeIterator(iterator: AsyncIterator<unknown>): Promise<void> {
  if (!iterator.return) return;
  await iterator.return().catch(() => undefined);
}

export async function prepareResponsesTextStream(
  upstream: Readable,
  options: ResponsesTextStreamOptions,
): Promise<Readable> {
  const source: AsyncIterable<unknown> = upstream;
  const iterator = source[Symbol.asyncIterator]();
  const decoder = new OpenAISseDecoder();
  const encoder = new ResponsesTextStreamEncoder(options);
  let initialWires: readonly string[] = [];
  let upstreamDone = false;

  try {
    while (initialWires.length === 0) {
      const chunk = await iterator.next();
      if (chunk.done) {
        upstreamDone = true;
        initialWires = finishEvents(decoder, encoder);
        break;
      }
      initialWires = encodeDataEvents(decoder, encoder, chunk.value);
    }
  } catch (error) {
    await closeIterator(iterator);
    if (!upstream.destroyed) upstream.destroy();
    throw mappedError(error);
  }

  const generator = async function* (): AsyncGenerator<string> {
    let emittedEvents = 0;
    try {
      for (const wire of initialWires) {
        emittedEvents += 1;
        yield wire;
      }

      while (!upstreamDone) {
        const chunk = await iterator.next();
        if (chunk.done) {
          upstreamDone = true;
          for (const wire of finishEvents(decoder, encoder)) {
            emittedEvents += 1;
            yield wire;
          }
          break;
        }

        for (const wire of encodeDataEvents(decoder, encoder, chunk.value)) {
          emittedEvents += 1;
          yield wire;
        }
      }
    } catch (error) {
      const mapped = mappedError(error);
      if (emittedEvents === 0) throw mapped;
      yield errorWire(emittedEvents, mapped);
    } finally {
      if (!upstreamDone) await closeIterator(iterator);
      if (!upstream.destroyed) upstream.destroy();
    }
  };

  return Readable.from(generator(), { encoding: 'utf8' });
}
