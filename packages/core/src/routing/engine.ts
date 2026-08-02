import type {
  ModelCapabilities,
  RequiredCapabilities,
} from '../capabilities.js';
import type { SessionAffinityStore } from './affinity.js';
import type {
  EngineRouteInput,
  RouteCandidateTrace,
  RouteRejection,
  RouteRuntimeState,
  RouteScore,
  RoutingConfig,
  RoutingDecision,
  RoutingModel,
  RoutingProfileRoute,
  RoutingRoute,
  SelectRouteInput,
  SelectedRoute,
} from './types.js';

export class RoutingSelectionError extends Error {
  override readonly name = 'RoutingSelectionError';
}

function capabilityRejections(
  capabilities: ModelCapabilities,
  required: RequiredCapabilities,
): readonly RouteRejection[] {
  const rejections: RouteRejection[] = [];

  if (required.tools && !capabilities.tools) {
    rejections.push({
      code: 'missing_tools',
      required: true,
      actual: false,
    });
  }
  if (required.parallelToolCalls && !capabilities.parallelToolCalls) {
    rejections.push({
      code: 'missing_parallel_tool_calls',
      required: true,
      actual: false,
    });
  }
  if (required.vision && !capabilities.vision) {
    rejections.push({
      code: 'missing_vision',
      required: true,
      actual: false,
    });
  }
  if (required.structuredOutput && !capabilities.structuredOutput) {
    rejections.push({
      code: 'missing_structured_output',
      required: true,
      actual: false,
    });
  }
  if (
    required.minimumContextTokens !== undefined &&
    capabilities.contextTokens < required.minimumContextTokens
  ) {
    rejections.push({
      code: 'insufficient_context',
      required: required.minimumContextTokens,
      actual: capabilities.contextTokens,
    });
  }

  return rejections;
}

function routeRejections(
  route: RoutingRoute,
  model: RoutingModel,
  profileRoute: RoutingProfileRoute | undefined,
  state: RouteRuntimeState | undefined,
  required: RequiredCapabilities,
): readonly RouteRejection[] {
  const rejections: RouteRejection[] = [];

  if (!profileRoute) rejections.push({ code: 'not_in_profile' });
  if (!route.enabled) rejections.push({ code: 'route_disabled' });
  if (state?.healthy === false) rejections.push({ code: 'route_unhealthy' });
  if (state?.available === false) {
    rejections.push({ code: 'route_unavailable' });
  }
  rejections.push(...capabilityRejections(model.capabilities, required));

  return rejections;
}

function compareAccepted(
  left: RouteCandidateTrace,
  right: RouteCandidateTrace,
): number {
  const leftScore = left.score;
  const rightScore = right.score;
  if (!leftScore || !rightScore) return left.routeId.localeCompare(right.routeId);

  if (leftScore.profilePriority !== rightScore.profilePriority) {
    return rightScore.profilePriority - leftScore.profilePriority;
  }
  if (leftScore.routePriority !== rightScore.routePriority) {
    return rightScore.routePriority - leftScore.routePriority;
  }
  return left.routeId.localeCompare(right.routeId);
}

function selectedRoute(
  config: RoutingConfig,
  candidate: RouteCandidateTrace,
  affinityRetained: boolean,
): SelectedRoute {
  const route = config.routes[candidate.routeId];
  if (!route || !candidate.score) {
    throw new RoutingSelectionError(
      `Accepted route ${candidate.routeId} is missing from the registry`,
    );
  }
  const model = config.models[route.modelId];
  if (!model) {
    throw new RoutingSelectionError(
      `Route ${route.id} references missing model ${route.modelId}`,
    );
  }

  return Object.freeze({
    routeId: route.id,
    modelId: model.id,
    providerId: model.providerId,
    upstreamModel: model.upstreamModel,
    score: candidate.score,
    affinityRetained,
  });
}

export function selectRoute(
  config: RoutingConfig,
  input: SelectRouteInput,
): RoutingDecision {
  const profileId = input.profileId ?? config.defaultProfileId;
  const profile = config.profiles[profileId];
  if (!profile) {
    throw new RoutingSelectionError(`Unknown routing profile: ${profileId}`);
  }

  const profileRoutes = new Map(
    profile.routes.map((route) => [route.routeId, route] as const),
  );
  const candidates = Object.values(config.routes)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((route): RouteCandidateTrace => {
      const model = config.models[route.modelId];
      if (!model) {
        throw new RoutingSelectionError(
          `Route ${route.id} references missing model ${route.modelId}`,
        );
      }

      const profileRoute = profileRoutes.get(route.id);
      const rejections = routeRejections(
        route,
        model,
        profileRoute,
        input.routeStates?.[route.id],
        input.requiredCapabilities,
      );
      const score: RouteScore | undefined = profileRoute
        ? Object.freeze({
            profilePriority: profileRoute.priority,
            routePriority: route.priority,
          })
        : undefined;

      return Object.freeze({
        routeId: route.id,
        modelId: model.id,
        providerId: model.providerId,
        accepted: rejections.length === 0,
        rejections: Object.freeze(rejections),
        ...(score ? { score } : {}),
      });
    });

  const accepted = candidates.filter((candidate) => candidate.accepted);
  const affineCandidate = input.affinityRouteId
    ? accepted.find((candidate) => candidate.routeId === input.affinityRouteId)
    : undefined;
  const winner = affineCandidate ?? [...accepted].sort(compareAccepted)[0];

  return Object.freeze({
    profileId,
    requiredCapabilities: input.requiredCapabilities,
    ...(winner
      ? {
          selected: selectedRoute(
            config,
            winner,
            affineCandidate !== undefined,
          ),
        }
      : {}),
    candidates: Object.freeze(candidates),
  });
}

export class RoutingEngine {
  constructor(
    readonly config: RoutingConfig,
    private readonly affinityStore?: SessionAffinityStore,
  ) {}

  select(input: EngineRouteInput): RoutingDecision {
    const affinityRouteId =
      input.affinityRouteId ??
      (input.sessionId ? this.affinityStore?.get(input.sessionId) : undefined);
    const decision = selectRoute(this.config, {
      profileId: input.profileId,
      requiredCapabilities: input.requiredCapabilities,
      routeStates: input.routeStates,
      affinityRouteId,
    });

    if (input.sessionId && decision.selected) {
      this.affinityStore?.remember(input.sessionId, decision.selected.routeId);
    }

    return decision;
  }
}
