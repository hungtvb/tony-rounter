import type { FastifyInstance, FastifyReply } from 'fastify';

import type { GatewayTelemetry } from './telemetry.js';
import { UI_JS } from './ui-assets/client.js';
import { UI_HTML } from './ui-assets/html.js';
import { UI_CSS } from './ui-assets/styles.js';

export type UiProviderMode =
  'openai-compatible' | 'static-registry' | 'unconfigured';

export interface UiRuntimeInfo {
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly tokenSource: 'environment' | 'file' | 'generated';
  readonly provider: {
    readonly mode: UiProviderMode;
    readonly baseUrl?: string;
    readonly credentialConfigured: boolean;
  };
}

export interface InstallUiRoutesOptions {
  readonly telemetry: GatewayTelemetry;
  readonly runtime: UiRuntimeInfo;
}

function secureUiHeaders(reply: FastifyReply): void {
  reply.header(
    'content-security-policy',
    "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('cache-control', 'no-store');
}

export function installUiRoutes(
  app: FastifyInstance,
  options: InstallUiRoutesOptions,
): void {
  app.get('/', (_request, reply) => {
    reply.code(302).header('location', '/ui').send();
  });

  const renderUi = (_request: unknown, reply: FastifyReply) => {
    secureUiHeaders(reply);
    return reply.type('text/html; charset=utf-8').send(UI_HTML);
  };

  app.get('/ui', renderUi);
  app.get('/ui/', renderUi);

  app.get('/ui/styles.css', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/css; charset=utf-8').send(UI_CSS);
  });

  app.get('/ui/app.js', (_request, reply) => {
    secureUiHeaders(reply);
    return reply.type('text/javascript; charset=utf-8').send(UI_JS);
  });

  app.get('/ui/api/dashboard', () => ({
    gateway: {
      version: options.runtime.version,
      host: options.runtime.host,
      port: options.runtime.port,
      tokenSource: options.runtime.tokenSource,
    },
    provider: options.runtime.provider,
    telemetry: options.telemetry.snapshot(),
  }));
}
