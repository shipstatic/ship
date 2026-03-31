/**
 * @file Type definitions for CLI commands and formatters.
 * Provides type safety for Commander.js options and API response formatting.
 */

import type {
  Deployment,
  DeploymentListResponse,
  Domain,
  DomainListResponse,
  DomainValidateResponse,
  DomainRecordsResponse,
  DomainDnsResponse,
  DnsRecord,
  Account,
  TokenCreateResponse,
  TokenListResponse
} from '@shipstatic/types';
import type { DomainSetResult } from '../../shared/types.js';

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
  quiet?: boolean;
  noColor?: boolean;
  color?: boolean; // Commander's --no-color sets color: false
  help?: boolean;
}

/**
 * Options for commands that support labeling.
 */
export interface LabelOptions {
  label?: string[];
}

/**
 * Options for deploy commands (upload deployment, deploy shortcut).
 */
export interface DeployCommandOptions extends LabelOptions {
  noPathDetect?: boolean;
  noSpaDetect?: boolean;
}

/**
 * Options for token create command.
 */
export interface TokenCreateCommandOptions extends LabelOptions {
  ttl?: number;
}

// =============================================================================
// FORMATTER RESULT TYPES
// =============================================================================

/**
 * Domain with CLI-specific enrichment fields.
 * Added by CLI when creating external domains to show DNS setup info.
 * Extends DomainSetResult (Domain + isCreate) since it's used after set operations.
 */
export interface EnrichedDomain extends DomainSetResult {
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
 * Share response from domains.share() — { domain, hash }.
 * Used to construct the setup URL: https://setup.shipstatic.com/{hash}/{domain}
 */
export interface DomainShareResponse {
  domain: string;
  hash: string;
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
  | Domain
  | EnrichedDomain
  | DomainValidateResponse
  | DomainRecordsResponse
  | DomainDnsResponse
  | DomainShareResponse
  | Account
  | TokenCreateResponse
  | MessageResult
  | boolean
  | void;

