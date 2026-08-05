/**
 * Pure formatting functions for CLI output.
 * All formatters are synchronous and have no side effects beyond console output.
 */

import type {
  Account,
  Deployment,
  DeploymentCreateResponse,
  DeploymentDeleteResponse,
  DeploymentListResponse,
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
  if (!resource) return null;
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
  | 'list'
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
  operation: Operation;
  /** Absent only for `ping`, which names no resource. */
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
export function formatDomainsList(result: DomainListResponse, options: FormatOptions): void {
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
export function formatDomain(result: Domain | EnrichedDomain, options: FormatOptions): void {
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
export function formatAccount(result: Account, options: FormatOptions): void {
  const { noColor } = options;
  console.log(formatDetails(result, noColor));
}

/**
 * Format domain validation result
 */
export function formatDomainValidate(result: DomainValidateResponse, options: FormatOptions): void {
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
export function formatDomainRecords(result: DomainRecordsResponse, options: FormatOptions): void {
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
export function formatDomainDns(result: DomainDnsResponse, options: FormatOptions): void {
  const { noColor } = options;
  const provider = result.dns?.provider?.name || null;
  console.log(formatDetails({ domain: result.domain, provider }, noColor));
}

/**
 * Format domain share result as setup URL
 */
export function formatDomainShare(result: DomainShareResponse, options: FormatOptions): void {
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
export function formatTokensList(result: TokenListResponse, options: FormatOptions): void {
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
export function formatToken(result: Token | TokenCreateResponse, options: FormatOptions): void {
  const { noColor } = options;

  console.log(formatDetails(result, noColor));
}

/**
 * What one command produces, in each of the two channels that render it.
 *
 * `T` is the response type that command's endpoint returns, so an entry's
 * bodies are typed and contain no casts of their own.
 */
interface Output<T = CLIResult> {
  /** `-q`: the identifier(s) you would pipe onward, or none if it has none. */
  readonly quiet: (result: T) => string[];
  /** Text: render the answer. The mutation SENTENCE is `announce`'s job. */
  readonly text: (result: T, options: FormatOptions) => void;
}

/** Give one entry its real response type. An identity function, nothing more. */
const row = <T>(spec: Output<T>) => spec as Output;

/** Every key the table can hold — the typo guard. */
type OutputKey = `${Resource}.${Exclude<Operation, 'ping'>}` | 'ping';

/** The key a command's declared identity resolves to. */
const keyOf = (context: OutputContext): OutputKey =>
  (context.resource ? `${context.resource}.${context.operation}` : context.operation) as OutputKey;

/**
 * EVERY command's output, keyed by what the command IS.
 *
 * **Output is selected by what the command DECLARED, never by what the
 * response LOOKS LIKE.** `OutputContext` already says which command ran; the
 * router used to throw that away and reconstruct it by sniffing the payload
 * (`'secret' in result`…). Reconstruction is what made resolution ORDER a
 * load-bearing concept — `secret` before `token`, `domain` before
 * `deployment`, because those payloads overlap — and order had to be
 * documented, fenced, and preserved by hand. Keyed by identity, the ties are
 * not merely resolved: they are inexpressible. `token.create` emitting the
 * secret is simply a different row from `token.get`.
 *
 * Two things follow. The entries need no casts, because the key implies the
 * response type via the wire contract (context ↔ endpoint ↔ response). And the
 * special cases stop being special: `ping`'s pre-table answer and the
 * text-mode-only deletion short-circuit are ordinary rows.
 *
 * The table doubles as the CLI's entire output surface, written down once —
 * which is what lets `tests/architecture/sdk-cli-parity.test.ts` check it
 * against the SDK's own resource methods.
 *
 * Exported for the suite, which pins its own per-row cases AGAINST this list;
 * a hand-written expectation checked against a hand-written list is a mirror,
 * not a fence.
 */
/**
 * `Partial` because `OutputKey` is the full cross-product of resources and
 * operations while only ~20 of those pairs are real commands. The parity fence
 * is what proves the set is exactly right; the key type only stops typos.
 */
export const OUTPUTS: Partial<Record<OutputKey, Output>> = {
  // ─── deployments ───
  'deployment.list': row<DeploymentListResponse>({
    quiet: (r) => r.deployments.map((d) => d.deployment),
    text: formatDeploymentsList,
  }),
  'deployment.upload': row<Deployment>({
    quiet: (r) => [r.deployment],
    text: formatDeployment,
  }),
  'deployment.get': row<Deployment>({
    quiet: (r) => [r.deployment],
    text: formatDeployment,
  }),
  'deployment.set': row<Deployment>({
    quiet: (r) => [r.deployment],
    text: formatDeployment,
  }),
  'deployment.delete': row<DeploymentDeleteResponse>({
    quiet: (r) => [r.deployment],
    // An acknowledgement is the sentence and nothing else — there is no entity
    // left to render beneath it. `announce` has already written it.
    text: () => {},
  }),

  // ─── domains ───
  'domain.list': row<DomainListResponse>({
    quiet: (r) => r.domains.map((d) => d.domain),
    text: formatDomainsList,
  }),
  'domain.get': row<Domain>({
    quiet: (r) => [r.domain],
    text: formatDomain,
  }),
  'domain.set': row<Domain | EnrichedDomain>({
    quiet: (r) => [r.domain],
    text: formatDomain,
  }),
  'domain.validate': row<DomainValidateResponse>({
    // An invalid name has no `normalized` form, so there is no identifier —
    // the verdict rides the exit code, which is what `-q` callers read.
    quiet: (r) => (r.valid && r.normalized ? [r.normalized] : []),
    text: formatDomainValidate,
  }),
  'domain.verify': row<DomainVerifyResponse>({
    quiet: (r) => [r.domain],
    text: () => {},
  }),
  'domain.records': row<DomainRecordsResponse>({
    quiet: (r) => r.records.map((rec) => `${rec.type} ${rec.name} ${rec.value}`),
    text: formatDomainRecords,
  }),
  'domain.dns': row<DomainDnsResponse>({
    // A lookup that resolved no provider has no identifier to pipe.
    quiet: (r) => (r.dns?.provider?.name ? [r.dns.provider.name] : []),
    text: formatDomainDns,
  }),
  'domain.share': row<DomainShareResponse>({
    quiet: (r) => [setupUrl(r.hash, r.domain)],
    text: formatDomainShare,
  }),
  'domain.delete': row<DomainDeleteResponse>({
    quiet: (r) => [r.domain],
    text: () => {},
  }),

  // ─── tokens ───
  'token.list': row<TokenListResponse>({
    quiet: (r) => r.tokens.map((t) => t.token),
    text: formatTokensList,
  }),
  'token.create': row<TokenCreateResponse>({
    // The SECRET rather than the id, deliberately: it is shown once and never
    // again, so `ship tokens create -q >> .env` is why this channel exists
    // here. Under the old shape-router this needed `secret` to be probed
    // before `token`; now it is simply a different row.
    quiet: (r) => [r.secret],
    text: formatToken,
  }),
  'token.get': row<Token>({
    quiet: (r) => [r.token],
    text: formatToken,
  }),
  'token.delete': row<TokenDeleteResponse>({
    quiet: (r) => [r.token],
    text: () => {},
  }),

  // ─── account ───
  'account.get': row<Account>({
    quiet: (r) => [r.email],
    text: formatAccount,
  }),

  // ─── top level ───
  ping: row<PingResponse>({
    // A clock is not an identifier to pipe.
    quiet: () => [],
    // Liveness is a question, so text answers it as one — the server clock is
    // noise to a person. There is no unreachable arm: a non-OK response throws
    // in transport, so reaching this line at all IS the answer.
    text: (_r, o) => success('api reachable', false, o.noColor),
  }),
};

/**
 * The one output path: JSON transmits, `-q` pipes the key, text renders.
 *
 * Every channel dispatches on the command's DECLARED identity — never on the
 * shape of the response. See `OUTPUTS`.
 */
export function formatOutput(
  result: CLIResult,
  context: OutputContext,
  options: FormatOptions,
): void {
  const { json, quiet, noColor } = options;
  const output = OUTPUTS[keyOf(context)];

  // Quiet mode: output only the key identifier.
  if (quiet) {
    for (const line of output?.quiet(result) ?? []) console.log(line);
    return;
  }

  // JSON transmits, text translates. The data channel emits the wire's own
  // shape and never a sentence, so it is answered first and once.
  if (json && result !== null && typeof result === 'object') {
    const payload = { ...result } as Record<string, unknown>;
    delete payload._dnsRecords;
    delete payload._shareHash;
    delete payload.isCreate;
    console.log(JSON.stringify(payload, null, 2));
    console.log();
    return;
  }

  // Text. A mutation announces, then its row renders whatever entity it
  // produced — an acknowledgement's row renders nothing, because the sentence
  // is the whole of it.
  const sentence = announce(result, context);
  if (sentence) success(sentence, false, noColor);

  if (output) {
    output.text(result, options);
  } else if (result !== null && typeof result === 'object') {
    // A command with no row of its own is not an occasion to print the word
    // "success": that asserts the call worked, which the exit code already
    // said, and it hides the answer the command was run for. Render what
    // arrived. `GET /labels` and `GET /limits` are real endpoints with no CLI
    // command yet (`CLAUDE.md`, "Routes the API exposes that the SDK does not
    // reach") — a safety net, not a plan: the parity fence goes red before an
    // unmapped command could ever be run.
    console.log(formatDetails(result, noColor));
  }
  // A non-object result is unrenderable. Saying nothing is honest; saying
  // "success" would not be.
}
