/**
 * @file Main entry point for the Ship SDK.
 * 
 * This is the primary entry point for Node.js environments, providing
 * full file system support and configuration loading capabilities.
 * 
 * For browser environments, import from '@shipstatic/ship/browser' instead.
 */

// Export everything from Node.js implementation
export * from './node/index.js';

// Re-export default export explicitly (export * doesn't re-export defaults)
export { default } from './node/index.js';
