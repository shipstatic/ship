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
  password?: string;
  /**
   * `--domain`: serve this deployment at that domain, in one command.
   *
   * The composed deploy links through the same `domains.set()` the `domains
   * set` command runs, so it introduces no response shape, no formatter and no
   * output row of its own.
   */
  domain?: string;
  /**
   * `--ttl`: expire this deployment after the given duration.
   *
   * A NUMBER of seconds by the time it lands here — `parseTtl` owns the
   * `3600` / `1h` / `7d` spelling and the wire never sees a suffix. Declared
   * on the deploy shortcut, which is the program, so it also arrives here for
   * `tokens create`: one flag, one grammar, one read (`ttlOf`).
   */
  ttl?: number;
  /**
   * `--no-path-detect` and `--no-spa-detect`, under the names COMMANDER gives
   * them: a `--no-x` flag stores the POSITIVE key, defaulted to `true`, and
   * sets it `false` when passed. There is no `noPathDetect` anywhere in a
   * parsed result.
   *
   * These were declared as `noPathDetect` / `noSpaDetect` until 2026-08-12 and
   * read under those names, so both flags parsed cleanly and did NOTHING, in
   * both deploy spellings — the exact defect the flag law exists to remove.
   * See CLAUDE.md, "Two flag tiers".
   */
  pathDetect?: boolean;
  spaDetect?: boolean;
}

/**
 * Every flag in effect for the command being run: its own, merged with the
 * program's by Commander (`optsWithGlobals`, parent winning) in
 * `processOptions`.
 *
 * This is the one thing a handler reads. Commander's root consumes any option
 * the ROOT declares, wherever it sits in argv — so a deploy flag typed after
 * `deployments upload` still lands on the program, and the subcommand's own
 * declaration (which exists to make its `--help` and completions accurate)
 * never receives a value. Reading the merged view is what makes that a
 * non-fact instead of a three-helper arbitration family. See CLAUDE.md,
 * "Two flag tiers".
 *
 * **It is deliberately WIDER than any one command's truth**, and that is a
 * recorded cost rather than an oversight: `domains set` receives a type
 * carrying `domain` and `password`, which mean nothing there. It is safe at
 * runtime — `assertFlagsApply` refuses a flag the running command cannot read
 * before the handler exists, so such a field is not merely unset but
 * unreachable — and narrowing per command was rejected on purpose. An
 * annotation like `GlobalOptions & LabelOptions` at each site would be a
 * SECOND statement of that command's flag set, with nothing checking it
 * against the first (the `.option()` calls) — the restatement class this file
 * removes everywhere else. One name, one meaning, one read path.
 */
export interface EffectiveOptions extends GlobalOptions, DeployCommandOptions {}

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
  _shareUrl?: string;
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
  | TokenDeleteResponse;
