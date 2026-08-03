export { buildGateway } from './app.js';
export type { BuildGatewayOptions, GatewayModel } from './app.js';
export { GatewayConfigError, loadGatewayConfig } from './config.js';
export {
  LocalConfigStore,
  LocalConfigStoreError,
  loadManagedRouterSources,
} from './control/config-store.js';
export type {
  ControlApplyResult,
  ControlGenerationSummary,
  ControlValidationSummary,
  ManagedRouterSources,
} from './control/config-store.js';
export type {
  GatewayConfig,
  LoadGatewayConfigOptions,
  OpenAIUpstreamConfig,
} from './config.js';
export { GatewayHttpError } from './errors.js';
export { createJsonLogger, createNullLogger } from './logger.js';
export type { JsonLogger, JsonLoggerOptions } from './logger.js';
export { OpenAICompatibleClient } from './openai/client.js';
export type {
  ChatCompletionResult,
  OpenAICompatibleProvider,
  ProviderRequestContext,
} from './openai/client.js';
export {
  normalizeChatCompletionChunk,
  normalizeChatCompletionResponse,
  normalizeModelList,
  parseChatCompletionRequest,
} from './openai/protocol.js';
export type {
  CanonicalModel,
  CanonicalModelList,
  ChatCompletionRequest,
} from './openai/protocol.js';
export {
  chatCompletionToResponse,
  parseResponsesRequest,
  responsesToChatCompletion,
} from './openai/responses.js';
export type { ResponsesRequest } from './openai/responses.js';
export {
  GatewayRouterConfigError,
  loadGatewayRouterConfig,
  parseGatewayRouterSources,
  routerSensitiveValues,
} from './routing/config.js';
export type {
  GatewayRouterConfig,
  LoadGatewayRouterConfigOptions,
  ParseGatewayRouterSourcesOptions,
  ParsedGatewayRouterSources,
  RoutedAccountConfig,
  RoutedProviderConfig,
} from './routing/config.js';
export { RoutedOpenAIProvider } from './routing/provider.js';
export type {
  AccountHealthProbeResult,
  AccountHealthStatus,
  RoutedChatCompletionResult,
  RoutedChatRequestContext,
  RoutedOpenAIProviderOptions,
} from './routing/provider.js';
export { createGracefulShutdown, installSignalHandlers } from './shutdown.js';
export type { ShutdownResult } from './shutdown.js';

export interface GatewayProbe {
  readonly name: 'tony-router';
  readonly status: 'initializing';
  readonly version: string;
}

export function createGatewayProbe(version = '0.2.0'): GatewayProbe {
  return {
    name: 'tony-router',
    status: 'initializing',
    version,
  };
}
