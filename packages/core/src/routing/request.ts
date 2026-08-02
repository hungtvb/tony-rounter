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

function hasTools(tools: unknown): boolean {
  return Array.isArray(tools) && tools.length > 0;
}

export function deriveChatRequestCapabilities(
  request: unknown,
  options: ChatCapabilityOptions = {},
): RequiredCapabilities {
  const input = isRecord(request) ? request : {};
  const requestHasTools = hasTools(input.tools);

  return deriveRequiredCapabilities({
    hasTools: requestHasTools,
    allowsParallelToolCalls:
      requestHasTools && input.parallel_tool_calls === true,
    hasImageInput: hasImageInput(input.messages),
    hasStructuredOutput: hasStructuredOutput(input.response_format),
    ...(options.estimatedInputTokens !== undefined
      ? { estimatedInputTokens: options.estimatedInputTokens }
      : {}),
    ...(options.reservedOutputTokens !== undefined
      ? { reservedOutputTokens: options.reservedOutputTokens }
      : {}),
  });
}
