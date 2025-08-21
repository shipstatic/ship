/**
 * @file Main entry point for the Ship SDK.
 * 
 * This is the primary entry point for Node.js environments, providing
 * full file system support and configuration loading capabilities.
 * 
 * For browser environments, import from '@shipstatic/ship/browser' instead.
 */

// Re-export everything from the Node.js index, including both named and default exports
export * from './node/index.js';
export { default } from './node/index.js';
