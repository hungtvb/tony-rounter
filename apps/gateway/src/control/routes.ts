import type { FastifyInstance, FastifyRequest } from 'fastify';

import { GatewayHttpError } from '../errors.js';
import { createRequestAbortContext } from '../request-abort.js';
import { GatewayRouterConfigError } from '../routing/config.js';
import type { RoutedOpenAIProvider } from '../routing/provider.js';
import { LocalConfigStoreError } from './config-store.js';
import type { LocalConfigStore } from './config-store.js';

interface ConfigSourcesPayload {
  readonly routingSource: string;
  readonly bindingSource: string;
}

interface RollbackPayload {
  readonly generationId: string;
}

function recordBody(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GatewayHttpError(
      400,
      'invalid_control_payload',
      'Control request body must be a JSON object',
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((field) => !allowedSet.has(field))) {
    throw new GatewayHttpError(
      400,
      'invalid_control_payload',
      'Control request contains unsupported fields',
    );
  }
}

function configSources(value: unknown): ConfigSourcesPayload {
  const body = recordBody(value);
  exactFields(body, ['routingSource', 'bindingSource']);
  if (
    typeof body.routingSource !== 'string' ||
    typeof body.bindingSource !== 'string'
  ) {
    throw new GatewayHttpError(
      400,
      'invalid_control_payload',
      'routingSource and bindingSource must be strings',
    );
  }
  return Object.freeze({
    routingSource: body.routingSource,
    bindingSource: body.bindingSource,
  });
}

function rollbackPayload(value: unknown): RollbackPayload {
  const body = recordBody(value);
  exactFields(body, ['generationId']);
  if (typeof body.generationId !== 'string') {
    throw new GatewayHttpError(
      400,
      'invalid_control_payload',
      'generationId must be a string',
    );
  }
  return Object.freeze({ generationId: body.generationId });
}

function controlError(error: unknown): GatewayHttpError {
  if (error instanceof GatewayHttpError) return error;
  if (error instanceof GatewayRouterConfigError) {
    return new GatewayHttpError(
      400,
      'invalid_router_configuration',
      'Routing and provider configuration did not pass validation',
    );
  }
  if (error instanceof LocalConfigStoreError) {
    const statusCode =
      error.code === 'generation_not_found'
        ? 404
        : error.code === 'control_state_missing'
          ? 409
          : error.code.startsWith('invalid_') ||
              error.code.startsWith('unsafe_') ||
              error.code === 'config_too_large'
            ? 400
            : 500;
    return new GatewayHttpError(
      statusCode,
      error.code,
      statusCode >= 500
        ? 'The local configuration store failed safely'
        : error.message,
    );
  }
  return new GatewayHttpError(
    500,
    'control_operation_failed',
    'The local control operation failed safely',
  );
}

function requireStore(store: LocalConfigStore | undefined): LocalConfigStore {
  if (!store) {
    throw new GatewayHttpError(
      503,
      'local_control_not_configured',
      'Local configuration control is not enabled',
    );
  }
  return store;
}

function accountId(request: FastifyRequest): string {
  const params = request.params as Readonly<Record<string, unknown>>;
  if (typeof params.accountId !== 'string') {
    throw new GatewayHttpError(
      400,
      'invalid_account_id',
      'Account ID is invalid',
    );
  }
  return params.accountId;
}

export interface InstallControlRoutesOptions {
  readonly store?: LocalConfigStore;
  readonly routed?: RoutedOpenAIProvider;
}

export function installControlRoutes(
  app: FastifyInstance,
  options: InstallControlRoutesOptions,
): void {
  app.post('/ui/api/control/validate', (request) => {
    try {
      const payload = configSources(request.body);
      return {
        validation: requireStore(options.store).validate(
          payload.routingSource,
          payload.bindingSource,
        ),
      };
    } catch (error) {
      throw controlError(error);
    }
  });

  app.post('/ui/api/control/apply', async (request) => {
    try {
      const payload = configSources(request.body);
      return {
        result: await requireStore(options.store).apply(
          payload.routingSource,
          payload.bindingSource,
        ),
      };
    } catch (error) {
      throw controlError(error);
    }
  });

  app.get('/ui/api/control/generations', async () => {
    try {
      const store = requireStore(options.store);
      return {
        restartRequired: store.restartRequired,
        generations: await store.listGenerations(),
      };
    } catch (error) {
      throw controlError(error);
    }
  });

  app.post('/ui/api/control/rollback', async (request) => {
    try {
      const payload = rollbackPayload(request.body);
      return {
        result: await requireStore(options.store).rollback(
          payload.generationId,
        ),
      };
    } catch (error) {
      throw controlError(error);
    }
  });

  app.post('/ui/api/providers/:accountId/health', async (request, reply) => {
    if (!options.routed) {
      throw new GatewayHttpError(
        503,
        'routed_provider_not_configured',
        'Account health probes require routed provider mode',
      );
    }
    const abortContext = createRequestAbortContext(request, reply);
    try {
      return {
        probe: await options.routed.probeAccount(accountId(request), {
          requestId: request.id,
          signal: abortContext.signal,
        }),
      };
    } finally {
      abortContext.cleanup();
    }
  });
}
