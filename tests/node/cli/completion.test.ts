/**
 * @file Subject: `src/node/cli/completion.ts` — shell completion install /
 * uninstall.
 *
 * IN-PROCESS. These ran as child processes until 2026-07-27, which meant V8
 * could not see them and the module read 0% covered while being, in fact,
 * thoroughly tested. Both halves of that are worth fixing: the coverage number
 * was lying, and the integrity fence requires a test file to reach production
 * code — a file that only spawns a binary reaches none.
 *
 * `installCompletion` takes its script directory as an argument and resolves
 * the target from `os.homedir()`, which on POSIX is `$HOME`. So a stubbed
 * `HOME` plus a stubbed `SHELL` is the entire harness — no subprocess, and no
 * possibility of touching the developer's real dotfiles.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCompletion, uninstallCompletion } from '../../../src/node/cli/completion';

/** The real completion scripts, as shipped in `dist/completions`. */
const SCRIPT_DIR = resolve(__dirname, '../../../src/node/completions');

let home: string;
let out: string[];
let err: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-completion-'));
  vi.stubEnv('HOME', home);
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((m) => out.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m) => err.push(String(m)));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const useShell = (shell: string) => vi.stubEnv('SHELL', shell);
const stdout = () => out.join('\n');
const stderr = () => err.join('\n');

describe('installCompletion', () => {
  it('installs the zsh script and sources it from a fresh .zshrc', () => {
    useShell('/bin/zsh');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(existsSync(join(home, '.ship_completion.zsh'))).toBe(true);
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe(
      `# ship\nsource '${join(home, '.ship_completion.zsh')}'\n# ship end\n`,
    );
    expect(stdout()).toContain('completion script installed for zsh');
  });

  it('copies the real script contents, not a placeholder', () => {
    useShell('/bin/zsh');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(readFileSync(join(home, '.ship_completion.zsh'), 'utf-8')).toBe(
      readFileSync(join(SCRIPT_DIR, 'ship.zsh'), 'utf-8'),
    );
  });

  it('appends to an existing profile without clobbering it', () => {
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim\n');

    installCompletion(SCRIPT_DIR, { noColor: true });

    const profile = readFileSync(join(home, '.zshrc'), 'utf-8');
    expect(profile.startsWith('export EDITOR=vim\n')).toBe(true);
    expect(profile).toContain('# ship end');
  });

  it('is idempotent — a second install does not duplicate the block', () => {
    useShell('/bin/zsh');
    installCompletion(SCRIPT_DIR, { noColor: true });
    const afterFirst = readFileSync(join(home, '.zshrc'), 'utf-8');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe(afterFirst);
  });

  it('installs for bash into .bash_profile', () => {
    useShell('/bin/bash');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(existsSync(join(home, '.ship_completion.bash'))).toBe(true);
    expect(readFileSync(join(home, '.bash_profile'), 'utf-8')).toContain('# ship end');
    expect(stdout()).toContain('completion script installed for bash');
  });

  it('installs for fish into the completions directory, touching no profile', () => {
    useShell('/usr/local/bin/fish');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(existsSync(join(home, '.config/fish/completions/ship.fish'))).toBe(true);
    expect(existsSync(join(home, '.bash_profile'))).toBe(false);
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
    expect(stdout()).toContain('fish completion installed successfully');
  });

  it('rejects an unsupported shell by name', () => {
    useShell('/bin/csh');

    installCompletion(SCRIPT_DIR, { noColor: true });

    expect(stderr()).toContain('unsupported shell: /bin/csh');
    expect(stderr()).toContain('bash, zsh, fish');
  });

  it('reports a missing source script instead of throwing', () => {
    useShell('/bin/zsh');

    installCompletion('/nonexistent/script/dir', { noColor: true });

    expect(stderr()).toContain('could not install completion script');
  });

  it('emits JSON when asked', () => {
    useShell('/bin/zsh');

    installCompletion(SCRIPT_DIR, { json: true });

    expect(JSON.parse(out[0])).toEqual({ success: 'completion script installed for zsh' });
  });
});

describe('uninstallCompletion', () => {
  // Regression: install used to append a block that was not newline-terminated,
  // so uninstall's split/join round trip swallowed the profile's own trailing
  // newline. A dotfile editor that silently reshapes the file it edits is a
  // correctness bug, so these assert byte equality rather than "close enough".
  it.each([
    ['a trailing newline', 'export EDITOR=vim\n'],
    ['blank lines around content', '\n\nexport EDITOR=vim\n\n'],
    ['several entries', 'export EDITOR=vim\nalias ll="ls -la"\n'],
  ])('install → uninstall restores a profile with %s byte-for-byte', (_name, original) => {
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), original);
    installCompletion(SCRIPT_DIR, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(existsSync(join(home, '.ship_completion.zsh'))).toBe(false);
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe(original);
    expect(stdout()).toContain('completion script uninstalled for zsh');
  });

  it('normalizes a profile that lacked a trailing newline, and nothing else', () => {
    // Install separates its block with a newline when the file does not end in
    // one. Uninstall cannot tell that newline from a user's, so the file keeps
    // it — POSIX text-file convention, and the only difference the round trip
    // may ever introduce.
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim');
    installCompletion(SCRIPT_DIR, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('export EDITOR=vim\n');
  });

  it('leaves an empty profile behind when it created the profile itself', () => {
    useShell('/bin/zsh');
    installCompletion(SCRIPT_DIR, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('');
  });

  it('reports a missing profile instead of creating one', () => {
    useShell('/bin/zsh');

    uninstallCompletion({ noColor: true });

    expect(stderr()).toContain('profile file not found');
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
  });

  it('reports an untouched profile and leaves it alone', () => {
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim\n');

    uninstallCompletion({ noColor: true });

    expect(stderr()).toContain('completion was not found in profile');
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('export EDITOR=vim\n');
  });

  it('removes the fish script', () => {
    useShell('/usr/local/bin/fish');
    installCompletion(SCRIPT_DIR, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(existsSync(join(home, '.config/fish/completions/ship.fish'))).toBe(false);
    expect(stdout()).toContain('fish completion uninstalled successfully');
  });

  it('warns when fish completion was never installed', () => {
    useShell('/usr/local/bin/fish');

    uninstallCompletion({ noColor: true });

    expect(stdout()).toContain('fish completion was not installed');
  });

  it('rejects an unsupported shell by name', () => {
    useShell('/bin/csh');

    uninstallCompletion({ noColor: true });

    expect(stderr()).toContain('unsupported shell: /bin/csh');
  });
});
