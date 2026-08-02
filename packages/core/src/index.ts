export interface RequiredCapabilities {
  readonly tools: boolean;
  readonly parallelToolCalls: boolean;
  readonly vision: boolean;
  readonly structuredOutput: boolean;
  readonly minimumContextTokens?: number;
}

export interface CapabilityInput {
  readonly hasTools?: boolean;
  readonly allowsParallelToolCalls?: boolean;
  readonly hasImageInput?: boolean;
  readonly hasStructuredOutput?: boolean;
  readonly estimatedInputTokens?: number;
  readonly reservedOutputTokens?: number;
}

export interface ModelCapabilities {
  readonly tools: boolean;
  readonly parallelToolCalls: boolean;
  readonly vision: boolean;
  readonly structuredOutput: boolean;
  readonly contextTokens: number;
}

export function deriveRequiredCapabilities(
  input: CapabilityInput,
): RequiredCapabilities {
  const estimatedInputTokens = input.estimatedInputTokens ?? 0;
  const reservedOutputTokens = input.reservedOutputTokens ?? 0;
  const minimumContextTokens = estimatedInputTokens + reservedOutputTokens;

  return {
    tools: input.hasTools ?? false,
    parallelToolCalls:
      (input.hasTools ?? false) && (input.allowsParallelToolCalls ?? false),
    vision: input.hasImageInput ?? false,
    structuredOutput: input.hasStructuredOutput ?? false,
    ...(minimumContextTokens > 0 ? { minimumContextTokens } : {}),
  };
}

export function supportsCapabilities(
  model: ModelCapabilities,
  required: RequiredCapabilities,
): boolean {
  if (required.tools && !model.tools) return false;
  if (required.parallelToolCalls && !model.parallelToolCalls) return false;
  if (required.vision && !model.vision) return false;
  if (required.structuredOutput && !model.structuredOutput) return false;

  return (
    required.minimumContextTokens === undefined ||
    model.contextTokens >= required.minimumContextTokens
  );
}
