/**
 * Pure formatting functions for CLI output.
 * All formatters are synchronous and have no side effects beyond console output.
 */
import type {
  Deployment,
  DeploymentListResponse,
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
  isJson?: boolean;
  noColor?: boolean;
}

/**
 * Format deployments list
 */
export function formatDeploymentsList(result: DeploymentListResponse, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  if (!result.deployments || result.deployments.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ deployments: [] }, null, 2));
    } else {
      console.log('no deployments found');
      console.log();
    }
    return;
  }

  const columns = ['url', 'labels', 'created'];
  console.log(formatTable(result.deployments, columns, noColor, { url: 'deployment' }));
}

/**
 * Format domains list
 */
export function formatDomainsList(result: DomainListResponse, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  if (!result.domains || result.domains.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ domains: [] }, null, 2));
    } else {
      console.log('no domains found');
      console.log();
    }
    return;
  }

  const columns = ['url', 'deployment', 'labels', 'linked', 'created'];
  console.log(formatTable(result.domains, columns, noColor, { url: 'domain' }));
}

/**
 * Format single domain result.
 * Expects _dnsRecords and _shareHash to be pre-populated for new external domains.
 */
export function formatDomain(result: EnrichedDomain, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  // Show success message for set/update operations
  if (result.domain && (context.operation === 'set' || context.operation === 'update')) {
    const verb = context.operation === 'update' ? 'updated'
      : result.isCreate ? 'created' : 'updated';
    success(`${result.domain} domain ${verb}`, isJson, noColor);
  }

  // Display pre-fetched DNS records (for new external domains)
  if (!isJson && result._dnsRecords && result._dnsRecords.length > 0) {
    console.log();
    info('DNS Records to configure:', isJson, noColor);
    result._dnsRecords.forEach((record) => {
      console.log(`  ${record.type}: ${record.name} → ${record.value}`);
    });
  }

  // Display setup instructions link
  if (!isJson && result._shareHash) {
    console.log();
    info(`Setup instructions: https://setup.shipstatic.com/${result._shareHash}/${result.domain}`, isJson, noColor);
  }

  // Filter out internal fields before displaying details
  const { _dnsRecords, _shareHash, ...displayResult } = result;

  console.log();
  console.log(formatDetails(displayResult, noColor));
}

/**
 * Format single deployment result
 */
export function formatDeployment(result: Deployment, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  // Show success message for create operations
  if (result.status && context.operation === 'create') {
    success(`${result.deployment} deployment created`, isJson, noColor);
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
  const { isJson, noColor } = options;
  if (result.message) {
    success(result.message, isJson, noColor);
  }
}

/**
 * Format domain validation result
 */
export function formatDomainValidate(result: DomainValidateResponse, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    console.log();
    return;
  }

  if (result.valid) {
    success(`domain is valid`, isJson, noColor);
    console.log();
    if (result.normalized) {
      console.log(`  normalized: ${result.normalized}`);
    }
    if (result.available !== undefined) {
      const availabilityText = result.available ? 'available ✓' : 'already taken';
      console.log(`  availability: ${availabilityText}`);
    }
    console.log();
  } else {
    error(result.error || 'domain is invalid', isJson, noColor);
  }
}

/**
 * Format tokens list
 */
export function formatTokensList(result: TokenListResponse, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  if (!result.tokens || result.tokens.length === 0) {
    if (isJson) {
      console.log(JSON.stringify({ tokens: [] }, null, 2));
    } else {
      console.log('no tokens found');
      console.log();
    }
    return;
  }

  const columns = ['token', 'labels', 'created', 'expires'];
  console.log(formatTable(result.tokens, columns, noColor));
}

/**
 * Format single token result
 */
export function formatToken(result: TokenCreateResponse, context: OutputContext, options: FormatOptions): void {
  const { isJson, noColor } = options;

  if (context.operation === 'create' && result.token) {
    success(`token created`, isJson, noColor);
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
  const { isJson, noColor } = options;

  // Handle void/undefined results (removal operations)
  if (result === undefined) {
    if (context.operation === 'remove' && context.resourceType && context.resourceId) {
      success(`${context.resourceId} ${context.resourceType.toLowerCase()} removed`, isJson, noColor);
    } else {
      success('removed successfully', isJson, noColor);
    }
    return;
  }

  // Handle ping result (boolean or PingResponse)
  if (result === true || (result !== null && typeof result === 'object' && 'success' in result)) {
    const isSuccess = result === true || (result as { success: boolean }).success;
    if (isSuccess) {
      success('api reachable', isJson, noColor);
    } else {
      error('api unreachable', isJson, noColor);
    }
    return;
  }

  // JSON mode: output raw JSON for all results
  if (isJson && result !== null && typeof result === 'object') {
    // Filter internal fields from JSON output
    const output = { ...result } as Record<string, unknown>;
    delete output._dnsRecords;
    delete output._shareHash;
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
      formatDomain(result as EnrichedDomain, context, options);
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
      success('success', isJson, noColor);
    }
  } else {
    // Fallback for non-object results
    success('success', isJson, noColor);
  }
}
