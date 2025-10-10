/**
 * @file Shared SDK exports - environment agnostic.
 */

// Core functionality
export * from './resources.js';
export * from './types.js';
export * from './api/http.js';
export * from './core/constants.js';
export * from './core/config.js';
export { Ship } from './base-ship.js';

// Shared utilities
export * from './lib/md5.js';
export * from './lib/text.js';
export * from './lib/junk.js';
export * from './lib/deploy-paths.js';
export * from './lib/env.js';

// Re-export types from @shipstatic/types
export { ShipError, ShipErrorType } from '@shipstatic/types';
export type { PingResponse, Deployment, Domain, Account } from '@shipstatic/types';