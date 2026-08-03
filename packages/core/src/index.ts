export {
  deriveRequiredCapabilities,
  supportsCapabilities,
} from './capabilities.js';
export type {
  CapabilityInput,
  ModelCapabilities,
  RequiredCapabilities,
} from './capabilities.js';
export {
  CircuitBreakerRegistry,
  CircuitPermit,
} from './runtime/circuit-breaker.js';
export type {
  CircuitAcquireResult,
  CircuitAllowed,
  CircuitBreakerConfig,
  CircuitDenied,
  CircuitKey,
  CircuitSnapshot,
  CircuitState,
} from './runtime/circuit-breaker.js';
export {
  executeRoutedRequest,
  RoutedExecutionError,
} from './runtime/fallback.js';
export type {
  ExecuteRoutedRequestInput,
  ExecutionTraceEvent,
  FallbackPolicy,
  RoutedExecutionErrorCode,
  RoutedExecutionResult,
  RoutedOperation,
  RoutedOperationContext,
} from './runtime/fallback.js';
export {
  classifyProviderFailure,
  ProviderExecutionError,
  providerExecutionError,
} from './runtime/failure.js';
export type {
  CircuitFailureImpact,
  ProviderExecutionErrorOptions,
  ProviderFailure,
  ProviderFailureKind,
} from './runtime/failure.js';
export { InMemorySessionAffinityStore } from './routing/affinity.js';
export type { SessionAffinityStore } from './routing/affinity.js';
export { parseRoutingConfig, RoutingConfigError } from './routing/config.js';
export {
  RoutingEngine,
  RoutingSelectionError,
  selectRoute,
} from './routing/engine.js';
export { deriveChatRequestCapabilities } from './routing/request.js';
export type { ChatCapabilityOptions } from './routing/request.js';
export type {
  EngineRouteInput,
  ProviderKind,
  RoutingAccount,
  RoutingConfigVersion,
  RouteCandidateTrace,
  RouteRejection,
  RouteRejectionCode,
  RouteRuntimeState,
  RouteScore,
  RoutingConfig,
  RoutingDecision,
  RoutingModel,
  RoutingProfile,
  RoutingProfileRoute,
  RoutingProvider,
  RoutingRoute,
  SelectRouteInput,
  SelectedRoute,
} from './routing/types.js';
