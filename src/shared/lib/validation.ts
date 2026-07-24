/**
 * @file Client-side input validation for SDK request boundaries.
 *
 * These validators run before request construction. Constants come from
 * `@shipstatic/types` (`LABEL_CONSTRAINTS`, `LABEL_PATTERN`) so the SDK and
 * API agree on the rules.
 */

import { LABEL_CONSTRAINTS, LABEL_PATTERN, ShipError } from '@shipstatic/types';

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
