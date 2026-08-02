import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RequestAbortContext {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

export function createRequestAbortContext(
  request: FastifyRequest,
  reply: FastifyReply,
): RequestAbortContext {
  const controller = new AbortController();

  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('client disconnected'));
    }
  };
  const onResponseClose = (): void => {
    if (!reply.raw.writableEnded) abort();
  };
  const cleanup = (): void => {
    request.raw.off('aborted', abort);
    reply.raw.off('close', onResponseClose);
  };

  request.raw.once('aborted', abort);
  reply.raw.once('close', onResponseClose);

  return { signal: controller.signal, cleanup };
}
