/**
 * @file Package-artifact fence: consume `dist/` exactly the way a user does.
 *
 * Nothing verified the BUILT package before 2026-07-27 — a broken `exports`
 * map, a bad CJS interop shim, or a dts regression would have shipped silently,
 * and `@shipstatic/ship` is a Stable published package. `publint` and
 * `attw` (run by `pnpm check:package`) read the manifest; this reads the
 * artifact.
 *
 * Recorded artifact-tier exception in the integrity fence: it deliberately
 * imports `dist/`, not `src/` — that IS its subject.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '../../dist');
const require = createRequire(import.meta.url);

describe('built package entries', () => {
  it('emits every entry the exports map promises', () => {
    for (const file of [
      'index.js',
      'index.cjs',
      'index.d.ts',
      'index.d.cts',
      'browser.js',
      'browser.d.ts',
      'cli.cjs',
    ]) {
      expect(existsSync(resolve(DIST, file)), `dist/${file} is missing`).toBe(true);
    }
  });

  it('require() of the CJS entry yields a constructible Ship', () => {
    // The post-build shim reassigns module.exports to the class so
    // `const Ship = require('@shipstatic/ship')` works (the axios convention).
    const required = require(resolve(DIST, 'index.cjs'));

    expect(typeof required).toBe('function');
    expect(new required({ apiUrl: 'https://api.example.com' })).toBeDefined();
    // …while the named and default forms keep working alongside it.
    expect(required.Ship).toBe(required);
    expect(required.default).toBe(required);
    expect(required.ShipError).toBeDefined();
  });

  it('import() of the ESM entry yields a constructible Ship', async () => {
    const mod = await import(pathToFileURL(resolve(DIST, 'index.js')).href);

    expect(typeof mod.Ship).toBe('function');
    expect(new mod.Ship({ apiUrl: 'https://api.example.com' })).toBeDefined();
    expect(mod.default).toBe(mod.Ship);
  });

  it('the browser bundle loads and constructs', async () => {
    const mod = await import(pathToFileURL(resolve(DIST, 'browser.js')).href);

    expect(typeof mod.Ship).toBe('function');
    expect(mod.processFilesForBrowser).toBeDefined();
  });

  it('bundles @shipstatic/types rather than depending on it', () => {
    // types is a devDependency, so a consumer does not install it — a runtime
    // reference to it in the artifact would be an unresolvable import.
    const required = require(resolve(DIST, 'index.cjs'));

    expect(required.ShipError).toBeDefined();
    expect(required.ErrorType?.Validation).toBe('validation_failed');
  });
});
