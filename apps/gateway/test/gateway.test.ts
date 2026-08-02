import { describe, expect, it } from 'vitest';

import { createGatewayProbe } from '../src/index.js';

describe('createGatewayProbe', () => {
  it('uses the canonical capability model from the core package', () => {
    expect(
      createGatewayProbe({
        hasTools: true,
        estimatedInputTokens: 2_000,
        reservedOutputTokens: 1_000,
      }),
    ).toEqual({
      name: 'tony-router',
      status: 'initializing',
      requiredCapabilities: {
        tools: true,
        parallelToolCalls: false,
        vision: false,
        structuredOutput: false,
        minimumContextTokens: 3_000,
      },
    });
  });
});
