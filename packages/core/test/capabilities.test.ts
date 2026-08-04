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
  reasoning: true,
  contextTokens: 128_000,
};

describe('deriveRequiredCapabilities', () => {
  it('derives and freezes hard requirements with reserved output context', () => {
    const required = deriveRequiredCapabilities({
      hasTools: true,
      allowsParallelToolCalls: true,
      hasImageInput: true,
      hasStructuredOutput: true,
      hasReasoning: true,
      estimatedInputTokens: 10_000,
      reservedOutputTokens: 4_000,
    });

    expect(required).toEqual({
      tools: true,
      parallelToolCalls: true,
      vision: true,
      structuredOutput: true,
      reasoning: true,
      minimumContextTokens: 14_000,
    });
    expect(Object.isFrozen(required)).toBe(true);
  });

  it('does not require parallel tool calls when tools are absent', () => {
    expect(
      deriveRequiredCapabilities({ allowsParallelToolCalls: true }),
    ).toMatchObject({
      tools: false,
      parallelToolCalls: false,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid estimated input token count %s',
    (estimatedInputTokens) => {
      expect(() =>
        deriveRequiredCapabilities({ estimatedInputTokens }),
      ).toThrow(RangeError);
    },
  );

  it('rejects unsafe combined context requirements', () => {
    expect(() =>
      deriveRequiredCapabilities({
        estimatedInputTokens: Number.MAX_SAFE_INTEGER,
        reservedOutputTokens: 1,
      }),
    ).toThrow(/safe integer range/);
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
        reasoning: true,
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
