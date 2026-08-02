import { describe, expect, it } from 'vitest';

import { createGatewayProbe } from '../src/index.js';

describe('createGatewayProbe', () => {
  it('returns the initial gateway identity contract', () => {
    expect(createGatewayProbe('0.1.0')).toEqual({
      name: 'tony-router',
      status: 'initializing',
      version: '0.1.0',
    });
  });
});
