/**
 * Pure formatting functions for CLI output.
 * All formatters are synchronous and have no side effects beyond console output.
 */
import type {
  Deployment,
  DeploymentListResponse,
  Domain,
  DomainListResponse,
  DomainValidateResponse,
  Account,
  TokenCreateResponse,
  TokenListResponse
} from '@shipstatic/types';
import type { EnrichedDomain, MessageResult, CLIResult } from './types.js';
import { formatTable, formatDetails, success, error, info } from './utils.js';

export interface OutputContext {
  operation?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface FormatOptions {
  json?: boolean;
  noColor?: boolean;
}

/**
 * Format deployments list
 */
export function formatDeploymentsList(result: DeploymentListResponse, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  if (result.deployments.length === 0) {
    console.log('no deployments found');
    console.log();
    return;
  }

  const columns = ['url', 'labels', 'created'];
  console.log(formatTable(result.deployments, columns, noColor, { url: 'deployment' }));
}

/**
 * Format domains list
 */
export function formatDomainsList(result: DomainListResponse, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  if (result.domains.length === 0) {
    console.log('no domains found');
    console.log();
    return;
  }

  const columns = ['url', 'deployment', 'labels', 'linked', 'created'];
  console.log(formatTable(result.domains, columns, noColor, { url: 'domain' }));
}

/**
 * Format single domain result.
 * Accepts plain Domain (from get) or EnrichedDomain (from set, with DNS info).
 */
export function formatDomain(result: Domain | EnrichedDomain, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  // Destructure enrichment fields (undefined when result is plain Domain)
  const { _dnsRecords, _shareHash, isCreate, ...displayResult } = result as EnrichedDomain;

  // Show success message for set operations
  if (context.operation === 'set') {
    const verb = isCreate ? 'created' : 'updated';
    success(`${result.domain} domain ${verb}`, false, noColor);
  }

  // Display pre-fetched DNS records (for new external domains)
  if (_dnsRecords && _dnsRecords.length > 0) {
    console.log();
    info('DNS Records to configure:', false, noColor);
    _dnsRecords.forEach((record) => {
      console.log(`  ${record.type}: ${record.name} → ${record.value}`);
    });
  }

  // Display setup instructions link
  if (_shareHash) {
    console.log();
    info(`Setup instructions: https://setup.shipstatic.com/${_shareHash}/${result.domain}`, false, noColor);
  }

  console.log();
  console.log(formatDetails(displayResult, noColor));
}

/**
 * Format single deployment result
 */
export function formatDeployment(result: Deployment, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  // Show success message for create operations
  if (context.operation === 'create') {
    success(`${result.deployment} deployment created`, false, noColor);
  }

  console.log(formatDetails(result, noColor));
}

/**
 * Format account/email result
 */
export function formatAccount(result: Account, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;
  console.log(formatDetails(result, noColor));
}

/**
 * Format message result (e.g., from DNS verification)
 */
export function formatMessage(result: MessageResult, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;
  if (result.message) {
    success(result.message, false, noColor);
  }
}

/**
 * Format domain validation result
 */
export function formatDomainValidate(result: DomainValidateResponse, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  if (result.valid) {
    success(`domain is valid`, false, noColor);
    console.log();
    if (result.normalized) {
      console.log(`  normalized: ${result.normalized}`);
    }
    if (result.available !== null) {
      const availabilityText = result.available ? 'available ✓' : 'already taken';
      console.log(`  availability: ${availabilityText}`);
    }
    console.log();
  } else {
    error(result.error || 'domain is invalid', false, noColor);
  }
}

/**
 * Format tokens list
 */
export function formatTokensList(result: TokenListResponse, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  if (result.tokens.length === 0) {
    console.log('no tokens found');
    console.log();
    return;
  }

  const columns = ['token', 'labels', 'created', 'expires'];
  console.log(formatTable(result.tokens, columns, noColor));
}

/**
 * Format single token result
 */
export function formatToken(result: TokenCreateResponse, context: OutputContext, options: FormatOptions): void {
  const { noColor } = options;

  if (context.operation === 'create' && result.token) {
    success(`token created`, false, noColor);
  }

  console.log(formatDetails(result, noColor));
}

/**
 * Main output function - routes to appropriate formatter based on result shape.
 * Handles JSON mode, removal operations, and ping results.
 */
export function formatOutput(
  result: CLIResult,
  context: OutputContext,
  options: FormatOptions
): void {
  const { json, noColor } = options;

  // Handle void/undefined results (removal operations)
  if (result === undefined) {
    if (context.operation === 'remove' && context.resourceType && context.resourceId) {
      success(`${context.resourceId} ${context.resourceType.toLowerCase()} removed`, json, noColor);
    } else {
      success('removed successfully', json, noColor);
    }
    return;
  }

  // Handle ping result (boolean from client.ping())
  if (typeof result === 'boolean') {
    if (result) {
      success('api reachable', json, noColor);
    } else {
      error('api unreachable', json, noColor);
    }
    return;
  }

  // JSON mode: output raw JSON for all results
  if (json && result !== null && typeof result === 'object') {
    // Filter internal fields from JSON output
    const output = { ...result } as Record<string, unknown>;
    delete output._dnsRecords;
    delete output._shareHash;
    delete output.isCreate;
    console.log(JSON.stringify(output, null, 2));
    console.log();
    return;
  }

  // Route to specific formatter based on result shape
  // Order matters: check list types before singular types
  if (result !== null && typeof result === 'object') {
    if ('deployments' in result) {
      formatDeploymentsList(result as DeploymentListResponse, context, options);
    } else if ('domains' in result) {
      formatDomainsList(result as DomainListResponse, context, options);
    } else if ('tokens' in result) {
      formatTokensList(result as TokenListResponse, context, options);
    } else if ('domain' in result) {
      formatDomain(result as Domain, context, options);
    } else if ('deployment' in result) {
      formatDeployment(result as Deployment, context, options);
    } else if ('token' in result) {
      formatToken(result as TokenCreateResponse, context, options);
    } else if ('email' in result) {
      formatAccount(result as Account, context, options);
    } else if ('valid' in result) {
      formatDomainValidate(result as DomainValidateResponse, context, options);
    } else if ('message' in result) {
      formatMessage(result as MessageResult, context, options);
    } else {
      // Fallback
      success('success', json, noColor);
    }
  } else {
    // Fallback for non-object results
    success('success', json, noColor);
  }
}
