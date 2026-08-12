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
    const offenders: string[] = [];
    for (const entry of ['index.js', 'index.cjs', 'browser.js']) {
      for (const specifier of externalSpecifiers(entry)) {
        if (!declaredDependencies.includes(packageOf(specifier))) {
          offenders.push(`${entry} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      'A built entry reaches for a package the manifest does not declare, so a ' +
        'consumer install would not have it.',
    ).toEqual([]);
  });

  it('every declared dependency is actually reached by some entry', () => {
    // The third direction, and the one that catches the rot: a dependency
    // nothing imports is a package every consumer installs for nothing.
    const reached = new Set(
      ['index.js', 'index.cjs', 'browser.js', 'cli.cjs'].flatMap(externalSpecifiers).map(packageOf),
    );
    const unreachable = declaredDependencies.filter((dep) => !reached.has(dep));
    expect(
      unreachable,
      'A declared dependency that no built entry requires is dead weight in ' +
        'the contract — bundle it and demote it, or delete it.',
    ).toEqual([]);
  });

  it('every tsup external names a declared dependency', () => {
    // The config half. Read from the real config rather than restated: the two
    // dead entries sat here for two majors precisely because the list was only
    // ever read by a human.
    // `defineConfig` widens to a union that includes non-callable shapes; this
    // config is the function form, which is the thing under test.
    const build = tsupConfig as (o: Options) => Options[];
    const externals = [
      ...new Set(build({}).flatMap((c) => (c.external ?? []) as string[])),
    ] as string[];

    expect(
      externals.length,
      'no externals found — is the config shape still an array?',
    ).toBeGreaterThan(0);
    expect(
      externals.filter((e) => !declaredDependencies.includes(e)),
      'tsup externalizes a package the manifest does not declare. That is how ' +
        '`cosmiconfig` and `cli-table3` outlived their own deletion.',
    ).toEqual([]);
  });
});
