/**
 * @file Type definitions for CLI commands and formatters.
 * Provides type safety for Commander.js options and API response formatting.
 */

import type {
  Account,
  Deployment,
  DeploymentDeleteResponse,
  DeploymentListResponse,
  DnsRecord,
  Domain,
  DomainDeleteResponse,
  DomainDnsResponse,
  DomainListResponse,
  DomainRecordsResponse,
  DomainShareResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  PingResponse,
  Token,
  TokenCreateResponse,
  TokenDeleteResponse,
  TokenListResponse,
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
  token?: string;
  config?: string;
  apiUrl?: string;
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  color?: boolean; // Commander's --no-color sets color: false
}

/**
 * Options for commands that support labeling.
 */
/** Options for the paginated list commands (`deployments list`, `domains list`). */
export interface ListCommandOptions {
  limit?: number;
  cursor?: string;
}

export interface LabelOptions {
  label?: string[];
}

/**
 * Options for deploy commands (upload deployment, deploy shortcut).
 */
export interface DeployCommandOptions extends LabelOptions {
  noPathDetect?: boolean;
  noSpaDetect?: boolean;
  password?: string;
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
  | Token
  | TokenCreateResponse
  | DomainVerifyResponse
  | PingResponse
  // A deletion answers with the resource it deleted — the acknowledgement law
  // (`@shipstatic/types`, DeploymentDeleteResponse). These used to resolve
  // `void`, so the CLI printed a composed sentence and the wire's answer was
  // discarded; now the same projection reaches the formatter as every other
  // result does.
  | DeploymentDeleteResponse
  | DomainDeleteResponse
  | TokenDeleteResponse
  // biome-ignore lint/suspicious/noConfusingVoidType: some handlers still resolve with nothing; formatOutput routes undefined to the deletion success message
  | void;
