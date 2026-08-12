/**
 * @file One ordered table of deploy-file rules, and the single evaluation two
 * renderers share.
 *
 * **The defect this closes:** one rule was rendering as three sentences. A
 * file over the size cap said `File x is too large. Maximum allowed size is
 * 20MB.` from the deploy pipelines, `File size (21 MB) exceeds limit of 20 MB`
 * from `validateFiles`, and `File too large. Maximum 20971520 bytes allowed`
 * from the API — against the dual-validation doctrine that an error reads the
 * same wherever it was caught (root `CLAUDE.md`). Both pipelines also restated
 * the whole ordered check, so node/browser parity was a comment.
 *
 * **A rule states a predicate and a sentence; a renderer chooses only how to
 * DELIVER it.** That is the `SHAPES`-table move (`cli/formatters.ts`) applied
 * to validation: the throwing renderer raises the first broken rule, the
 * collecting renderer records it, and neither authors prose. Adding a rule is
 * a row, and both surfaces get it in the same position by construction.
 *
 * **Wording follows the API where a choice existed**, so the deferred Phase B
 * — promoting this table to `@shipstatic/types` with the API consuming it —
 * has less to move. Two deliberate deviations, recorded rather than silent:
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
 * `validateFiles`' UI-tier pre-checks — empty, negative, count, unbuilt
 * marker, processing error — which have one holder each and no drift.
 */

import type { PlatformLimits } from '@shipstatic/types';
import { isBlockedExtension } from '@shipstatic/types';
import { formatFileSize, validateFileName } from './file-validation.js';

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
    // The reason comes from `validateFileName`, which already owns this
    // vocabulary for both surfaces — the rule points at it rather than
    // restating it.
    name: 'name',
    broken: ({ path }) => !validateFileName(path).valid,
    sentence: ({ path }) => validateFileName(path).reason ?? 'Invalid file name',
  },
  {
    // The blocklist is the platform's, delivered through `/limits`. Absent
    // means NO client-side check, never an empty policy: the boundary refuses
    // the file, which is where refusal belongs.
    name: 'extension',
    broken: ({ path }, limits) => isBlockedExtension(path, limits.blockedExtensions ?? []),
    sentence: ({ path }) => `File extension not allowed: "${path}"`,
  },
  {
    name: 'fileSize',
    broken: ({ size }, limits) => size > limits.maxFileSize,
    sentence: ({ path }, limits) =>
      `File "${path}" too large. Maximum ${formatFileSize(limits.maxFileSize)} allowed`,
  },
  {
    name: 'totalSize',
    broken: ({ totalSize }, limits) => totalSize > limits.maxTotalSize,
    sentence: ({ totalSize }, limits) =>
      `Total upload size too large. ${formatFileSize(totalSize)} exceeds maximum of ${formatFileSize(limits.maxTotalSize)}`,
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
