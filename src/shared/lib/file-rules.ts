/**
 * @file One ordered table of deploy-file rules, and the single evaluation two
 * renderers share.
 *
 * **A rule states a predicate and a sentence; a renderer chooses only how to
 * DELIVER it.** That is the `SHAPES`-table move (`cli/formatters.ts`) applied
 * to validation: the throwing renderer raises the first broken rule, the
 * collecting renderer records it, and neither authors prose. Adding a rule is
 * a row, and both surfaces get it in the same position by construction. One
 * table is also what keeps a rule from reading three ways: the deploy
 * pipelines, `validateFiles` and the API once each worded the size cap
 * differently, against the dual-validation doctrine that an error reads the
 * same wherever it is caught (root `CLAUDE.md`).
 *
 * **Every sentence is complete on its own.** The SDK is where a refusal is
 * worded; drop, the console, the CLI and the MCPs show the sentence verbatim
 * and add nothing, so a sentence names its file exactly once and states the
 * limit, and reads without a prefix. The family is subject first: `File
 * "<path>" <verdict>. Maximum <limit> allowed.`, and `File name "<path>" …`
 * where the name is the subject. The total-size rule's subject is the set of
 * files, which is why it names no path. A limit's sentence ends with the way
 * forward the API delivered for it (`withWayForward`), so the whole reads
 * `File "x" is too large. Maximum 20 MB allowed. Upgrade to Pro for more.`
 *
 * **Wording follows the API where a choice existed**, so the deferred Phase B
 * (promoting this table to `@shipstatic/types` with the API consuming it) has
 * less to move. Two deliberate deviations, recorded rather than silent:
 *
 * - **Sizes are formatted, not raw bytes.** The API says `20971520 bytes`;
 *   a browser upload UI showing that is worse for the person reading it, and
 *   the unit is the smaller half of the sentence to reconcile later.
 * - **The path is named.** The API has no path to name; the throwing renderer
 *   has nothing BUT the message, so dropping it would leave a CLI user asking
 *   which file.
 *
 * Out of scope, and left where they are: `validateDeployPath` (a rule about
 * the deploy PATH rather than the file, and pipelines-only), and
 * `validateFiles`' UI-tier pre-checks (empty, negative, count, unbuilt
 * marker, processing error), which have one holder each and no drift, and
 * word their sentences by the same family.
 */

import type { PlatformLimitKey, PlatformLimits } from '@shipstatic/types';
import { isBlockedExtension } from '@shipstatic/types';
import { formatFileSize, validateFileName } from './file-validation.js';

/**
 * A limit's sentence, followed by the way forward past that limit as the API
 * delivered it (`PlatformLimits.suggestions`), verbatim. The API writes that
 * sentence with the function its own refusals end with, so a refusal made
 * here and one made at the boundary end in the same words, and this package
 * never learns what a plan is. An older API delivers none, and nothing is
 * appended.
 */
export function withWayForward(
  sentence: string,
  limits: PlatformLimits,
  key: PlatformLimitKey,
): string {
  const suggestion = limits.suggestions?.[key];
  return suggestion ? `${sentence} ${suggestion}` : sentence;
}

/** What a rule is asked about: one file, and the deploy so far. */
export interface FileRuleInput {
  /** The path this file will be served at. */
  readonly path: string;
  /** This file's size in bytes. */
  readonly size: number;
  /** Bytes accumulated INCLUDING this file — the total rule's subject. */
  readonly totalSize: number;
}

/** A rule: what makes it broken, and the one sentence that says so. */
export interface FileRule {
  /** Stable identity, for the fence and for reading a failure in a test. */
  readonly name: string;
  readonly broken: (input: FileRuleInput, limits: PlatformLimits) => boolean;
  readonly sentence: (input: FileRuleInput, limits: PlatformLimits) => string;
}

/**
 * EVERY rule both client surfaces apply, in the order they apply them.
 *
 * Order is load-bearing and is the reason this is a list rather than a set: a
 * file that is both misnamed and oversized reports the name, because a caller
 * fixing the name may not have an oversize problem at all.
 */
export const FILE_RULES: readonly FileRule[] = [
  {
    // The sentence comes from `validateFileName`, which owns this vocabulary
    // for both surfaces and names the file itself; the rule points at it
    // rather than restating it.
    name: 'name',
    broken: ({ path }) => !validateFileName(path).valid,
    sentence: ({ path }) => validateFileName(path).reason ?? `File name "${path}" is invalid.`,
  },
  {
    // The blocklist is the platform's, delivered through `/limits`. Absent
    // means NO client-side check, never an empty policy: the boundary refuses
    // the file, which is where refusal belongs.
    name: 'extension',
    broken: ({ path }, limits) => isBlockedExtension(path, limits.blockedExtensions ?? []),
    sentence: ({ path }) => `File "${path}" has an extension that is not allowed.`,
  },
  {
    name: 'fileSize',
    broken: ({ size }, limits) => size > limits.maxFileSize,
    sentence: ({ path }, limits) =>
      withWayForward(
        `File "${path}" is too large. Maximum ${formatFileSize(limits.maxFileSize)} allowed.`,
        limits,
        'maxFileSize',
      ),
  },
  {
    name: 'totalSize',
    broken: ({ totalSize }, limits) => totalSize > limits.maxTotalSize,
    sentence: ({ totalSize }, limits) =>
      withWayForward(
        `Files add up to ${formatFileSize(totalSize)}. Maximum ${formatFileSize(limits.maxTotalSize)} allowed.`,
        limits,
        'maxTotalSize',
      ),
  },
];

/**
 * The first rule this file breaks, or `undefined`.
 *
 * The single evaluation both renderers call — which is what makes node/browser
 * parity structural instead of a promise. Neither renderer may re-order, skip,
 * or reword a rule, because neither one knows what the rules are.
 */
export function firstBrokenRule(
  input: FileRuleInput,
  limits: PlatformLimits,
): FileRule | undefined {
  return FILE_RULES.find((rule) => rule.broken(input, limits));
}
