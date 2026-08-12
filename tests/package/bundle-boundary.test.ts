/**
 * @file Fence: the line between what this package BUNDLES and what it asks a
 * consumer to install — held in three directions, plus the config that draws
 * it.
 *
 * The split was a hand-maintained list with nothing checking it, and it had
 * already rotted: `tsup.config.ts` named `cosmiconfig` and `cli-table3` as
 * externals for two majors after both were deleted, and carried an alias to a
 * build shim for a package that no longer existed. Nothing was wrong at
 * runtime, which is exactly why it survived — a dead external is invisible
 * until someone reads the file.
 *
 * The live half of the same defect was the opposite direction: `commander`,
 * `columnify`, `yocto-spinner` and `yoctocolors` sat in `dependencies` and are
 * reachable only from the CLI, so every embedded SDK consumer — the MCP, and
 * through it the vscode `.vsix` — installed four packages it never executes,
 * and every `npx @shipstatic/ship` cold-run paid to download them.
 *
 * This reads the BUILT artifact, like `dist-entries.test.ts` beside it: what a
 * bundle actually requires is a property of the bytes, not of the config that
 * produced them.
 *
 * **And it ships with its own falsification, which it runs every time.** The
 * hand drill that was supposed to prove this fence planted NOTHING, twice: a
 * grep matched the dead external's name in a comment, and biome collapsed the
 * array it had been edited into. Both times the fence stayed green and was one
 * step from being reported as proven. A hand drill is evidence that
 * evaporates — the reader of a green suite cannot see it — so the checks below
 * are functions of their inputs, and `the checks can see a defect` feeds each
 * one a synthetic one and asserts it is CAUGHT. The fence proves it can fail
 * on every run, not once in a war story.
 */

import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from 'tsup';
import { describe, expect, it } from 'vitest';
import tsupConfig from '../../tsup.config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declaredDependencies: string[] = Object.keys(manifest.dependencies ?? {});

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Every bare specifier a built file pulls in at runtime — `require(...)` and
 * dynamic `import(...)` alike, since the CLI reaches for its spinner through
 * the second. Relative paths are the bundle's own business.
 */
function externalSpecifiers(distFile: string): string[] {
  const source = readFileSync(join(ROOT, 'dist', distFile), 'utf8');
  const found = new Set<string>();
  for (const m of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]);
  for (const m of source.matchAll(/(?:^|[^.\w])import\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]);
  for (const m of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) found.add(m[1]);
  return [...found].filter((s) => !s.startsWith('.') && !s.startsWith('/') && !BUILTINS.has(s));
}

/** The package a specifier belongs to — `zod/v4` is still `zod`. */
const packageOf = (specifier: string) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

/**
 * The three checks, as functions of their inputs rather than of the repo.
 *
 * Stating them this way is what lets the same logic that judges the real
 * bundle be handed a known defect and be seen to catch it. Each returns the
 * offenders it found, so "green" is an empty list from the same code path
 * that would have listed a real one.
 */
const undeclaredSpecifiers = (specifiers: readonly string[], declared: readonly string[]) =>
  specifiers.filter((s) => !declared.includes(packageOf(s)));

const unreachedDependencies = (
  reachedSpecifiers: readonly string[],
  declared: readonly string[],
) => {
  const reached = new Set(reachedSpecifiers.map(packageOf));
  return declared.filter((dep) => !reached.has(dep));
};

const deadExternals = (externals: readonly string[], declared: readonly string[]) =>
  externals.filter((e) => !declared.includes(e));

/** Every tsup external, read from the real config rather than restated. */
const configuredExternals = (): string[] => {
  // `defineConfig` widens to a union that includes non-callable shapes; this
  // config is the function form, which is the thing under test.
  const build = tsupConfig as (o: Options) => Options[];
  return [...new Set(build({}).flatMap((c) => (c.external ?? []) as string[]))] as string[];
};

describe('the bundle boundary', () => {
  it('finds a non-trivial surface (guards the quantifiers)', () => {
    // Were the manifest or the dist read to come back empty, every assertion
    // below would pass while proving nothing.
    expect(declaredDependencies.length).toBeGreaterThan(2);
    expect(readFileSync(join(ROOT, 'dist/cli.cjs'), 'utf8').length).toBeGreaterThan(1000);
  });

  it('dist/cli.cjs requires NOTHING beyond node builtins', () => {
    // The CLI is self-contained, which is what lets its four packages leave
    // `dependencies`. A bare specifier here means one of them escaped the
    // bundle and an `npx` run would fail on a machine that never installed it.
    expect(externalSpecifiers('cli.cjs')).toEqual([]);
  });

  it('every specifier the SDK entries require is a declared dependency', () => {
    const offenders = ['index.js', 'index.cjs', 'browser.js'].flatMap((entry) =>
      undeclaredSpecifiers(externalSpecifiers(entry), declaredDependencies).map(
        (specifier) => `${entry} → ${specifier}`,
      ),
    );
    expect(
      offenders,
      'A built entry reaches for a package the manifest does not declare, so a ' +
        'consumer install would not have it.',
    ).toEqual([]);
  });

  it('every declared dependency is actually reached by some entry', () => {
    // The third direction, and the one that catches the rot: a dependency
    // nothing imports is a package every consumer installs for nothing.
    const reached = ['index.js', 'index.cjs', 'browser.js', 'cli.cjs'].flatMap(externalSpecifiers);
    expect(
      unreachedDependencies(reached, declaredDependencies),
      'A declared dependency that no built entry requires is dead weight in ' +
        'the contract — bundle it and demote it, or delete it.',
    ).toEqual([]);
  });

  it('every tsup external names a declared dependency', () => {
    // The config half. Read from the real config rather than restated: the two
    // dead entries sat here for two majors precisely because the list was only
    // ever read by a human.
    const externals = configuredExternals();

    expect(
      externals.length,
      'no externals found — is the config shape still an array?',
    ).toBeGreaterThan(0);
    expect(
      deadExternals(externals, declaredDependencies),
      'tsup externalizes a package the manifest does not declare. That is how ' +
        '`cosmiconfig` and `cli-table3` outlived their own deletion.',
    ).toEqual([]);
  });

  /**
   * The falsification, run on every pass.
   *
   * Each row hands one of the checks above a defect of exactly the class it
   * exists to catch, and asserts it is named. Green assertions prove the
   * inputs are clean; these prove the JUDGEMENT is not vacuous — which is the
   * half this fence's own history says cannot be taken on trust.
   *
   * Synthetic inputs, deliberately: planting a real dead external in
   * `tsup.config.ts` is what failed twice, because the plant has to survive a
   * formatter, a grep and a reviewer, and it survived none of them.
   */
  describe('the checks can see a defect', () => {
    // A package name no manifest will ever declare, so the assertions cannot
    // be quietly satisfied by something that happens to exist.
    const IMPOSSIBLE = '@shipstatic/definitely-not-a-dependency';

    it('catches an escaped specifier — a built entry requiring what nobody installs', () => {
      // The live half of the defect: `dist/cli.cjs` requiring a package a
      // consumer never installed, so `npx @shipstatic/ship` dies on a cold
      // machine.
      expect(undeclaredSpecifiers([IMPOSSIBLE], declaredDependencies)).toEqual([IMPOSSIBLE]);
      // …and it must still pass a real one, or it would "catch" everything.
      expect(undeclaredSpecifiers(['zod/v4'], ['zod'])).toEqual([]);
    });

    it('catches a dead external — the rot that outlived two majors', () => {
      // `cosmiconfig` and `cli-table3`, by name and by class: externalized in
      // the config, absent from the manifest, invisible at runtime.
      expect(deadExternals(['cosmiconfig', 'cli-table3'], declaredDependencies)).toEqual([
        'cosmiconfig',
        'cli-table3',
      ]);
      expect(deadExternals(declaredDependencies, declaredDependencies)).toEqual([]);
    });

    it('catches an unreached dependency — dead weight every consumer installs', () => {
      expect(unreachedDependencies(['zod/v4'], ['zod', IMPOSSIBLE])).toEqual([IMPOSSIBLE]);
      expect(unreachedDependencies(['zod/v4'], ['zod'])).toEqual([]);
    });

    it('reads a real specifier list out of real bytes, so the readers are not vacuous either', () => {
      // The checks are only as good as what feeds them. `dist/cli.cjs` is
      // asserted empty two tests up — an extractor that always returned `[]`
      // would satisfy that and every direction below it — so the proof that
      // the extractor SEES anything has to come from an entry that legitimately
      // requires something.
      expect(externalSpecifiers('index.js').length).toBeGreaterThan(0);
      expect(configuredExternals()).toContain('zod');
    });
  });
});
