export { buildGateway } from './app.js';
export type {
  BuildGatewayOptions,
  GatewayModel,
} from './app.js';
export {
  GatewayConfigError,
  loadGatewayConfig,
} from './config.js';
export type {
  GatewayConfig,
  LoadGatewayConfigOptions,
} from './config.js';
export {
  createJsonLogger,
  createNullLogger,
} from './logger.js';
export type {
  JsonLogger,
  JsonLoggerOptions,
} from './logger.js';
export {
  createGracefulShutdown,
  installSignalHandlers,
} from './shutdown.js';
export type { ShutdownResult } from './shutdown.js';

export interface GatewayProbe {
  readonly name: 'tony-router';
  readonly status: 'initializing';
  readonly version: string;
}

export function createGatewayProbe(version = '0.1.0'): GatewayProbe {
  return {
    name: 'tony-router',
    status: 'initializing',
    version,
  };
}
