export interface GatewayProbe {
  readonly name: 'tony-router';
  readonly status: 'initializing';
  readonly version: string;
}

export function createGatewayProbe(version = '0.0.0'): GatewayProbe {
  return {
    name: 'tony-router',
    status: 'initializing',
    version,
  };
}
