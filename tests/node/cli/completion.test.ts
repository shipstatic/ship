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
 * `installCompletion` takes the command TREE and resolves the target from
 * `os.homedir()`, which on POSIX is `$HOME`. So a stubbed `HOME` plus a stubbed
 * `SHELL` is the entire harness — no subprocess, and no possibility of touching
 * the developer's real dotfiles. It took a script DIRECTORY until 2026-07-29,
 * when the three hand-written scripts were replaced by rendering from the tree
 * (`./completions.ts`), so there is no longer a file on disk to copy.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorType, type ShipError } from '@shipstatic/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCompletion, uninstallCompletion } from '../../../src/node/cli/completion';
import { renderCompletion } from '../../../src/node/cli/completions';
import { buildProgram } from '../../../src/node/cli/index';

/** The real command tree — the same one the binary installs from. */
const PROGRAM = buildProgram();

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

/**
 * Run a failing path and return the `ShipError` it threw.
 *
 * These commands report nothing themselves — they throw, and the CLI's one
 * error boundary writes the message and sets the exit code (see the module
 * docblock). Asserting on stderr here would prove the wrong thing: it passed
 * for a year while `ship completion install` exited 0.
 */
function thrownBy(run: () => void): ShipError {
  try {
    run();
  } catch (e) {
    return e as ShipError;
  }
  throw new Error('expected a ShipError, but the call returned normally');
}

describe('installCompletion', () => {
  it('installs the zsh script and sources it from a fresh .zshrc', () => {
    useShell('/bin/zsh');

    installCompletion(PROGRAM, { noColor: true });

    expect(existsSync(join(home, '.ship_completion.zsh'))).toBe(true);
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe(
      `# ship\nsource '${join(home, '.ship_completion.zsh')}'\n# ship end\n`,
    );
    expect(stdout()).toContain('completion script installed for zsh');
  });

  it('writes the script the tree renders, not a placeholder or a stale copy', () => {
    useShell('/bin/zsh');

    installCompletion(PROGRAM, { noColor: true });

    // Byte-equal to what the renderer produces for this very tree — which is
    // the property a shipped file could not have: the three hand-written
    // scripts this replaced had drifted from the tree by a whole command
    // (`ship tokens get` completed in no shell) and four flags.
    expect(readFileSync(join(home, '.ship_completion.zsh'), 'utf-8')).toBe(
      renderCompletion(PROGRAM, 'zsh'),
    );
  });

  it('appends to an existing profile without clobbering it', () => {
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim\n');

    installCompletion(PROGRAM, { noColor: true });

    const profile = readFileSync(join(home, '.zshrc'), 'utf-8');
    expect(profile.startsWith('export EDITOR=vim\n')).toBe(true);
    expect(profile).toContain('# ship end');
  });

  it('is idempotent — a second install does not duplicate the block', () => {
    useShell('/bin/zsh');
    installCompletion(PROGRAM, { noColor: true });
    const afterFirst = readFileSync(join(home, '.zshrc'), 'utf-8');

    installCompletion(PROGRAM, { noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe(afterFirst);
  });

  it('installs for bash into .bash_profile', () => {
    useShell('/bin/bash');

    installCompletion(PROGRAM, { noColor: true });

    expect(existsSync(join(home, '.ship_completion.bash'))).toBe(true);
    expect(readFileSync(join(home, '.bash_profile'), 'utf-8')).toContain('# ship end');
    expect(stdout()).toContain('completion script installed for bash');
  });

  it('installs for fish into the completions directory, touching no profile', () => {
    useShell('/usr/local/bin/fish');

    installCompletion(PROGRAM, { noColor: true });

    expect(existsSync(join(home, '.config/fish/completions/ship.fish'))).toBe(true);
    expect(existsSync(join(home, '.bash_profile'))).toBe(false);
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
    expect(stdout()).toContain('fish completion installed successfully');
  });

  it('rejects an unsupported shell by name', () => {
    useShell('/bin/csh');

    const err = thrownBy(() => installCompletion(PROGRAM, { noColor: true }));

    expect(err.message).toContain('unsupported shell: /bin/csh');
    expect(err.message).toContain('bash, zsh, fish');
    // A statement about the machine's shell setup, not a file operation.
    expect(err.type).toBe(ErrorType.Config);
    // No request was made, so there is no status to report.
    expect(err.status).toBeUndefined();
  });

  it('surfaces an unwritable target as a file fault, not a raw crash', () => {
    // The old shape of this test was "a missing SOURCE script", a failure mode
    // that no longer exists — nothing is copied. The fs fault that remains is
    // the write, and its classification is what the test is really about: an
    // fs call that threw is `File`, and no request means no status.
    useShell('/bin/zsh');
    vi.stubEnv('HOME', '/nonexistent/home/dir');

    const err = thrownBy(() => installCompletion(PROGRAM, { noColor: true }));

    expect(err.message).toContain('could not install completion script');
    expect(err.type).toBe(ErrorType.File);
    expect(err.status).toBeUndefined();
  });

  it('emits JSON when asked', () => {
    useShell('/bin/zsh');

    installCompletion(PROGRAM, { json: true });

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
    installCompletion(PROGRAM, { noColor: true });

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
    installCompletion(PROGRAM, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('export EDITOR=vim\n');
  });

  it('leaves an empty profile behind when it created the profile itself', () => {
    useShell('/bin/zsh');
    installCompletion(PROGRAM, { noColor: true });

    uninstallCompletion({ noColor: true });

    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('');
  });

  it('reports a missing profile instead of creating one', () => {
    useShell('/bin/zsh');

    const err = thrownBy(() => uninstallCompletion({ noColor: true }));

    expect(err.message).toContain('profile file not found');
    expect(err.type).toBe(ErrorType.Config);
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
  });

  it('reports an untouched profile and leaves it alone', () => {
    useShell('/bin/zsh');
    writeFileSync(join(home, '.zshrc'), 'export EDITOR=vim\n');

    const err = thrownBy(() => uninstallCompletion({ noColor: true }));

    expect(err.message).toContain('completion was not found in profile');
    expect(err.type).toBe(ErrorType.Config);
    expect(readFileSync(join(home, '.zshrc'), 'utf-8')).toBe('export EDITOR=vim\n');
  });

  it('removes the fish script', () => {
    useShell('/usr/local/bin/fish');
    installCompletion(PROGRAM, { noColor: true });

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

    const err = thrownBy(() => uninstallCompletion({ noColor: true }));

    expect(err.message).toContain('unsupported shell: /bin/csh');
    expect(err.type).toBe(ErrorType.Config);
  });

  it("never reports a failure itself — that is the boundary's job", () => {
    useShell('/bin/csh');

    thrownBy(() => uninstallCompletion({ noColor: true }));

    expect(stderr()).toBe('');
  });
});
