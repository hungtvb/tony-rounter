import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { sendGatewayError } from './errors.js';

function matchesToken(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length);
  return token.length > 0 ? token : undefined;
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/health' ||
    pathname === '/ui' ||
    pathname.startsWith('/ui/')
  );
}

export function installBearerAuthentication(
  app: FastifyInstance,
  expectedToken: string,
): void {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? '/';
    if (isPublicPath(pathname)) return;

    const candidate = bearerToken(request.headers.authorization);
    if (candidate && matchesToken(candidate, expectedToken)) return;

    reply.header('www-authenticate', 'Bearer');
    return sendGatewayError(
      reply,
      401,
      'unauthorized',
      'A valid bearer token is required',
      request.id,
    );
  });
}
