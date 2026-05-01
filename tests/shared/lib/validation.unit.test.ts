import { describe, it, expect } from 'vitest';
import {
  LABEL_CONSTRAINTS,
  PASSWORD_CONSTRAINTS,
  ErrorType,
  isShipError,
} from '@shipstatic/types';
import { validatePassword, validateLabels } from '../../../src/shared/lib/validation';

describe('validatePassword', () => {
  it('is a no-op for absent values', () => {
    expect(() => validatePassword(undefined)).not.toThrow();
    expect(() => validatePassword(null)).not.toThrow();
  });

  it('rejects non-string values', () => {
    expect(() => validatePassword(123)).toThrow(/string/);
    expect(() => validatePassword(true)).toThrow(/string/);
    expect(() => validatePassword({})).toThrow(/string/);
  });

  it('rejects strings shorter than the minimum', () => {
    const tooShort = 'a'.repeat(PASSWORD_CONSTRAINTS.MIN_LENGTH - 1);
    expect(() => validatePassword(tooShort)).toThrow(/between/);
  });

  it('rejects strings longer than the maximum', () => {
    const tooLong = 'a'.repeat(PASSWORD_CONSTRAINTS.MAX_LENGTH + 1);
    expect(() => validatePassword(tooLong)).toThrow(/between/);
  });

  it('accepts boundary lengths', () => {
    expect(() => validatePassword('a'.repeat(PASSWORD_CONSTRAINTS.MIN_LENGTH))).not.toThrow();
    expect(() => validatePassword('a'.repeat(PASSWORD_CONSTRAINTS.MAX_LENGTH))).not.toThrow();
  });

  it('preserves whitespace verbatim (does not trim)', () => {
    const sixSpaces = ' '.repeat(PASSWORD_CONSTRAINTS.MIN_LENGTH);
    expect(() => validatePassword(sixSpaces)).not.toThrow();
  });

  it('rejects the empty string', () => {
    expect(() => validatePassword('')).toThrow(/between/);
  });

  it('throws ShipError with the same error type the API would emit', () => {
    // Both SDK and API throw ShipError.validation for input format/length
    // errors so users switching on `err.type` see the same value regardless of
    // whether the SDK or the server caught it.
    try {
      validatePassword('x');
      throw new Error('expected throw');
    } catch (err) {
      expect(isShipError(err)).toBe(true);
      expect((err as any).type).toBe(ErrorType.Validation);
      expect((err as any).status).toBe(400);
    }
  });
});

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
