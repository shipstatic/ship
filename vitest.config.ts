import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Four projects, one config.
 *
 *   unit         Pure functions. No mock server, no I/O.  (`*.unit.test.ts`)
 *   integration  The SDK and CLI against the mock server. (`*.test.ts`)
 *   e2e          A REAL API.                              (`*.e2e.test.ts`)
 *   browser      Real Chromium.                           (`tests-browser/**`)
 *
 * `pnpm test` selects unit + integration only — see the `test` script. The e2e
 * project is opt-in through `test:e2e` AND a credential gate in
 * `tests/setup-e2e.ts`, because those tests create real resources. The browser
 * project is opt-in through `test:browser` and runs as its own CI step.
 *
 * Two of the four are therefore invisible to `pnpm test`, which makes
 * `pnpm typecheck` the only local gate that sees them at all — hence
 * `tsconfig.check.json` covering `tests/**` AND `tests-browser/**`. Read that
 * file's header before narrowing either.
 *
 * `tests/setup.ts` (hermeticity: credential scrub + no-network guard) loads for
 * unit and integration alike; `tests/setup-server.ts` (mock-server lifecycle)
 * loads only where a server is wanted.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Mock hygiene as explicit config rather than per-file boilerplate: call
    // history clears before every test (an assertion can never pass on a
    // previous test's calls), and `vi.stubGlobal` — the one sanctioned way to
    // replace a global like `fetch` — is undone after every test.
    clearMocks: true,
    unstubGlobals: true,
    // Console policy lives HERE, not in per-file mute spies: passing tests stay
    // quiet, failing tests print everything they logged. Spies a test ASSERTS
    // on are still created locally.
    silent: 'passed-only',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Scoped to shipped code. Unscoped, coverage measured `examples/`,
      // `scripts/` and `build-shims/` at 0% and reported a fictional 36%.
      include: ['src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/*.d.ts'],
      /**
       * A ratchet, set ~1 point BELOW the 2026-07-27 measurement
       * (94.40 / 88.06 / 95.27 / 94.83, after the `buildProgram()` refactor
       * put the CLI entry in-process). These only ever go up.
       *
       * Not blanket `perFile`: three files sit below the global bar for
       * reasons named on their per-glob entries below, so each carries its
       * OWN ratchet instead — nothing may decay, including them.
       *
       * NOTE: thresholds catch coverage DECAY. They cannot catch a test that
       * asserts nothing — a tautology neither raises nor lowers coverage. That
       * class is fenced by tests/architecture/test-integrity.test.ts.
       */
      thresholds: {
        // A ratchet that is not raised when coverage rises is just a floor the
        // gains can erode back through — so these move up with the suite.
        //
        // BRANCHES is the one exception, and it moved DOWN (89 → 88) as a
        // recorded decision rather than a silent lower. The 2.0.0 deletions
        // (project-config search, `config --json`, the shape router) removed
        // **22 branches, all 22 of them covered and none uncovered**: the
        // absolute uncovered count is unchanged at 103, and the ratio fell only
        // because the denominator shrank. Statements, functions and lines all
        // ROSE across the same change (95.71→96.00, 97.72→98.02, 96.56→96.82),
        // which is the corroboration. Deleting well-tested code is supposed to
        // look like this; a floor that punishes it is measuring the wrong
        // thing.
        // Raised 2026-08-12 with the endpoint fold: 96.09/89.70/97.98/96.78 →
        // 96.33/89.92/98.12/96.92. Branches moved because that is where the
        // headroom was; the other three keep the ~1-point slack this file has
        // always carried, and a ratchet tightened past its own margin is a
        // flake generator rather than a fence.
        statements: 95,
        branches: 89,
        functions: 97,
        lines: 96,
        // The TTY-only spinner and the SIGINT handler are unreachable
        // in-process by design — the smoke tier proves them through the real
        // binary. (The bin execution block used to be here too; it moved to
        // `bin.ts` on 2026-07-29, which is why this floor rose.) Raised again
        // 2026-08-12 with the flag law: 91.9/79.7 → 93.3/80.3, and a ratchet
        // that is not raised when coverage rises is just a floor the gains can
        // erode back through. The ~2-point slack is the margin this file has
        // always carried.
        'src/node/cli/index.ts': { statements: 91, branches: 78 },
        // `bin.ts` is the process ENTRY POINT: it runs on import, so it cannot
        // execute in-process at all and reads 0%. Recorded rather than
        // excluded — a zero that is explained is worth more than a file
        // quietly missing from the report. The smoke tier runs it for real.
        'src/node/cli/bin.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
        // Browser/unknown-runtime detection arms cannot execute in a Node
        // process; the browser tier certifies that side.
        'src/shared/lib/env.ts': { statements: 70, branches: 54 },
        // The config-file error fallthrough. This floor was 50 because the
        // module held four statements and one uncovered arm halved the number;
        // `resolveCliToken` moved in beside `createClient` on 2026-08-12 —
        // a second reader of the credential chain belongs in the file that owns
        // it — and the module now measures 100/90.9/100/100.
        'src/node/cli/create-client.ts': { statements: 90 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.unit.test.ts'],
          setupFiles: ['tests/setup.ts'],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.unit.test.ts', 'tests/**/*.e2e.test.ts'],
          setupFiles: ['tests/setup.ts', 'tests/setup-server.ts'],
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/**/*.e2e.test.ts'],
          setupFiles: ['tests/setup-e2e.ts'],
          testTimeout: 60000,
        },
      },
      {
        // Capability tier (the analog of the backend's tests-workerd): a
        // small suite certifying REAL browser semantics — File, FormData,
        // webkitRelativePath, spark-md5 — that jsdom can only approximate.
        // Runs via `pnpm test:browser`, never in the default invocation; no
        // coverage coupling. See tests-browser/README-worthy headers.
        extends: true,
        test: {
          name: 'browser',
          include: ['tests-browser/**/*.test.ts'],
          setupFiles: [],
          testTimeout: 30000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
