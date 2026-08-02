import {
  deriveRequiredCapabilities,
  type CapabilityInput,
  type RequiredCapabilities,
} from '@tony-router/core';

export interface GatewayProbe {
  readonly name: 'tony-router';
  readonly status: 'initializing';
  readonly requiredCapabilities: RequiredCapabilities;
}

export function createGatewayProbe(
  capabilityInput: CapabilityInput = {},
): GatewayProbe {
  return {
    name: 'tony-router',
    status: 'initializing',
    requiredCapabilities: deriveRequiredCapabilities(capabilityInput),
  };
}
