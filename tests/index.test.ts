/**
 * @file Subject: `src/index.ts` — the Node entry's export surface.
 *
 * Export IDENTITY only. Five former tests asserted
 * `typeof Exports.SomeType === 'undefined'` for type-only re-exports; types are
 * erased at compile time, so those pass whether or not the export exists — and
 * would pass just as well for a name that was never in the package. The
 * `ErrorType` value restatement that lived here belonged to `@shipstatic/types`
 * and is fenced by `tests/shared/types-reexport.test.ts`.
 */
import * as types from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import * as env from '../src/shared/lib/env';

describe('Main SDK Index (src/index.ts)', () => {
  it('exports the Node Ship class', async () => {
    env.__setTestEnvironment('node');
    const index = await import('../src/index');

    expect(index.Ship).toBeDefined();
    expect(typeof index.Ship).toBe('function');
  });

  it('exports Ship as the default export as well', async () => {
    env.__setTestEnvironment('node');
    const index = await import('../src/index');

    expect(index.default).toBe(index.Ship);
  });

  it('re-exports the SAME ShipError and ErrorType as @shipstatic/types', async () => {
    // Identity, not shape: a consumer doing `err instanceof Ship.ShipError`
    // must match errors the SDK threw, which fails silently if the bundle ever
    // ends up with a second copy of the class.
    const index = await import('../src/index');

    expect(index.ShipError).toBe(types.ShipError);
    expect(index.ErrorType).toBe(types.ErrorType);
  });

  it('re-exports the SAME env helpers as src/shared/lib/env', async () => {
    const index = await import('../src/index');

    expect(index.getENV).toBe(env.getENV);
    expect(index.__setTestEnvironment).toBe(env.__setTestEnvironment);
  });
});
