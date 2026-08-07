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

  it('the star re-export of @shipstatic/types survives into BOTH entries', async () => {
    // `ShipError`/`ErrorType` above are ALSO re-exported BY NAME in
    // shared/index.ts, so they stayed green on 2026-08-07 while the whole
    // `export * from '@shipstatic/types'` expansion silently vanished from the
    // built entries — 2.0.0-beta.16 shipped with 26 exports instead of ~76,
    // and every consumer of the vocabulary (the MCP's PASSWORD_CONSTRAINTS
    // interpolation, first) broke at import time. The names below arrive
    // ONLY through the star, so they fence the expansion itself.
    const star = [
      'PASSWORD_CONSTRAINTS',
      'validateToken',
      'AuthMethod',
      'DEPLOY_FIELDS',
      'SHIP_ENV',
    ];
    const cjs = require(resolve(DIST, 'index.cjs'));
    const esm = await import(pathToFileURL(resolve(DIST, 'index.js')).href);

    for (const name of star) {
      expect(cjs[name], `CJS entry lost '${name}' from the types star re-export`).toBeDefined();
      expect(esm[name], `ESM entry lost '${name}' from the types star re-export`).toBeDefined();
    }
  });

  it('@shipstatic/types is NEVER a runtime dependency', () => {
    // The manifest half of the same 2026-08-07 escape: tsup auto-externalizes
    // `dependencies`, so a types entry there flips the bundler from "inline
    // the vocabulary" to "leave an import a consumer cannot resolve" — the
    // exact mechanism that broke beta.16, via a version bump applied to the
    // wrong key. Bundling requires the pin to live in devDependencies alone.
    const pkg = require(resolve(DIST, '../package.json'));

    expect(pkg.dependencies).not.toHaveProperty('@shipstatic/types');
    expect(pkg.devDependencies).toHaveProperty('@shipstatic/types');
  });
});
