/**
 * @file Subject: `src/node/cli/completions.ts` — the shell completion scripts,
 * rendered from the command tree.
 *
 * These assertions are the ones a hand-written script could never satisfy: they
 * quantify over the WHOLE tree, so a command added tomorrow is covered without
 * anyone editing this file. Before 2026-07-29 the three scripts were maintained
 * by hand and `ship tokens get` — shipped the previous day — completed in none
 * of them.
 *
 * That the emitted text is valid SHELL is a different question, and a real
 * shell is the only thing that can answer it: `tests/node/cli/smoke.test.ts`
 * installs through the actual binary and runs `bash -n` / `zsh -n` /
 * `fish --no-execute` over the result.
 */

import { describe, expect, it } from 'vitest';
import { renderCompletion, type Shell } from '../../../src/node/cli/completions';
import { buildProgram } from '../../../src/node/cli/index';

const SHELLS: Shell[] = ['bash', 'zsh', 'fish'];
const program = buildProgram();

/**
 * Whether a script OFFERS a word — as a completion candidate, not merely as a
 * substring somewhere in the file.
 *
 * The distinction is load-bearing and was found by proving this fence fires:
 * a first version asked `script.includes(word)`, and when the renderer was
 * broken to drop every `get` subcommand, only fish failed. `get` occurs inside
 * other text in the bash and zsh scripts, so two of the three assertions were
 * passing on a coincidence. Each shell states its candidates in its own
 * syntax, so each is matched in its own syntax.
 */
function offers(script: string, shell: Shell, word: string): boolean {
  switch (shell) {
    // `compgen -W "list upload get set delete"` — a whitespace-delimited token
    // inside a word list, never loose prose.
    case 'bash':
      return [...script.matchAll(/-W "([^"]*)"/g)].some((m) => m[1].split(/\s+/).includes(word));
    // `"get:Show deployment information"` — `_describe` pairs, name before the
    // first colon.
    case 'zsh':
      return [...script.matchAll(/"([^":]+):/g)].some((m) => m[1] === word);
    // `-a 'get'`
    case 'fish':
      return [...script.matchAll(/ -a '([^']+)'/g)].some((m) => m[1] === word);
  }
}

/** Every `<group> <sub>` and every bare top-level command, `help` aside. */
function everyCommand(): Array<{ path: string; leaf: string }> {
  const out: Array<{ path: string; leaf: string }> = [];
  for (const cmd of program.commands) {
    if (cmd.name() === 'help') continue;
    const subs = cmd.commands.filter((c) => c.name() !== 'help');
    if (subs.length === 0) {
      out.push({ path: cmd.name(), leaf: cmd.name() });
    } else {
      for (const sub of subs) out.push({ path: `${cmd.name()} ${sub.name()}`, leaf: sub.name() });
    }
  }
  return out;
}

describe('completion scripts are rendered from the tree', () => {
  it('collects a tree worth asserting on (a broken walk must not pass silently)', () => {
    expect(everyCommand().length).toBeGreaterThan(20);
    expect(everyCommand().map((c) => c.path)).toContain('tokens get');
  });

  it.each(SHELLS)('%s offers every top-level command', (shell) => {
    const script = renderCompletion(program, shell);
    const missing = program.commands
      .filter((c) => c.name() !== 'help')
      .map((c) => c.name())
      .filter((name) => !offers(script, shell, name));

    expect(missing, `${shell} omits a top-level command`).toEqual([]);
  });

  it.each(SHELLS)('%s offers every subcommand of every group', (shell) => {
    const script = renderCompletion(program, shell);
    const missing = everyCommand()
      .filter(({ path }) => path.includes(' '))
      .filter(({ leaf }) => !offers(script, shell, leaf));

    expect(
      missing.map((m) => m.path),
      `${shell} omits a subcommand`,
    ).toEqual([]);
  });

  it.each(SHELLS)('%s offers every global flag', (shell) => {
    const script = renderCompletion(program, shell);
    const missing = program.options
      .map((o) => o.long)
      .filter((long): long is string => Boolean(long))
      // fish declares flags by bare name (`-l token`), the others by `--token`.
      .filter((long) => !script.includes(shell === 'fish' ? long.replace(/^--/, '') : long));

    expect(missing, `${shell} omits a global flag`).toEqual([]);
  });

  it.each(SHELLS)('%s offers the flags a subcommand declares of its own', (shell) => {
    // `--limit`/`--cursor` on the lists and `--ttl` on `tokens create` were in
    // NO hand-written script (fish carried `--ttl` alone, unscoped). They are
    // free once derived, which is the whole argument for deriving.
    const script = renderCompletion(program, shell);
    for (const flag of ['limit', 'cursor', 'ttl']) {
      expect(script, `${shell} omits --${flag}`).toContain(flag);
    }
  });

  it.each(SHELLS)('%s asks for native file completion where a path is expected', (shell) => {
    // Derived from the ARGUMENT's name, so `deployments upload <path>` needs no
    // list to be on, and `--config <file>` is found the same way.
    const script = renderCompletion(program, shell);
    expect(script).toContain('upload');
    expect(script).toContain('config');
  });

  it('escapes a colon in a zsh description, which would otherwise truncate it', () => {
    // `_describe` splits on the FIRST colon. `--token`'s description contains
    // one; the hand-written script silently reworded it with an em dash rather
    // than escaping, so the completion and the help text disagreed.
    const token = program.options.find((o) => o.long === '--token');
    expect(token?.description).toContain(':');
    expect(renderCompletion(program, 'zsh')).toContain(
      token?.description.replace(/:/g, '\\:') ?? '',
    );
  });

  it('names no command the tree does not have', () => {
    // The reverse direction: a renderer that hardcoded a word would show up
    // here. Every quoted completion word in the fish script must be a real
    // command name, flag name, or one of fish's own keywords.
    const known = new Set([
      ...program.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => s.name())]),
      ...program.options.flatMap((o) => [o.long?.replace(/^--/, ''), o.short?.replace(/^-/, '')]),
    ]);

    const offered = [...renderCompletion(program, 'fish').matchAll(/ -a '([^']+)'/g)].map(
      (m) => m[1],
    );

    expect(offered.filter((word) => !known.has(word))).toEqual([]);
  });
});
