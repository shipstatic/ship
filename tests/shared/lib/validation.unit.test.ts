import { ErrorType, isShipError, validateLabels as typesValidateLabels } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { validateDeployConfig, validateLabels } from '../../../src/shared/lib/validation';

// `validateLabels` and `validatePassword` are re-exported from
// `@shipstatic/types`; their tests live in that package
// (`tests/validation-constants.test.ts`) so each validator is verified at its
// source. This file covers SDK-local validators and the re-export itself.

describe('validateLabels', () => {
  it('is the types-tier check, not a second one', () => {
    expect(validateLabels).toBe(typesValidateLabels);
  });

  it('takes a word and a key with a value', () => {
    expect(validateLabels(['Production', 'env:preview'])).toEqual(['production', 'env:preview']);
  });

  it('refuses a second colon with a validation error', () => {
    try {
      validateLabels(['a:b:c']);
      throw new Error('expected throw');
    } catch (err) {
      expect(isShipError(err)).toBe(true);
      expect((err as any).type).toBe(ErrorType.Validation);
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
