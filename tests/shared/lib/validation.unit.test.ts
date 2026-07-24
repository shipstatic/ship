import { ErrorType, isShipError, LABEL_CONSTRAINTS } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { validateLabels } from '../../../src/shared/lib/validation';

// `validatePassword` is re-exported from `@shipstatic/types`; its tests live
// in that package (`tests/validation-constants.test.ts`) so the canonical
// validator is verified at its source. This file covers SDK-local validators.

describe('validateLabels', () => {
  it('is a no-op for undefined', () => {
    expect(validateLabels(undefined)).toBeUndefined();
  });

  it('is a no-op for null (defensive: JS callers without TS)', () => {
    // @ts-expect-error testing runtime null defense
    expect(validateLabels(null)).toBeUndefined();
  });

  it('returns the empty array unchanged (clear-all-labels semantics)', () => {
    expect(validateLabels([])).toEqual([]);
  });

  it('rejects more than the max count', () => {
    const tooMany = Array.from({ length: LABEL_CONSTRAINTS.MAX_COUNT + 1 }, (_, i) => `label-${i}`);
    expect(() => validateLabels(tooMany)).toThrow(/Maximum/);
  });

  it('lowercases and trims each label', () => {
    expect(validateLabels(['  Production  '])).toEqual(['production']);
  });

  it('rejects labels shorter than the minimum (after trim)', () => {
    const tooShort = 'a'.repeat(LABEL_CONSTRAINTS.MIN_LENGTH - 1);
    expect(() => validateLabels([tooShort])).toThrow(/at least/);
  });

  it('rejects labels longer than the maximum', () => {
    const tooLong = 'a'.repeat(LABEL_CONSTRAINTS.MAX_LENGTH + 1);
    expect(() => validateLabels([tooLong])).toThrow(/no more than/);
  });

  it('rejects labels that violate the pattern', () => {
    expect(() => validateLabels(['-prod'])).toThrow(/alphanumeric/);
    expect(() => validateLabels(['prod-'])).toThrow(/alphanumeric/);
    expect(() => validateLabels(['has spaces'])).toThrow(/alphanumeric/);
  });

  it('rejects duplicate labels (after normalization)', () => {
    expect(() => validateLabels(['Prod', 'prod'])).toThrow(/Duplicate/);
  });

  it('rejects non-string entries', () => {
    // @ts-expect-error testing runtime guard
    expect(() => validateLabels([123])).toThrow(/string/);
  });

  it('accepts a normal labelset and returns it normalized', () => {
    expect(validateLabels(['Prod', 'WEB-V1', 'api.v2'])).toEqual(['prod', 'web-v1', 'api.v2']);
  });

  it('throws ShipError with the same error type the API would emit', () => {
    try {
      validateLabels(['x']);
      throw new Error('expected throw');
    } catch (err) {
      expect(isShipError(err)).toBe(true);
      expect((err as any).type).toBe(ErrorType.Validation);
      expect((err as any).status).toBe(400);
    }
  });
});
