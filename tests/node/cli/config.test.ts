/**
 * @file Subject: `src/node/cli/config.ts` — the `ship config` wizard, the only
 * WRITER of the file `shiprc.ts` is the only reader of.
 *
 * IN-PROCESS: a subprocess is invisible to V8 coverage, and a file that only
 * spawns a binary reaches no production code, which the integrity fence
 * rejects. The one seam is `node:readline/promises`, mocked to a scripted
 * answer — a recorded exception to the "no internal module mocks" canon,
 * because stdin is the one collaborator a test cannot supply for real.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorType } from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runConfig } from '../../../src/node/cli/config';
import { loadShipFile } from '../../../src/node/cli/shiprc';
import { runProgram } from './harness';

const TEST_TOKEN = `ship-${'a'.repeat(64)}`;
const ALT_TOKEN = `ship-${'b'.repeat(64)}`;

/** The scripted answer the mocked prompt returns. */
let answer = '';

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: async () => answer,
    close: () => {},
  }),
}));

let home: string;
let configPath: string;
let out: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-config-'));
  configPath = join(home, '.shiprc');
  vi.stubEnv('HOME', home);
  answer = '';
  out = [];
  vi.spyOn(console, 'log').mockImplementation((m) => out.push(String(m ?? '')));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('--json is refused: this command has one personality', () => {
  // `--json` is a RENDERING channel on every other command. Here it used to
  // change what the command DID — skip the prompt, print a
  // `{path, exists, token(masked), apiUrl}` status report — which is a second
  // command wearing the first one's name.
  //
  // The report went rather than grew: it had no known consumer, and after the
  // project-config search was deleted there is exactly one ambient file plus
  // `--config`, so "which file am I even reading?" mostly stopped being a
  // question. The interactive prompt already shows the masked existing token,
  // which is the part anyone actually wanted.
  it('rejects --json through the CLI, naming what to do instead', async () => {
    const result = await runProgram(['config', '--json']);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error).toBe(ErrorType.Validation);
    expect(parsed.message).toContain('interactive');
  });

  it('leaves any existing config untouched when it refuses', async () => {
    const before = JSON.stringify({ token: TEST_TOKEN });
    writeFileSync(configPath, before);

    await runProgram(['config', '--json']);

    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });
});

describe('interactive flow', () => {
  it('writes the token the user typed', async () => {
    answer = TEST_TOKEN;

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(TEST_TOKEN);
    expect(out.join('\n')).toContain('saved to');
  });

  it('keeps the existing token when the user presses Enter', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    answer = '';

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(TEST_TOKEN);
  });

  it('replaces the existing token with new input', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    answer = ALT_TOKEN;

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(ALT_TOKEN);
  });

  it('preserves every other field the schema permits', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ token: TEST_TOKEN, apiUrl: 'https://custom.example.com' }),
    );
    answer = ALT_TOKEN;

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({
      token: ALT_TOKEN,
      apiUrl: 'https://custom.example.com',
    });
  });

  it('creates an empty config when there is nothing to keep', async () => {
    answer = '';

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({});
  });

  it('writes the credential file owner-only (0600)', async () => {
    answer = TEST_TOKEN;

    await runConfig({ noColor: true });

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('repairs permissions on a pre-existing world-readable config', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }), { mode: 0o644 });
    answer = '';

    await runConfig({ noColor: true });

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('rejects a malformed prefixed token instead of saving it', async () => {
    // Prefixed tokens carry format guarantees — a truncated paste fails here
    // rather than as a confusing 401 later.
    answer = 'ship-short';

    await expect(runConfig({ noColor: true })).rejects.toThrow(/ship-/);
    expect(existsSync(configPath)).toBe(false);
  });

  it('accepts an opaque bearer, whose validity is the server to judge', async () => {
    answer = 'an-opaque-oauth-access-token';

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(
      'an-opaque-oauth-access-token',
    );
  });
});

describe('a file it cannot read is a file it must not replace', () => {
  // The destructive case, and the reason `readExistingConfig` throws. A
  // malformed `.shiprc` makes every command fail with "Invalid config in …",
  // whose obvious remedy is to run `ship config` — which read the file as
  // `{}`, wrote `{}` back, and said `saved to …`. The recovery path destroyed
  // the credential it was run to repair.
  it.each([
    ['unparseable content', '{'],
    ['broken indentation', 'a: b\n  c: d'],
    ['a bare scalar', 'not a mapping at all'],
    ['a list', '["token"]'],
  ])('refuses %s and leaves the file byte-identical', async (_name, contents) => {
    writeFileSync(configPath, contents);
    answer = TEST_TOKEN;

    // Asserted on the WRITER's own guarantee rather than either wording:
    // unparseable content and a parsed non-mapping fail differently ("Failed
    // to read ship config …" vs "Invalid config in …: expected a mapping"),
    // and both are the reader's sentences. The clause this command adds is the
    // one fact only it can state.
    await expect(runConfig({ noColor: true })).rejects.toThrow(/the file was left unchanged/);
    expect(readFileSync(configPath, 'utf-8')).toBe(contents);
    expect(out.join('\n')).not.toContain('saved to');
  });
});

describe('one parse, two policies', () => {
  // The FORMAT question — "is this a config file at all?" — must get one
  // answer. The writer used a bare `JSON.parse` until review caught it, which
  // fixed the schema layer and left this one split: a YAML-style `token: …`,
  // and far more commonly an EMPTY file (`touch ~/.shiprc`, or an interrupted
  // write), loaded fine on every read path and came back "Invalid config in …"
  // from the one command whose job is to fix it.
  //
  // Asserted as AGREEMENT rather than per side, because the claim is about the
  // pair. Only format cases belong here: at the SCHEMA layer the two diverge
  // on purpose — the writer accepts `{apiKey}` precisely so it can repair what
  // the reader rejects, which the block below covers.
  const accepts = (run: () => unknown): boolean => {
    try {
      run();
      return true;
    } catch {
      return false;
    }
  };

  // The `expected` column moved in 2.0.0 when `.shiprc` became strict JSON —
  // and the fence needed no other change, because it asserts AGREEMENT rather
  // than each side against a hand-written expectation of the other. A format
  // change that moves both sides together is green by construction. That is
  // the fence working, not the fence being weak.
  it.each([
    ['JSON, as the wizard writes it', '{"token": "ship-x"}', true],
    ['an empty file', '', true],
    ['whitespace only', '\n   \n', true],
    ['YAML, once accepted by accident', 'token: ship-x', false],
    ['a trailing comma', '{"token": "ship-x",}', false],
    ['a comment', '# nothing here\n', false],
    ['unparseable content', '{', false],
    ['a bare scalar', 'not a mapping at all', false],
    ['a list', '["token"]', false],
  ])('%s', async (_name, contents, expected) => {
    writeFileSync(configPath, contents);

    const readerAccepts = accepts(() => loadShipFile(configPath));

    answer = TEST_TOKEN;
    const writerAccepts = await runConfig({ noColor: true }).then(
      () => true,
      () => false,
    );

    expect(writerAccepts, 'writer and reader must agree').toBe(readerAccepts);
    expect(readerAccepts).toBe(expected);
  });
});

describe('the schema is the file', () => {
  it('drops a retired key, which is what makes the rename hint true', async () => {
    // The loader answers a legacy file with `"apiKey" is no longer supported —
    // the key is now "token". Run \`ship config\` to rewrite it`. Doing so used
    // to write `token` and KEEP `apiKey`, so the next command failed with the
    // identical error: the advice was a loop. See the round trip below.
    writeFileSync(
      configPath,
      JSON.stringify({ apiKey: 'legacy-value', apiUrl: 'https://custom.example.com' }),
    );
    answer = TEST_TOKEN;

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({
      apiUrl: 'https://custom.example.com',
      token: TEST_TOKEN,
    });
  });

  it('says which keys it dropped rather than removing them quietly', async () => {
    writeFileSync(configPath, JSON.stringify({ apiKey: 'legacy', nonsense: 1 }));
    answer = TEST_TOKEN;

    await runConfig({ noColor: true });

    expect(out.join('\n')).toContain('dropped "apiKey", "nonsense"');
  });

  it.each([
    ['a legacy apiKey', { apiKey: 'legacy-value' }],
    ['a legacy deployToken', { deployToken: 'deploy-legacy' }],
    ['an unknown key', { token: TEST_TOKEN, typo: true }],
    ['a lowercase typo', { apikey: 'oops' }],
  ])('round trip: what this command writes, the loader reads (%s)', async (_name, startingFile) => {
    // THE fence for "one file, two commands, one idea of what it is". The
    // writer and the reader disagreed in both directions, so the tie has to
    // be asserted end to end rather than per side: run the wizard, then hand
    // the result to the real loader.
    writeFileSync(configPath, JSON.stringify(startingFile));
    answer = TEST_TOKEN;

    await runConfig({ noColor: true });

    expect(loadShipFile(configPath)).toEqual({ token: TEST_TOKEN });
  });
});

describe('--config names the file to write, as it names the file to read', () => {
  it('writes the named file and leaves the default alone', async () => {
    const explicit = join(home, 'dev.shiprc');
    answer = TEST_TOKEN;

    await runConfig({ noColor: true, configFile: explicit });

    expect(JSON.parse(readFileSync(explicit, 'utf-8')).token).toBe(TEST_TOKEN);
    expect(existsSync(configPath)).toBe(false);
    expect(out.join('\n')).toContain(explicit);
  });

  it('round trips through the loader under a non-default name', async () => {
    // `dev.shiprc` is the spelling the loader gained on 2026-07-30; a file the
    // CLI can read but not write would be half a feature.
    const explicit = join(home, 'dev.shiprc');
    answer = TEST_TOKEN;

    await runConfig({ noColor: true, configFile: explicit });

    expect(loadShipFile(explicit)).toEqual({ token: TEST_TOKEN });
  });
});
