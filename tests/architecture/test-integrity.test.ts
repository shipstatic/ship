import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Suite-wide fence: every test file must reach production code.
 *
 * Why this exists. The 2026-07-27 audit found files that covered ZERO
 * statements of `src/` while looking like tests — `shared/error-testing.test.ts`
 * imported only `@shipstatic/types` and asserted its own local strings against
 * themselves:
 *
 *     const message = 'No files to deploy.';
 *     expect(message).toBe('No files to deploy.');   // asserts a string literal
 *
 * Such a test cannot fail when production is wrong, and it is camouflage: it
 * adds to the test count and the green tick while covering nothing.
 *
 * Coverage thresholds cannot catch this class — a tautology neither raises nor
 * lowers coverage, so a new one slips under any ratchet. The only mechanical
 * signal is whether the file is CONNECTED to the code at all.
 *
 * What this asserts: each test file imports production source at runtime (a
 * relative path into `src/`, statically or via dynamic `import()`). Type-only
 * imports are erased by the compiler and deliberately do NOT count — a file
 * whose only link to `src/` is `import type` reaches exactly as much running
 * code as one with no import at all.
 *
 * `@shipstatic/*` deliberately does not count either. Those are published
 * dependencies from another repo; counting them is what let the original
 * tautologies through.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The ONLY exceptions: artifact tiers, which consume production code in BUILT
 * form rather than by import, and therefore cannot import `src/` by
 * construction. Each is named with that reason. Nothing else may join this
 * list — a file that needs an exception for any other reason is the pathology
 * this fence exists to catch.
 */
const ARTIFACT_TIER_EXCEPTIONS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'tests/node/cli/smoke.test.ts',
    reason:
      'child-process smoke tier — the one file that runs the real built binary (dist/cli.cjs)',
  },
  {
    file: 'tests/package/dist-entries.test.ts',
    reason: 'built-entry smoke — loads the published dist/ bundles the way a consumer does',
  },
];

/** Directories that are not part of the in-process suite. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'fixtures']);

/**
 * Asserts on source as data rather than importing it — what the fences in this
 * directory do. Anchored to a call so the bare word in a comment cannot
 * satisfy it.
 */
const READS_SOURCE_AS_DATA = [/\b(readFileSync|readdirSync)\s*\(/];

/** Imports this package's production code — statically or dynamically. */
const REACHES_SOURCE = [/from\s+['"](?:\.\.\/)+src\//, /import\s*\(\s*['"](?:\.\.\/)+src\//];

/**
 * Whether a module reaches `src/` — directly, or transitively through local
 * test-support modules (`./harness`, `../mocks/server`, …). Transitive
 * resolution is what makes this fence honest in both directions: a test that
 * drives production through a shared harness passes, while a test that
 * imports only fixture builders (which pull in `@shipstatic/types`, never
 * `src/`) fails — asserting on fixtures is asserting on the test's own data.
 */
function reachesSource(absPath: string, seen = new Set<string>()): boolean {
  if (seen.has(absPath)) return false;
  seen.add(absPath);

  let source: string;
  try {
    source = stripTypeOnlyImports(readFileSync(absPath, 'utf8'));
  } catch {
    return false;
  }
  if (REACHES_SOURCE.some((re) => re.test(source))) return true;

  for (const match of source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.includes('.test')) continue;
    const base = join(dirname(absPath), spec);
    for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
      if (candidate.endsWith('.ts') && existsSync(candidate)) {
        if (reachesSource(candidate, seen)) return true;
        break;
      }
    }
  }
  return false;
}

/**
 * Type-only imports are erased at compile time. Strip them before matching, so
 * `import type { Deployment } from '../../src/...'` cannot satisfy the fence.
 */
const stripTypeOnlyImports = (source: string) =>
  source.replace(/\b(?:import|export)\s+type\s[\s\S]*?from\s*['"][^'"]*['"]/g, '');

function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTestFiles(full, acc);
    else if (entry.name.endsWith('.test.ts')) acc.push(full.slice(ROOT.length));
  }
  return acc;
}

describe('test-suite integrity', () => {
  const testFiles = collectTestFiles(join(ROOT, 'tests'));

  it('collects the suite (guards against a broken walk silently passing)', () => {
    expect(testFiles.length).toBeGreaterThan(35);
  });

  it('every test file reaches production code', () => {
    const allowed = new Set(ARTIFACT_TIER_EXCEPTIONS.map((e) => e.file));

    const disconnected = testFiles.filter((rel) => {
      if (allowed.has(rel)) return false;
      const source = stripTypeOnlyImports(readFileSync(join(ROOT, rel), 'utf8'));
      return !reachesSource(join(ROOT, rel)) && !READS_SOURCE_AS_DATA.some((re) => re.test(source));
    });

    expect(
      disconnected,
      'These test files import no production code, so they cannot fail when ' +
        'production is wrong. Point them at the module they claim to test, or ' +
        "delete them — git history is the archive. See this file's header.",
    ).toEqual([]);
  });

  it('every recorded exception still exists and is still an artifact tier', () => {
    // A stale exception is worse than none: it silently exempts a path that no
    // longer holds the file it was written for.
    const missing = ARTIFACT_TIER_EXCEPTIONS.filter((e) => !testFiles.includes(e.file));

    expect(
      missing.map((e) => e.file),
      'Recorded exceptions must name a file that exists.',
    ).toEqual([]);
  });
});
