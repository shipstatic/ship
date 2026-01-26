/**
 * @file Type definitions for CLI commands and formatters.
 * Provides type safety for Commander.js options and API response formatting.
 */

import type {
  Deployment,
  DeploymentListResponse,
  Domain,
  DomainListResponse,
  DnsRecord,
  Account,
  TokenCreateResponse,
  TokenListResponse,
  PingResponse
} from '@shipstatic/types';

// =============================================================================
// COMMANDER.JS OPTION TYPES
// =============================================================================

/**
 * Global CLI options available to all commands.
 * These are defined on the root program.
 */
export interface GlobalOptions {
  apiKey?: string;
  deployToken?: string;
  config?: string;
  apiUrl?: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean; // Commander's --no-color sets color: false
  help?: boolean;
}

/**
 * Options for commands that support tagging.
 */
export interface TagOptions {
  tag?: string[];
}

/**
 * Options for deploy commands (create deployment, deploy shortcut).
 */
export interface DeployCommandOptions extends TagOptions {
  noPathDetect?: boolean;
  noSpaDetect?: boolean;
}

/**
 * Options for token create command.
 */
export interface TokenCreateCommandOptions extends TagOptions {
  ttl?: number;
}

/**
 * Processed options after Commander.js parsing.
 * Combines global and command-specific options with noColor normalization.
 */
export interface ProcessedOptions extends GlobalOptions {
  noColor?: boolean;
}

// =============================================================================
// FORMATTER RESULT TYPES
// =============================================================================

/**
 * Domain with CLI-specific enrichment fields.
 * Added by CLI when creating external domains to show DNS setup info.
 */
export interface EnrichedDomain extends Domain {
  _dnsRecords?: DnsRecord[];
  _shareHash?: string;
}

/**
 * Simple message response (e.g., from domain verify).
 */
export interface MessageResult {
  message: string;
}

/**
 * Union of all possible CLI command results.
 * Used by formatOutput to route to the correct formatter.
 */
export type CLIResult =
  | DeploymentListResponse
  | DomainListResponse
  | TokenListResponse
  | Deployment
  | EnrichedDomain
  | Account
  | TokenCreateResponse
  | MessageResult
  | PingResponse
  | boolean
  | void;

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isDeploymentListResponse(result: unknown): result is DeploymentListResponse {
  return result !== null && typeof result === 'object' && 'deployments' in result;
}

export function isDomainListResponse(result: unknown): result is DomainListResponse {
  return result !== null && typeof result === 'object' && 'domains' in result;
}

export function isTokenListResponse(result: unknown): result is TokenListResponse {
  return result !== null && typeof result === 'object' && 'tokens' in result;
}

export function isDomain(result: unknown): result is EnrichedDomain {
  return result !== null && typeof result === 'object' && 'domain' in result;
}

export function isDeployment(result: unknown): result is Deployment {
  return result !== null && typeof result === 'object' && 'deployment' in result;
}

export function isToken(result: unknown): result is TokenCreateResponse {
  return result !== null && typeof result === 'object' && 'token' in result;
}

export function isAccount(result: unknown): result is Account {
  return result !== null && typeof result === 'object' && 'email' in result;
}

export function isMessageResult(result: unknown): result is MessageResult {
  return result !== null && typeof result === 'object' && 'message' in result;
}

export function isPingResponse(result: unknown): result is PingResponse {
  return result !== null && typeof result === 'object' && 'success' in result;
}
