/**
 * Pure formatting functions for CLI output.
 * All formatters are synchronous and have no side effects beyond console output.
 */
import type {
  Account,
  Deployment,
  DeploymentCreateResponse,
  DeploymentListResponse,
  Domain,
  DomainDnsResponse,
  DomainListResponse,
  DomainRecordsResponse,
  DomainShareResponse,
  DomainValidateResponse,
  DomainVerifyResponse,
  TokenCreateResponse,
  TokenListResponse,
} from '@shipstatic/types';
import type { CLIResult, EnrichedDomain } from './types.js';
import { error, formatDetails, formatTable, info, success } from './utils.js';

const setupUrl = (hash: string, domain: string) => `https://setup.shipstatic.com/${hash}/${domain}`;

export interface OutputContext {
  operation?: string;
  resourceType?: string;
  resourceId?: string;
}

export interface FormatOptions {
  json?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

/**
 * Format deployments list
 */
export function formatDeploymentsList(
  result: DeploymentListResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.deployments.length === 0) {
    console.log('no deployments found');
    console.log();
    return;
  }

  const columns = ['deployment', 'labels', 'files', 'size', 'created', 'via'];
  console.log(formatTable(result.deployments, columns, noColor));
  printCursorHint(result.cursor, noColor);
}

/**
 * A non-null cursor means the server has more pages. Text mode surfaces the
 * continuation the same way `-q` surfaces identifiers: as the value you feed
 * to the next invocation. (`--json` consumers read `cursor` off the response.)
 */
function printCursorHint(cursor: string | null | undefined, noColor?: boolean): void {
  if (cursor) {
    info(`more results available — rerun with --cursor ${cursor}`, false, noColor);
  }
}

/**
 * Format domains list
 */
export function formatDomainsList(
  result: DomainListResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.domains.length === 0) {
    console.log('no domains found');
    console.log();
    return;
  }

  const columns = ['domain', 'deployment', 'labels', 'linked', 'links', 'created'];
  console.log(formatTable(result.domains, columns, noColor));
  printCursorHint(result.cursor, noColor);
}

/**
 * Format single domain result.
 * Accepts plain Domain (from get) or EnrichedDomain (from set, with DNS info).
 */
export function formatDomain(
  result: Domain | EnrichedDomain,
  context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  // Destructure enrichment fields (undefined when result is plain Domain)
  const { _dnsRecords, _shareHash, isCreate, ...displayResult } = result as EnrichedDomain;

  // Show success message for set operations
  if (context.operation === 'set') {
    const verb = isCreate ? 'created' : 'updated';
    success(`${result.url} domain ${verb}`, false, noColor);
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
    info(`Setup instructions: ${setupUrl(_shareHash, result.domain)}`, false, noColor);
  }

  console.log(formatDetails(displayResult, noColor));
}

/**
 * Format single deployment result
 */
export function formatDeployment(
  result: Deployment | DeploymentCreateResponse,
  context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  // Show success message for upload operations
  if (context.operation === 'upload') {
    success(`${result.url} deployment uploaded`, false, noColor);
  }

  console.log(formatDetails(result, noColor));

  // Public deployment — claim URL + CTA after details
  const claim = (result as DeploymentCreateResponse).claim;
  if (claim) {
    const days = result.expires ? Math.round((result.expires - result.created) / 86400) : null;
    console.log(
      `IMPORTANT: this deployment${days ? ` expires in ${days} day${days !== 1 ? 's' : ''}` : ' will expire'}, claim it to keep permanently:\n${claim}\n`,
    );
    info(
      `configure a free API key with 'ship config' to deploy to your own account`,
      false,
      noColor,
    );
  }
}

/**
 * Format account/email result
 */
export function formatAccount(
  result: Account,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;
  console.log(formatDetails(result, noColor));
}

/**
 * Format the DNS-verification acknowledgement.
 *
 * The wire carries no prose — an acknowledgement is the domain and the 202
 * that accepted it — so the copy is composed here. That is the same
 * carve-out the removal message below uses: a surface writes its own words
 * exactly where no wire message exists.
 */
export function formatDomainVerify(
  result: DomainVerifyResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  success(`${result.domain} dns verification queued`, false, options.noColor);
}

/**
 * Format domain validation result
 */
export function formatDomainValidate(
  result: DomainValidateResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.valid) {
    success(`domain is valid`, false, noColor);
    console.log();
    if (result.normalized) {
      console.log(`  normalized: ${result.normalized}`);
    }
    if (result.available !== null) {
      const availabilityText = result.available
        ? noColor
          ? 'available'
          : 'available ✓'
        : 'already taken';
      console.log(`  availability: ${availabilityText}`);
    }
    console.log();
  } else {
    error(result.error || 'domain is invalid', false, noColor);
  }
}

/**
 * Format domain DNS records result
 */
export function formatDomainRecords(
  result: DomainRecordsResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.records.length === 0) {
    console.log('no records found');
    console.log();
    return;
  }

  const columns = ['type', 'name', 'value'];
  console.log(formatTable(result.records, columns, noColor));
}

/**
 * Format domain DNS provider result
 */
export function formatDomainDns(
  result: DomainDnsResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;
  const provider = result.dns?.provider?.name || null;
  console.log(formatDetails({ domain: result.domain, provider }, noColor));
}

/**
 * Format domain share result as setup URL
 */
export function formatDomainShare(
  result: DomainShareResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;
  success(setupUrl(result.hash, result.domain), false, noColor);
}

/**
 * Format tokens list
 */
export function formatTokensList(
  result: TokenListResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.tokens.length === 0) {
    console.log('no tokens found');
    console.log();
    return;
  }

  const columns = ['token', 'labels', 'created', 'expires'];
  console.log(formatTable(result.tokens, columns, noColor));
  printCursorHint(result.cursor, noColor);
}

/**
 * Format single token result (creation response includes both token ID and secret)
 */
export function formatToken(
  result: TokenCreateResponse,
  context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (context.operation === 'create' && result.token) {
    success(`token ${result.token} created`, false, noColor);
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
  options: FormatOptions,
): void {
  const { json, quiet, noColor } = options;

  // Quiet mode: output only the key identifier
  if (quiet) {
    if (result === undefined || typeof result === 'boolean') return;
    if (result !== null && typeof result === 'object') {
      if ('deployments' in result) {
        for (const d of (result as DeploymentListResponse).deployments) console.log(d.deployment);
      } else if ('domains' in result) {
        for (const d of (result as DomainListResponse).domains) console.log(d.domain);
      } else if ('tokens' in result) {
        for (const t of (result as TokenListResponse).tokens) console.log(t.token);
      } else if ('records' in result) {
        for (const r of (result as DomainRecordsResponse).records)
          console.log(`${r.type} ${r.name} ${r.value}`);
      } else if ('hash' in result) {
        const r = result as DomainShareResponse;
        console.log(setupUrl(r.hash, r.domain));
      } else if ('dns' in result) {
        const name = (result as DomainDnsResponse).dns?.provider?.name;
        if (name) console.log(name);
      } else if ('domain' in result) {
        console.log((result as Domain).domain);
      } else if ('deployment' in result) {
        console.log((result as Deployment).deployment);
      } else if ('secret' in result) {
        console.log((result as TokenCreateResponse).secret);
      } else if ('email' in result) {
        console.log((result as Account).email);
      } else if ('valid' in result) {
        const v = result as DomainValidateResponse;
        if (v.valid && v.normalized) console.log(v.normalized);
      }
    }
    return;
  }

  // Handle removals — the wire answers with the resource it removed (the
  // acknowledgement law), so the sentence is composed from that projection
  // rather than from the absence of one. `undefined` still lands here for
  // any handler that resolves nothing.
  if (context.operation === 'remove') {
    if (context.resourceType && context.resourceId) {
      success(`${context.resourceId} ${context.resourceType.toLowerCase()} removed`, json, noColor);
    } else {
      success('removed successfully', json, noColor);
    }
    return;
  }

  if (result === undefined) {
    success('removed successfully', json, noColor);
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
    } else if ('records' in result) {
      formatDomainRecords(result as DomainRecordsResponse, context, options);
    } else if ('hash' in result) {
      formatDomainShare(result as DomainShareResponse, context, options);
    } else if ('dns' in result) {
      formatDomainDns(result as DomainDnsResponse, context, options);
    } else if ('domain' in result && !('url' in result)) {
      // The verify acknowledgement: the domain and nothing else. A Domain
      // entity always carries its `url`, which is what tells the two apart.
      formatDomainVerify(result as DomainVerifyResponse, context, options);
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
    } else {
      // Fallback
      success('success', json, noColor);
    }
  } else {
    // Fallback for non-object results
    success('success', json, noColor);
  }
}
