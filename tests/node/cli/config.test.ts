/**
 * @file Subject: `src/node/cli/config.ts` — the interactive `ship config`
 * wizard that writes `~/.shiprc`.
 *
 * IN-PROCESS, for the same two reasons as `completion.test.ts`: a subprocess is
 * invisible to V8 (this module read 0% covered while being tested), and a file
 * that only spawns a binary reaches no production code, which the integrity
 * fence rejects.
 *
 * Two seams make it drivable. `CONFIG_PATH` is computed from `homedir()` at
 * MODULE LOAD, so each test stubs `HOME` and then imports the module fresh.
 * And the prompt comes from `node:readline/promises`, mocked here to a scripted
 * answer — a recorded exception to the "no internal module mocks" canon,
 * because stdin is the one collaborator a test cannot supply for real.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Fresh import, so `CONFIG_PATH` is recomputed against the stubbed HOME. */
async function loadRunConfig() {
  vi.resetModules();
  return (await import('../../../src/node/cli/config')).runConfig;
}

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

describe('--json mode', () => {
  const readJson = () => JSON.parse(out.join('\n').trim());

  it('reports the path and that no config exists', async () => {
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    const output = readJson();
    expect(output.path).toBe(configPath);
    expect(output.exists).toBe(false);
    expect(output.token).toBeUndefined();
  });

  it('masks the token rather than printing it', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    const output = readJson();
    expect(output.exists).toBe(true);
    expect(output.token).toBe('ship-aaaa...aaaa');
    expect(out.join('\n')).not.toContain(TEST_TOKEN);
  });

  it('masks a short opaque token entirely', async () => {
    writeFileSync(configPath, JSON.stringify({ token: 'short-tok' }));
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    expect(readJson().token).toBe('...');
  });

  it('omits the API URL when it is the default', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    expect(readJson().apiUrl).toBeUndefined();
  });

  it('includes a custom API URL', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ token: TEST_TOKEN, apiUrl: 'https://custom.example.com' }),
    );
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    expect(readJson().apiUrl).toBe('https://custom.example.com');
  });

  it('survives an unreadable config rather than throwing', async () => {
    writeFileSync(configPath, 'not json at all');
    const runConfig = await loadRunConfig();

    await runConfig({ json: true });

    expect(readJson()).toMatchObject({ exists: true });
  });
});

describe('interactive flow', () => {
  it('writes the token the user typed', async () => {
    answer = TEST_TOKEN;
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(TEST_TOKEN);
    expect(out.join('\n')).toContain('saved to');
  });

  it('keeps the existing token when the user presses Enter', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    answer = '';
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(TEST_TOKEN);
  });

  it('replaces the existing token with new input', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }));
    answer = ALT_TOKEN;
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(ALT_TOKEN);
  });

  it('preserves every other field in the file', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ token: TEST_TOKEN, apiUrl: 'https://custom.example.com' }),
    );
    answer = ALT_TOKEN;
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({
      token: ALT_TOKEN,
      apiUrl: 'https://custom.example.com',
    });
  });

  it('creates an empty config when there is nothing to keep', async () => {
    answer = '';
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({});
  });

  it('writes the credential file owner-only (0600)', async () => {
    answer = TEST_TOKEN;
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('repairs permissions on a pre-existing world-readable config', async () => {
    writeFileSync(configPath, JSON.stringify({ token: TEST_TOKEN }), { mode: 0o644 });
    answer = '';
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('rejects a malformed prefixed token instead of saving it', async () => {
    // Prefixed tokens carry format guarantees — a truncated paste fails here
    // rather than as a confusing 401 later.
    answer = 'ship-short';
    const runConfig = await loadRunConfig();

    await expect(runConfig({ noColor: true })).rejects.toThrow(/ship-/);
    expect(existsSync(configPath)).toBe(false);
  });

  it('accepts an opaque bearer, whose validity is the server to judge', async () => {
    answer = 'an-opaque-oauth-access-token';
    const runConfig = await loadRunConfig();

    await runConfig({ noColor: true });

    expect(JSON.parse(readFileSync(configPath, 'utf-8')).token).toBe(
      'an-opaque-oauth-access-token',
    );
  });
});
