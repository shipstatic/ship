import { ErrorType, isShipError, LABEL_CONSTRAINTS } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { validateDeployConfig, validateLabels } from '../../../src/shared/lib/validation';

// `validatePassword` is re-exported from `@shipstatic/types`; its tests live
// in that package (`tests/validation-constants.test.ts`) so the canonical
// validator is verified at its source. This file covers SDK-local validators.

describe('validateLabels', () => {
  it('is a no-op for undefined', () => {
    expect(validateLabels(undefined)).toBeUndefined();
  });

  it('is a no-op for null (defensive: JS callers without TS)', () => {
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

describe('validateDeployConfig', () => {
  // Syntax only, by design: the ship.json schema evolves server-side, so
  // anything this judged beyond "is it JSON, is it an object" could reject a
  // config a newer platform accepts. The exhaustive syntax cases live with
  // the rule itself in `@shipstatic/types`; these cover the SDK-local half —
  // which file is chosen, and reading either platform's content shape.
  const file = (path: string, body: string) => ({
    path,
    content: Buffer.from(body),
    md5: 'abc123',
    size: body.length,
  });
  const index = file('index.html', '<html></html>');

  it('passes when the deploy carries no config at all', async () => {
    await expect(validateDeployConfig([index])).resolves.toBeUndefined();
  });

  it('accepts a well-formed config, including keys it does not know', async () => {
    await expect(
      validateDeployConfig([index, file('ship.json', '{"inventedLater":{"a":1}}')]),
    ).resolves.toBeUndefined();
  });

  it('rejects unparsable JSON as a Config error', async () => {
    await expect(
      validateDeployConfig([index, file('ship.json', '{"redirects":[],}')]),
    ).rejects.toMatchObject({ type: ErrorType.Config });
  });

  it('rejects valid JSON that is not an object', async () => {
    await expect(validateDeployConfig([index, file('ship.json', '[]')])).rejects.toMatchObject({
      type: ErrorType.Config,
    });
  });

  it('accepts the root config with a leading slash', async () => {
    // wire: findDeploymentConfigFile — exact name, optional leading slash.
    await expect(
      validateDeployConfig([index, file('/ship.json', '{ not json')]),
    ).rejects.toMatchObject({ type: ErrorType.Config });
  });

  it('ignores a ship.json that is not at the deploy root', async () => {
    // Anywhere but the root it is an ordinary asset the platform never reads.
    await expect(
      validateDeployConfig([index, file('config/ship.json', '{ not json')]),
    ).resolves.toBeUndefined();
  });

  it('reads Blob content, the shape the browser pipeline produces', async () => {
    const blob = { path: 'ship.json', content: new Blob(['{ not json']), md5: 'x', size: 10 };
    await expect(validateDeployConfig([index, blob as never])).rejects.toMatchObject({
      type: ErrorType.Config,
    });
  });
});
