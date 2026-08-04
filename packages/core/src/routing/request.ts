import {
  deriveRequiredCapabilities,
  type RequiredCapabilities,
} from '../capabilities.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface ChatCapabilityOptions {
  readonly estimatedInputTokens?: number;
  readonly reservedOutputTokens?: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasImagePart(content: unknown): boolean {
  if (!Array.isArray(content)) return false;

  return content.some((part) => {
    if (!isRecord(part) || typeof part.type !== 'string') return false;
    return part.type === 'image_url' || part.type === 'input_image';
  });
}

function hasImageInput(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (message) => isRecord(message) && hasImagePart(message.content),
  );
}

function hasStructuredOutput(responseFormat: unknown): boolean {
  if (!isRecord(responseFormat)) return false;
  return (
    responseFormat.type === 'json_object' ||
    responseFormat.type === 'json_schema'
  );
}

function hasReasoning(value: UnknownRecord): boolean {
  const effort = value.reasoning_effort;
  const summary = value.reasoning_summary;
  return (
    (typeof effort === 'string' && effort !== 'none') ||
    (typeof summary === 'string' && summary.length > 0)
  );
}

function hasConfiguredTools(tools: unknown): boolean {
  return Array.isArray(tools) && tools.length > 0;
}

function toolHistory(messages: unknown): Readonly<{
  hasTools: boolean;
  hasParallelToolCalls: boolean;
}> {
  if (!Array.isArray(messages)) {
    return Object.freeze({ hasTools: false, hasParallelToolCalls: false });
  }

  let historyHasTools = false;
  let historyHasParallelToolCalls = false;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message.role === 'tool') historyHasTools = true;
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      continue;
    }
    historyHasTools = true;
    if (message.tool_calls.length > 1) historyHasParallelToolCalls = true;
  }

  return Object.freeze({
    hasTools: historyHasTools,
    hasParallelToolCalls: historyHasParallelToolCalls,
  });
}

export function deriveChatRequestCapabilities(
  request: unknown,
  options: ChatCapabilityOptions = {},
): RequiredCapabilities {
  const input = isRecord(request) ? request : {};
  const history = toolHistory(input.messages);
  const requestHasTools = hasConfiguredTools(input.tools) || history.hasTools;

  return deriveRequiredCapabilities({
    hasTools: requestHasTools,
    allowsParallelToolCalls:
      history.hasParallelToolCalls ||
      (requestHasTools && input.parallel_tool_calls === true),
    hasImageInput: hasImageInput(input.messages),
    hasStructuredOutput: hasStructuredOutput(input.response_format),
    hasReasoning: hasReasoning(input),
    ...(options.estimatedInputTokens !== undefined
      ? { estimatedInputTokens: options.estimatedInputTokens }
      : {}),
    ...(options.reservedOutputTokens !== undefined
      ? { reservedOutputTokens: options.reservedOutputTokens }
      : {}),
  });
}
