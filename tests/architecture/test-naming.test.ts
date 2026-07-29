import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Suite-wide fence: the layout law.
 *
 * Every test file belongs to exactly one axis, and the axis decides its path:
 *
 *   1. MIRROR   `tests/<path>/<module>.test.ts` ↔ `src/<path>/<module>.ts`
 *               The filename IS the module name. A module needing more than
 *               one file uses `<module>-<aspect>.test.ts`, and the aspect must
 *               be recorded in `npm/ship/CLAUDE.md` (checked below).
 *
 *   2. FEATURE  cross-module flows with no single subject module. Each one is
 *               named in FEATURE_AXIS with its reason — this axis is a short
 *               recorded list, not a directory anyone can add to.
 *
 *   3. FENCE    `tests/architecture/<invariant>.test.ts` — suite-time
 *               invariants. Assert on structure, not behaviour.
 *
 * Why a fence and not prose: before 2026-07-27 this suite had `tests/integration/`
 * (which mocked the HTTP layer in 8 of 9 files, so nothing integrated),
 * `tests/mixed-core/` (mirroring no src directory), five files re-testing one
 * Vite regression, and filenames like `unknown-commands-comprehensive` and
 * `pure-functions.unit`. Prose did not hold. This does.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Qualifiers that describe the TEST rather than its SUBJECT. A filename should
 * let a reader predict which module it covers; these actively prevent that.
 *
 * `unit` and `e2e` are deliberately ABSENT from this list, unlike the backend's
 * equivalent: here they are structural, not descriptive — `vitest.config.ts`
 * selects the `unit` and `e2e` projects by those exact suffixes, so they carry
 * information a reader needs.
 */
const BANNED_QUALIFIERS = [
  'comprehensive',
  'advanced',
  'basics',
  'basic',
  'simple',
  'elegant',
  'unified',
  'reliability',
  'essential',
  'focused',
  'misc',
  'extra',
  'additional',
  'edge-cases',
  'regression',
  'consistency',
  'final',
  'new',
  'old',
];

/**
 * FEATURE axis — files with no single subject module, each with its reason.
 * Adding to this list is a decision; drifting into it is not possible, because
 * the mirror rule rejects anything not named here.
 */
const FEATURE_AXIS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'tests/node/cli/unknown-commands.test.ts',
    reason:
      "the CLI's error surface for unusable input — a collaboration between " +
      "Commander's parser, handleUnknownSubcommand, and the [error] writer",
  },
  {
    file: 'tests/node/cli/validation.test.ts',
    reason: 'parse-time credential/URL validation, spanning the CLI entry and create-client',
  },
  {
    file: 'tests/node/cli/smoke.test.ts',
    reason:
      'the true-binary smoke tier — help bytes, exit codes, stdin piping, colour, ' +
      'completion fast-path through the real dist/cli.cjs',
  },
  {
    file: 'tests/node/cli/json-errors.test.ts',
    reason:
      'the --json error envelope, asserted across every producer of one — the ' +
      'global boundary, the parser, the preAction validator and ping — because ' +
      "the contract is the CLI's, not any single module's",
  },
  {
    file: 'tests/node/cli/json-acknowledgements.test.ts',
    reason:
      'the --json acknowledgement envelope, asserted across every deletion that ' +
      'produces one — the same contract as its error twin, and likewise the ' +
      "CLI's rather than any single module's",
  },
  {
    file: 'tests/e2e/smoke.e2e.test.ts',
    reason: 'contract-drift detector against a REAL API; opt-in tier',
  },
];

/** `tests/<dir>/` roots that hold no mirrors. */
const NON_MIRROR_DIRS = [
  'tests/architecture',
  'tests/mocks',
  'tests/fixtures',
  // The package tier's subject is the BUILT artifact, not a src module.
  'tests/package',
];

function collect(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, acc);
    else if (entry.name.endsWith('.test.ts')) acc.push(full.slice(ROOT.length));
  }
  return acc;
}

const testFiles = collect(join(ROOT, 'tests'));

/** `tests/node/cli/utils.unit.test.ts` → subject basename `utils`. */
const subjectName = (rel: string) => basename(rel).replace(/\.(unit|e2e)?\.?test\.ts$/, '');

describe('test layout law', () => {
  it('collects the suite (guards against a broken walk silently passing)', () => {
    expect(testFiles.length).toBeGreaterThan(35);
  });

  it('no filename carries a qualifier that describes the test instead of its subject', () => {
    const offenders = testFiles.filter((rel) => {
      const parts = subjectName(rel).split(/[-.]/);
      return BANNED_QUALIFIERS.some((q) =>
        q.includes('-')
          ? subjectName(rel).includes(q)
          : parts.includes(q) || parts.includes(`${q}s`),
      );
    });

    expect(
      offenders,
      'A test filename must name its SUBJECT so a reader can predict which ' +
        `module it covers. Banned qualifiers: ${BANNED_QUALIFIERS.join(', ')}.`,
    ).toEqual([]);
  });

  // One walk classifies every mirror-axis file: unmatched (offender), exact
  // mirror, or aspect split (`<module>-<aspect>` where a shorter prefix matched).
  const mirrorOffenders: string[] = [];
  const aspectSplits: string[] = [];
  const featureFiles = new Set(FEATURE_AXIS.map((f) => f.file));

  for (const rel of testFiles) {
    if (featureFiles.has(rel)) continue;
    if (NON_MIRROR_DIRS.some((d) => rel.startsWith(d))) continue;

    const name = subjectName(rel);
    const srcDir = join(ROOT, dirname(rel).replace(/^tests/, 'src'));

    // Try the longest module prefix first, so `base-ship-credentials`
    // resolves against `base-ship.ts` rather than failing on the full
    // basename.
    const segments = name.split('-');
    let matched = 0;
    for (let take = segments.length; take >= 1; take--) {
      const candidate = segments.slice(0, take).join('-');
      if (
        existsSync(join(srcDir, `${candidate}.ts`)) ||
        existsSync(join(srcDir, candidate, 'index.ts'))
      ) {
        matched = take;
        break;
      }
    }

    if (matched === 0) mirrorOffenders.push(rel);
    else if (matched < segments.length) aspectSplits.push(rel);
  }

  it('every mirror-axis file corresponds to a src module', () => {
    expect(
      mirrorOffenders,
      'A test file must be named <module>.test.ts for a module that exists in ' +
        'the sibling src directory, or be recorded in FEATURE_AXIS with a ' +
        'reason. A test whose subject lives elsewhere belongs elsewhere.',
    ).toEqual([]);
  });

  it('every aspect split is recorded in CLAUDE.md by full basename', () => {
    // The rule "the aspect must be recorded" held by prose alone in the
    // backend until it was made mechanical. Same here: the full basename must
    // appear in the doc, so filename → recorded reason always resolves.
    const doc = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const unrecorded = aspectSplits.filter((rel) => !doc.includes(subjectName(rel)));

    expect(
      unrecorded,
      'An aspect split (<module>-<aspect>.test.ts) must be recorded in ' +
        "CLAUDE.md's aspect-splits table, so the split is a decision rather " +
        'than drift.',
    ).toEqual([]);
  });

  it('every recorded feature-axis file still exists', () => {
    const missing = FEATURE_AXIS.filter((f) => !testFiles.includes(f.file));

    expect(
      missing.map((f) => f.file),
      'Recorded exceptions must name real files.',
    ).toEqual([]);
  });
});
