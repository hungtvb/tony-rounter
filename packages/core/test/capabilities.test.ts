import { describe, expect, it } from 'vitest';

import {
  deriveRequiredCapabilities,
  supportsCapabilities,
  type ModelCapabilities,
} from '../src/index.js';

const capableModel: ModelCapabilities = {
  tools: true,
  parallelToolCalls: true,
  vision: true,
  structuredOutput: true,
  contextTokens: 128_000,
};

describe('deriveRequiredCapabilities', () => {
  it('derives hard requirements and reserves output context', () => {
    expect(
      deriveRequiredCapabilities({
        hasTools: true,
        allowsParallelToolCalls: true,
        hasImageInput: true,
        hasStructuredOutput: true,
        estimatedInputTokens: 10_000,
        reservedOutputTokens: 4_000,
      }),
    ).toEqual({
      tools: true,
      parallelToolCalls: true,
      vision: true,
      structuredOutput: true,
      minimumContextTokens: 14_000,
    });
  });

  it('does not require parallel tool calls when tools are absent', () => {
    expect(
      deriveRequiredCapabilities({ allowsParallelToolCalls: true }),
    ).toMatchObject({
      tools: false,
      parallelToolCalls: false,
    });
  });
});

describe('supportsCapabilities', () => {
  it('accepts a model satisfying every hard requirement', () => {
    expect(
      supportsCapabilities(capableModel, {
        tools: true,
        parallelToolCalls: true,
        vision: true,
        structuredOutput: true,
        minimumContextTokens: 64_000,
      }),
    ).toBe(true);
  });

  it('rejects a model when any hard capability is missing', () => {
    expect(
      supportsCapabilities(
        { ...capableModel, structuredOutput: false },
        {
          tools: true,
          parallelToolCalls: false,
          vision: false,
          structuredOutput: true,
        },
      ),
    ).toBe(false);
  });

  it('rejects a model with insufficient context', () => {
    expect(
      supportsCapabilities(capableModel, {
        tools: false,
        parallelToolCalls: false,
        vision: false,
        structuredOutput: false,
        minimumContextTokens: 200_000,
      }),
    ).toBe(false);
  });
});
