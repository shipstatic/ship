/**
 * @file Shared SDK exports - environment agnostic.
 */

export type { Account, Deployment, Domain, PingResponse } from '@shipstatic/types';
// Re-export types from @shipstatic/types
export { ErrorType, ShipError } from '@shipstatic/types';
export * from './api/http.js';
export { Ship } from './base-ship.js';
export * from './core/config.js';
export * from './core/constants.js';
export * from './lib/deploy-paths.js';
export * from './lib/env.js';
export * from './lib/file-validation.js';
export * from './lib/junk.js';
// Shared utilities
export * from './lib/md5.js';
export * from './lib/security.js';
export * from './lib/text.js';
// Core functionality
export * from './resources.js';
export * from './types.js';
