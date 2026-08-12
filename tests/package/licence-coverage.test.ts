/**
 * @file Fence: the third-party licence list is derived from EVERY bundle the
 * package ships — not from whichever metafiles happened to survive the build.
 *
 * Bundling MIT/BSD/ISC code obliges us to carry its notices, and
 * `scripts/third-party-licenses.cjs` meets that by reading esbuild's metafiles
 * rather than a hand-kept list. That derivation is only as honest as its
 * inputs, and its inputs were quietly wrong for as long as they existed.
 *
 * tsup names its metafile `metafile-{format}.json` inside `outDir`, and ship's
 * three build configs share one `outDir` and run CONCURRENTLY — so `index` and
 * `browser` both wrote `dist/metafile-esm.json`, and `index` and `cli` both
 * wrote `dist/metafile-cjs.json`. Measured over 24 builds on 2026-08-12: about
 * one in nine under CPU load ended with a half-overwritten file that
 * `JSON.parse` rejected, failing the build — and `prepack` is `build`, so a
 * publish inherited that coin flip.
 *
 * **The crash was the lucky outcome.** The quiet one is a metafile that
 * survives intact while describing the wrong bundle: the licence list is then
 * derived from a SUBSET of what the artifact bundles, the notice under-reports,
 * and the build exits 0. It never happened only because the CLI bundle is a
 * superset of the index bundle — an accident of this package's shape, not a
 * property anything enforced. The index bundle's own metafile was discarded on
 * EVERY build for as long as the collision existed, and nothing noticed.
 *
 * `tsup.config.ts` now writes one metafile per (entry, format) outside `dist`.
 * This fence is the half that declines to trust that: it asks whether every
 * bundle the package SHIPS is described by some metafile, reading the shipped
 * set from `package.json`'s `exports` + `bin` — the published artifact's own
 * account of itself, rather than a restatement of the build config that
 * happened to produce it. A future fourth entry is covered the day it ships.
 *
 * Per the sibling `bundle-boundary.test.ts`: the checks are functions of their
 * inputs, and `the checks can see a defect` feeds each one a synthetic defect
 * and asserts it is CAUGHT — because a hand drill is evidence that evaporates.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

const { shippedBundles, describedBundles, uncoveredBundles, bundledPackages, packageOf, META_DIR } =
  require('../../scripts/third-party-licenses.cjs');

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** The metafiles the real build wrote, read the way the real script reads them. */
function realMetafiles(): Record<string, unknown>[] {
  if (!existsSync(META_DIR)) return [];
  return readdirSync(META_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => JSON.parse(readFileSync(join(META_DIR, f), 'utf8')));
}

/** A metafile-shaped stub: names the bundles it describes and the inputs it saw. */
const meta = (outputs: string[], inputs: string[] = []) => ({
  inputs: Object.fromEntries(inputs.map((i) => [i, { bytes: 1 }])),
  outputs: Object.fromEntries(outputs.map((o) => [o, { bytes: 1 }])),
});

describe('licence coverage', () => {
  it('the shipped bundle set is read from exports + bin, and is not empty', () => {
    // If this ever returns [] the coverage check below becomes vacuous — every
    // shipped bundle would be trivially covered.
    const shipped = shippedBundles(manifest);
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped).toContain('dist/cli.cjs');
    expect(shipped).toContain('dist/index.cjs');
    expect(shipped).toContain('dist/index.js');
    expect(shipped).toContain('dist/browser.js');
  });

  it('every bundle this package ships is described by a metafile', () => {
    const metafiles = realMetafiles();
    // The build must have run. A missing build-meta/ would otherwise make the
    // assertion below pass by describing nothing against nothing.
    expect(metafiles.length).toBeGreaterThan(0);
    expect(uncoveredBundles(manifest, metafiles)).toEqual([]);
  });

  it('the index bundle is described — the one the old collision always lost', () => {
    // Named on purpose. Under the shared-path scheme `index`'s metafiles were
    // overwritten by `browser`'s and `cli`'s on every single build, so this is
    // the assertion that would have been red for the defect's whole lifetime.
    expect(describedBundles(realMetafiles())).toEqual(
      expect.arrayContaining(['dist/index.cjs', 'dist/index.js']),
    );
  });

  it('the collected package set is real, and includes CLI-only bundled code', () => {
    // The licence obligation this whole mechanism exists for: packages that
    // reach the consumer ONLY by being bundled into dist/cli.cjs.
    const names = [...bundledPackages(realMetafiles()).keys()];
    expect(names).toEqual(expect.arrayContaining(['commander', 'columnify', 'yoctocolors']));
  });

  describe('the checks can see a defect', () => {
    it('catches a shipped bundle that no metafile describes', () => {
      // Exactly the silent variant: cli survives, index is lost.
      const onlyCli = [meta(['dist/cli.cjs'])];
      expect(uncoveredBundles(manifest, onlyCli)).toEqual(
        expect.arrayContaining(['dist/index.cjs', 'dist/index.js', 'dist/browser.js']),
      );
      // And is silent when everything is described.
      const all = [meta(shippedBundles(manifest))];
      expect(uncoveredBundles(manifest, all)).toEqual([]);
    });

    it('catches the total loss of the metafiles', () => {
      expect(uncoveredBundles(manifest, [])).toEqual(shippedBundles(manifest));
    });

    it('does not count a sourcemap as a described bundle', () => {
      // `outputs` carries `.map` entries beside the real ones; treating them as
      // coverage would let a metafile "describe" a bundle it never built.
      expect(describedBundles([meta(['dist/cli.cjs.map'])])).toEqual([]);
    });

    it('reads package names out of real bundler paths, scoped ones included', () => {
      expect(
        packageOf('node_modules/.pnpm/commander@14.0.3/node_modules/commander/index.js')?.name,
      ).toBe('commander');
      expect(
        packageOf('node_modules/.pnpm/@shipstatic+types@1.0.0/node_modules/@shipstatic/types/x.js')
          ?.name,
      ).toBe('@shipstatic/types');
      // A first-party source file is not a third-party package.
      expect(packageOf('src/shared/index.ts')).toBeNull();
    });

    it('collects nothing from a metafile that saw no third-party input', () => {
      expect([...bundledPackages([meta(['dist/x.js'], ['src/a.ts'])]).keys()]).toEqual([]);
    });
  });
});
