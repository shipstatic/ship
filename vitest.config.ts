import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Three projects, one config.
 *
 *   unit         Pure functions. No mock server, no I/O.  (`*.unit.test.ts`)
 *   integration  The SDK and CLI against the mock server. (`*.test.ts`)
 *   e2e          A REAL API.                              (`*.e2e.test.ts`)
 *
 * `pnpm test` selects unit + integration only — see the `test` script. The e2e
 * project is opt-in through `test:e2e` AND a credential gate in
 * `tests/setup-e2e.ts`, because those tests create real resources.
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
        // Ratcheted 2026-07-30 (94/88/96/95 → 95/89/97/96) against a measured
        // 95.71/89.02/97.72/96.56, after the config-writer and shape-router
        // work brought their own tests. A ratchet that is not raised when
        // coverage rises is just a floor the gains can erode back through.
        statements: 95,
        branches: 89,
        functions: 97,
        lines: 96,
        // The TTY-only spinner and the SIGINT handler are unreachable
        // in-process by design — the smoke tier proves them through the real
        // binary. (The bin execution block used to be here too; it moved to
        // `bin.ts` on 2026-07-29, which is why this floor rose.)
        'src/node/cli/index.ts': { statements: 89, branches: 76 },
        // `bin.ts` is the process ENTRY POINT: it runs on import, so it cannot
        // execute in-process at all and reads 0%. Recorded rather than
        // excluded — a zero that is explained is worth more than a file
        // quietly missing from the report. The smoke tier runs it for real.
        'src/node/cli/bin.ts': { statements: 0, branches: 0, functions: 0, lines: 0 },
        // Browser/unknown-runtime detection arms cannot execute in a Node
        // process; the browser tier certifies that side.
        'src/shared/lib/env.ts': { statements: 70, branches: 54 },
        // The config-file error fallthrough — tiny module, v4 counts 4
        // statements total, so one uncovered arm halves the number.
        'src/node/cli/create-client.ts': { statements: 50 },
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
