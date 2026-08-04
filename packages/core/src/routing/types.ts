import type {
  ModelCapabilities,
  RequiredCapabilities,
} from '../capabilities.js';

export type ProviderKind = 'openai-compatible';
export type RoutingConfigVersion = 1 | 2;

export interface RoutingProvider {
  readonly id: string;
  readonly kind: ProviderKind;
}

export interface RoutingAccount {
  readonly id: string;
  readonly providerId: string;
}

export interface RoutingModel {
  readonly id: string;
  readonly providerId: string;
  readonly upstreamModel: string;
  readonly capabilities: ModelCapabilities;
}

export interface RoutingRoute {
  readonly id: string;
  readonly modelId: string;
  readonly accountId: string;
  readonly enabled: boolean;
  readonly priority: number;
}

export interface RoutingProfileRoute {
  readonly routeId: string;
  readonly priority: number;
}

export interface RoutingProfile {
  readonly id: string;
  readonly routes: readonly RoutingProfileRoute[];
}

export interface RoutingConfig {
  readonly version: RoutingConfigVersion;
  readonly defaultProfileId: string;
  readonly providers: Readonly<Record<string, RoutingProvider>>;
  readonly accounts: Readonly<Record<string, RoutingAccount>>;
  readonly models: Readonly<Record<string, RoutingModel>>;
  readonly routes: Readonly<Record<string, RoutingRoute>>;
  readonly profiles: Readonly<Record<string, RoutingProfile>>;
}

export interface RouteRuntimeState {
  readonly healthy?: boolean;
  readonly available?: boolean;
}

export type RouteRejectionCode =
  | 'not_in_profile'
  | 'route_disabled'
  | 'route_unhealthy'
  | 'route_unavailable'
  | 'missing_tools'
  | 'missing_parallel_tool_calls'
  | 'missing_vision'
  | 'missing_structured_output'
  | 'missing_reasoning'
  | 'insufficient_context';

export interface RouteRejection {
  readonly code: RouteRejectionCode;
  readonly required?: number | boolean;
  readonly actual?: number | boolean;
}

export interface RouteScore {
  readonly profilePriority: number;
  readonly routePriority: number;
}

export interface RouteCandidateTrace {
  readonly routeId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly accepted: boolean;
  readonly rejections: readonly RouteRejection[];
  readonly score?: RouteScore;
}

export interface SelectedRoute {
  readonly routeId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly accountId: string;
  readonly upstreamModel: string;
  readonly score: RouteScore;
  readonly affinityRetained: boolean;
}

export interface RoutingDecision {
  readonly profileId: string;
  readonly requiredCapabilities: RequiredCapabilities;
  readonly selected?: SelectedRoute;
  readonly candidates: readonly RouteCandidateTrace[];
}

export interface SelectRouteInput {
  readonly profileId?: string;
  readonly requiredCapabilities: RequiredCapabilities;
  readonly routeStates?: Readonly<Record<string, RouteRuntimeState>>;
  readonly affinityRouteId?: string;
}

export interface EngineRouteInput extends SelectRouteInput {
  readonly sessionId?: string;
}
