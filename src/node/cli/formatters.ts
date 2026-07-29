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

/**
 * Read a named field off a result whose shape the caller has already decided.
 *
 * The cast is the one narrowing TypeScript cannot do for us: `CLIResult` is a
 * union of named response types and a member like `EnrichedDomain` carries no
 * index signature, yet every member IS a plain object. Safe because the field
 * name is derived from the command's own resource type — never from input —
 * and the value is type-checked at the call site before it is used.
 */
function readField(source: object, field: string): unknown {
  return (source as Record<string, unknown>)[field];
}

export interface OutputContext {
  operation?: string;
  resourceType?: string;
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
 * carve-out the deletion message below uses: a surface writes its own words
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
    error(result.reason || 'domain is invalid', false, noColor);
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
 * Handles JSON mode, deletion operations, and ping results.
 */
export function formatOutput(
  result: CLIResult,
  context: OutputContext,
  options: FormatOptions,
): void {
  const { json, quiet, noColor } = options;

  // Quiet mode: output only the key identifier
  if (quiet) {
    if (result === undefined) return;
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

  // Deletions answer with an acknowledgement, so text is the only channel that
  // composes anything: JSON falls through to the one transmitter below, and
  // quiet already read the key above. Text translates, JSON transmits.
  //
  // The identifier comes from the wire, never from what the caller typed —
  // those differ routinely. A deployment is addressable by bare slug and
  // answers with its hostname; a domain is accepted in any case and answers
  // normalized. Only the noun is this CLI's word, and it is the same word
  // that names the key: an acknowledgement is the resource noun carrying its
  // canonical key (`@shipstatic/types`, `DeploymentDeleteResponse`), so one
  // lowercased resource type both reads the field and writes the sentence.
  if (context.operation === 'delete' && !json) {
    const noun = context.resourceType?.toLowerCase();
    const acknowledged =
      noun && result !== null && typeof result === 'object' ? readField(result, noun) : undefined;

    // A handler that resolved nothing leaves no identifier to report, and the
    // CLI does not invent one.
    success(
      typeof acknowledged === 'string' ? `${acknowledged} ${noun} deleted` : 'deleted successfully',
      false,
      noColor,
    );
    return;
  }

  if (result === undefined) {
    success('deleted successfully', json, noColor);
    return;
  }

  // Liveness is a question, so text answers it as one — "reachable" is the
  // whole of what a person asked, and the server clock is noise to them. JSON
  // falls through to the transmitter and carries the response. The same split
  // as deletions above, for the same reason.
  //
  // There is no unreachable arm: a non-OK response throws in transport, so
  // reaching this line at all IS the answer. The CLI carried a `success: false`
  // branch until 2026-07-29 — unreachable code guarding a field the route set
  // to a literal `true`.
  if (context.operation === 'ping' && !json) {
    success('api reachable', false, noColor);
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
      // A shape with no formatter of its own is not an occasion to print the
      // word "success": that asserts the call worked, which the exit code
      // already said, and it hides the answer the command was run for. Render
      // what arrived. `GET /labels` and `GET /limits` are real endpoints with
      // no CLI command yet (`CLAUDE.md`, "Routes the API exposes that the SDK
      // does not reach"); when one lands it shows its content on the first
      // run, and a bespoke formatter becomes an improvement rather than a
      // prerequisite.
      console.log(formatDetails(result, noColor));
    }
  }
  // A non-object result is unrenderable — `undefined` is handled above, and
  // `boolean` left this union with ping's `success` field. Saying nothing is
  // honest; saying "success" would not be.
}
