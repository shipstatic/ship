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
  Token,
  TokenCreateResponse,
  TokenListResponse,
} from '@shipstatic/types';
import { DeploymentStatus } from '@shipstatic/types';
import type { CLIResult, EnrichedDomain } from './types.js';
// No `error` import, and that is a property worth keeping: a formatter renders
// a RESULT. Every failure — including a rejected request — reaches the user
// through `handleError`, so there is exactly one writer of the error channel.
// This module imported it until 2026-07-29 only to report `domains validate`'s
// negative verdict, which was never a failure.
import { formatDetails, formatTable, info, plainMessage, success } from './utils.js';

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

/**
 * The states a mutation can still be IN, and what each means for someone
 * standing at the terminal.
 *
 * A mutation acknowledgement carries the resource's own state field **only
 * where the resource survived mid-transition** (`@shipstatic/types`,
 * `DeploymentDeleteResponse`); a hard delete has no state left to state.
 *
 * The tense is not a style question. `DELETE /deployments/:deployment` answers
 * **202**, marks the row `deleting`, and queues the cleanup; the router serves
 * from KV with no status gate, so the files stay public until that queue
 * drains (~26s measured). Saying "deleted" is exactly backwards for someone
 * deleting a deployment BECAUSE it exposed something.
 *
 * This MAP is the gate, not the mere presence of a `status`, and the difference
 * is load-bearing: `Deployment` and `Domain` both carry a resting status of
 * their own (`pending`, `success`), so a formatter reporting any status it
 * found would answer "www.example.com domain pending". Keys here are
 * TRANSITIONAL states only; a resting one must never be added.
 */
const IN_FLIGHT: Readonly<Partial<Record<string, string>>> = {
  [DeploymentStatus.DELETING]: 'served until cleanup completes',
};

/**
 * What each mutating operation did, once it is done.
 *
 * `set` is absent because it is an upsert: the wire's 201-vs-200 decided which
 * it was, and `isCreate` carries that decision onto the result.
 */
const PAST_TENSE: Readonly<Partial<Record<Operation, string>>> = {
  upload: 'uploaded',
  create: 'created',
  delete: 'deleted',
  verify: 'verification queued',
};

/**
 * Operations whose response is an ACKNOWLEDGEMENT — the resource noun carrying
 * its key, maybe a state, and nothing else. The sentence is the whole output;
 * there is no entity to render underneath it.
 */
const ACKNOWLEDGING: ReadonlySet<Operation> = new Set<Operation>(['delete', 'verify']);

/**
 * THE sentence. Every announcement the CLI makes about a mutation is this one
 * function of two things it already has — what the command IS
 * (`OutputContext`) and what the wire ANSWERED (`result`).
 *
 *     <canonical key> <resource noun> <past tense, or the wire's own state>
 *
 * Nothing else is needed, and that is the point: until 2026-07-29 five
 * formatters each wrote their own template and produced six grammars between
 * them. `token tok0001 created` inverted the order its own sibling
 * `tok0002 token deleted` used; `ship ./dist` and `domains set` opened with the
 * URL while `verify` and `delete` opened with the key, for the same resource;
 * `domain is valid` named no subject at all. Every one of those was a formatter
 * making a choice it did not need to make.
 *
 * Here the key is READ FROM THE NOUN (`result[noun]`), so `.url` is not
 * reachable; the order belongs to the function, not to a call site; and the
 * state override applies everywhere at once, so an operation that becomes
 * asynchronous tomorrow updates its own sentence.
 *
 * Reports do not pass through here: they have no key and no verb, so they
 * render their answer instead (`ping`, `validate`, `records`, `dns`, `share`).
 * Mutations announce; reports render.
 */
function announce(result: CLIResult, context: OutputContext): string | null {
  const { operation, resource } = context;
  if (!operation || !resource) return null;
  if (result === null || typeof result !== 'object') return null;

  const predicate =
    operation === 'set'
      ? readField(result, 'isCreate')
        ? 'created'
        : 'updated'
      : PAST_TENSE[operation];
  if (!predicate) return null; // a read: there is nothing to announce

  const key = readField(result, resource);
  // A handler that resolved no identifier leaves nothing to report, and the CLI
  // does not invent one from the caller's argument.
  if (typeof key !== 'string') return null;

  const state = readField(result, 'status');
  const consequence = typeof state === 'string' ? IN_FLIGHT[state] : undefined;
  return `${key} ${resource} ${consequence ? `${state} — ${consequence}` : predicate}`;
}

/**
 * The CLI's verb vocabulary — every command declares one.
 *
 * A union rather than `string` because `operation` selects behaviour:
 * `PAST_TENSE` and `ACKNOWLEDGING` are keyed by it, so a typo used to mean a
 * command that silently announced nothing, with every test still green.
 */
export type Operation =
  | 'upload'
  | 'set'
  | 'create'
  | 'delete'
  | 'get'
  | 'validate'
  | 'verify'
  | 'records'
  | 'dns'
  | 'share'
  | 'ping';

/**
 * The wire noun for a resource — which is also the name of the field carrying
 * its identifier, platform-wide ("the wire field for an entity's identifier is
 * the resource noun, never `id`" — `cloudflare/api/CLAUDE.md`).
 *
 * Lowercase because that IS the field name: `announce` reads
 * `result[resource]` directly. It was `resourceType: 'Deployment'` with a
 * `.toLowerCase()` at the single point of use — a capitalisation the code
 * carried around only to undo.
 */
export type Resource = 'deployment' | 'domain' | 'token' | 'account';

/**
 * What the command IS: its verb and its noun. Deliberately NOT what the caller
 * typed — the arguments are the request, and every sentence the CLI writes
 * about a result is composed from the response.
 */
export interface OutputContext {
  operation?: Operation;
  resource?: Resource;
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
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  // Destructure enrichment fields (undefined when result is plain Domain)
  const { _dnsRecords, _shareHash, isCreate, ...displayResult } = result as EnrichedDomain;

  // Display pre-fetched DNS records (for new external domains)
  if (_dnsRecords && _dnsRecords.length > 0) {
    console.log();
    info('DNS records to configure:', false, noColor);
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
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

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
 * Format domain validation result
 */
export function formatDomainValidate(
  result: DomainValidateResponse,
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

  if (result.valid) {
    // The subject is the RESPONSE's normalized name, so the sentence names the
    // form the platform would store rather than whatever case the caller typed.
    success(`${result.normalized ?? 'domain'} domain is valid`, false, noColor);
    console.log();
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
    // A verdict is not a failure. The call succeeded and the answer is "no", so
    // the reason rides STDOUT like every other rendered answer — the exit code
    // (set by the command) is the machine-readable half, which is what
    // `ship domains validate x && …` reads. Writing it to stderr under
    // `[error]` said the command had failed, contradicting both the SDK, which
    // resolves this shape without throwing, and `--json`, which has always put
    // the same verdict on stdout.
    //
    // It names no subject on purpose: `normalized` is null when invalid, so the
    // response carries no identifier, and the CLI does not fall back to the
    // caller's argument.
    console.log(`${plainMessage(result.reason ?? 'domain is invalid')}\n`);
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
  // Rendered like `dns` beside it, rather than announced as a success: nothing
  // was mutated, so there is no acknowledgement to compose. It also stops text
  // and `-q` from being byte-identical — `-q` still emits the bare URL, which
  // is the whole point of that channel.
  console.log(
    formatDetails({ domain: result.domain, setup: setupUrl(result.hash, result.domain) }, noColor),
  );
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
  _context: OutputContext,
  options: FormatOptions,
): void {
  const { noColor } = options;

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
        // Creation only, and deliberately the SECRET rather than the id: it is
        // shown once and never again, so `ship tokens create -q >> .env` is the
        // reason this channel exists here. Must precede the `token` branch —
        // a creation response carries both.
        console.log((result as TokenCreateResponse).secret);
      } else if ('token' in result) {
        // `tokens get` and `tokens delete` printed NOTHING until 2026-07-29:
        // the quiet router had a branch for the `tokens` COLLECTION and none
        // for a single token, so the one resource whose identifier you most
        // want to pipe was the one resource that emitted none — and
        // `ship tokens list -q | xargs -I{} ship tokens delete {} -q`, the
        // idiom this repo's own README teaches, went silent.
        console.log((result as Token).token);
      } else if ('email' in result) {
        console.log((result as Account).email);
      } else if ('valid' in result) {
        const v = result as DomainValidateResponse;
        if (v.valid && v.normalized) console.log(v.normalized);
      }
    }
    return;
  }

  // JSON transmits, text translates. The data channel emits the wire's own
  // shape and never a sentence, so it is answered first and once.
  if (json && result !== null && typeof result === 'object') {
    const output = { ...result } as Record<string, unknown>;
    delete output._dnsRecords;
    delete output._shareHash;
    delete output.isCreate;
    console.log(JSON.stringify(output, null, 2));
    console.log();
    return;
  }

  // Text. A mutation announces, then renders whatever entity it produced; an
  // acknowledgement has no entity underneath, so the sentence is all of it.
  const sentence = announce(result, context);
  if (sentence) success(sentence, false, noColor);
  if (context.operation && ACKNOWLEDGING.has(context.operation)) return;

  // Liveness is a question, so text answers it as one — "reachable" is the
  // whole of what a person asked, and the server clock is noise to them.
  //
  // There is no unreachable arm: a non-OK response throws in transport, so
  // reaching this line at all IS the answer. The CLI carried a `success: false`
  // branch until 2026-07-29 — unreachable code guarding a field the route set
  // to a literal `true`.
  if (context.operation === 'ping') {
    success('api reachable', false, noColor);
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
