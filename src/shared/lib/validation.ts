/**
 * @file Client-side input validation for SDK request boundaries.
 *
 * These validators run before request construction, and this module is the
 * one import surface for them (`http.ts` takes all three from here). The
 * rules themselves live in `@shipstatic/types` — constants
 * (`LABEL_CONSTRAINTS`, `LABEL_PATTERN`) and whole checks
 * (`validatePassword`, `assertShipJsonSyntax`) alike — so the SDK and the
 * API can never disagree about what a value must look like.
 *
 * Every check here is format, never policy: length envelopes, patterns, JSON
 * syntax. Anything that can evolve server-side — password strength, plan
 * caps, the ship.json schema — is deliberately absent, because a client that
 * judged it would reject input a newer platform accepts. See
 * `@shipstatic/types/CLAUDE.md` "Validation: format vs policy".
 */

import type { StaticFile } from '@shipstatic/types';
import {
  assertShipJsonSyntax,
  DEPLOYMENT_CONFIG_FILENAME,
  LABEL_CONSTRAINTS,
  LABEL_PATTERN,
  ShipError,
} from '@shipstatic/types';

// Re-export the canonical password validator from `@shipstatic/types` so
// existing SDK callers (`http.ts`) keep their `from '../lib/validation.js'`
// import path unchanged. The types-tier definition is the single source of
// truth — see `@shipstatic/types/CLAUDE.md` "Validation: format vs policy".
export { validatePassword } from '@shipstatic/types';

/**
 * Validate and normalize an array of labels.
 *
 * Lowercases and trims each entry, enforces per-label length and pattern
 * (`LABEL_CONSTRAINTS` / `LABEL_PATTERN`), count cap, and uniqueness after
 * normalization. Returns the normalized array. An empty array is valid and
 * signals "clear all labels" on label-update operations.
 */
export function validateLabels(labels: string[]): string[];
export function validateLabels(labels: string[] | undefined | null): string[] | undefined;
export function validateLabels(labels: string[] | undefined | null): string[] | undefined {
  if (labels === undefined || labels === null) return undefined;
  if (labels.length === 0) return labels;

  if (labels.length > LABEL_CONSTRAINTS.MAX_COUNT) {
    throw ShipError.validation(`Maximum ${LABEL_CONSTRAINTS.MAX_COUNT} labels allowed`);
  }

  const normalized = labels.map((label, i) => {
    if (typeof label !== 'string') {
      throw ShipError.validation(`Label at index ${i} must be a string`);
    }
    const cleaned = label.trim().toLowerCase();
    if (cleaned.length < LABEL_CONSTRAINTS.MIN_LENGTH) {
      throw ShipError.validation(
        `Labels must be at least ${LABEL_CONSTRAINTS.MIN_LENGTH} characters long`,
      );
    }
    if (cleaned.length > LABEL_CONSTRAINTS.MAX_LENGTH) {
      throw ShipError.validation(
        `Labels must be no more than ${LABEL_CONSTRAINTS.MAX_LENGTH} characters long`,
      );
    }
    if (!LABEL_PATTERN.test(cleaned)) {
      throw ShipError.validation(
        `Labels must start and end with alphanumeric characters, with optional separators (${LABEL_CONSTRAINTS.SEPARATORS}) between segments`,
      );
    }
    return cleaned;
  });

  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) {
    throw ShipError.validation('Duplicate labels are not allowed');
  }

  return unique;
}

/**
 * Validate a deploy's root `ship.json` — syntax only, never schema.
 *
 * The same format-not-policy split the password and label validators follow,
 * drawn one layer further out: ship.json's schema and its compiler live on
 * the server and evolve there, so a client that judged them would reject
 * configs a newer platform accepts. `assertShipJsonSyntax` (the types-tier
 * definition, and the single source of truth) checks only what holds for
 * every past and future schema — the text parses as JSON, and its top level
 * is an object.
 *
 * Scope matches the API's `findDeploymentConfigFile`: the exact name at the
 * deploy root, optional leading slash and nothing else, so a
 * `config/ship.json` stays an ordinary asset the platform never reads.
 */
export async function validateDeployConfig(files: StaticFile[]): Promise<void> {
  const config = files.find(
    (f) => f.path === DEPLOYMENT_CONFIG_FILENAME || f.path === `/${DEPLOYMENT_CONFIG_FILENAME}`,
  );
  if (!config) return;

  // Node hands the pipeline a `Buffer`; the browser a `File`/`Blob`, which is
  // the only one of the two carrying `.text()`.
  const content = config.content as Blob;
  const text =
    typeof content.text === 'function'
      ? await content.text()
      : (config.content as Buffer).toString('utf8');

  assertShipJsonSyntax(text);
}
