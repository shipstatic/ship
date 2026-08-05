/**
 * @file Shell completion scripts, RENDERED FROM the command tree.
 *
 * Three hand-written scripts (`src/node/completions/ship.{bash,zsh,fish}`)
 * lived here until 2026-07-29 and were the third, fourth and fifth statement of
 * a command tree `buildProgram()` already held. They were provably stale: `ship
 * tokens get` shipped on 2026-07-28 and completed in **zero** shells, `--limit`
 * and `--cursor` were absent from all three, `--ttl` from two, and several
 * descriptions had drifted word for word from the ones Commander carries.
 *
 * None of that is a bug to fix — it is a bug class to remove. Everything those
 * files said is derivable: names and descriptions from `Command`, flags from
 * `program.options`, and the file-completion positions from which arguments are
 * named `path`/`file`/`dir`. So they are derived, and `ship completion install`
 * writes the script it renders at that moment, which means an installed
 * completion always matches the binary that installed it — something a copied
 * file could never promise.
 *
 * The generated scripts are deliberately SIMPLER than the ones they replace:
 * the old files carried per-subcommand `case` arms whose only effect was to
 * return no completions, which is already the fallthrough.
 */
import type { Command } from 'commander';

export type Shell = 'bash' | 'zsh' | 'fish';

/**
 * The subcommands of `cmd` that a user browses — Commander's own `help` is
 * machinery, not one of them.
 *
 * Exported because the completion scripts are not the only thing that must
 * name a group's subcommands: `handleUnknownSubcommand` in `index.ts` prints
 * the same list as a usage line. Both now read it from the tree, which is the
 * whole point — the hand-written array that used to back the usage line had
 * already drifted (`ship tokens <list|create|delete>` omitted `get`) while the
 * derived completion beside it was correct.
 */
export const subcommandsOf = (cmd: Command): Command[] =>
  cmd.commands.filter((c) => c.name() !== 'help');

/** A group is a command that exists to hold others. */
const groupsOf = (program: Command): Command[] =>
  subcommandsOf(program).filter((c) => subcommandsOf(c).length > 0);

/**
 * Whether a command takes a filesystem argument, and therefore wants native
 * file completion after its name. Read from the ARGUMENT's name, so
 * `deployments upload <path>` needs no list to be on.
 */
const takesPath = (cmd: Command): boolean =>
  cmd.registeredArguments.some((arg) => /^(path|file|dir)/i.test(arg.name()));

/** Options that accept a filesystem value — `--config <file>`. */
const pathOptions = (program: Command): string[] =>
  program.options.filter((o) => /<(file|path|dir)\w*>/i.test(o.flags)).map((o) => o.long ?? '');

/**
 * Flags a specific subcommand declares of its own — `--limit`/`--cursor` on the
 * lists, `--ttl` on `tokens create`. The hand-written scripts offered NONE of
 * these (fish offered `--ttl` alone, unconditionally), because keeping a
 * per-command flag matrix accurate by hand is not worth anyone's afternoon.
 * Generation changes that arithmetic: accuracy is free, so it is taken.
 */
const localFlags = (cmd: Command): Array<{ flag: string; description: string }> =>
  cmd.options.flatMap((o) =>
    [o.long, o.short].filter(Boolean).map((flag) => ({
      flag: flag as string,
      description: o.description,
    })),
  );

/** `<group> <sub>` pairs that declare flags of their own. */
const localFlagPairs = (program: Command): Array<{ path: string; cmd: Command }> =>
  groupsOf(program).flatMap((group) =>
    subcommandsOf(group)
      .filter((sub) => sub.options.length > 0)
      .map((sub) => ({ path: `${group.name()} ${sub.name()}`, cmd: sub })),
  );

/** Every flag the root declares, long and short alike. */
const globalFlags = (program: Command): Array<{ flag: string; description: string }> =>
  program.options.flatMap((o) =>
    [o.long, o.short].filter(Boolean).map((flag) => ({
      flag: flag as string,
      description: o.description,
    })),
  );

/** Names after which native file completion is wanted. */
const fileTriggers = (program: Command): string[] => [
  ...groupsOf(program).flatMap((g) =>
    subcommandsOf(g)
      .filter(takesPath)
      .map((c) => c.name()),
  ),
  ...pathOptions(program),
];

const HEADER = (comment: string) =>
  `${comment} ship shell completion — GENERATED from the command tree.\n` +
  `${comment} Do not edit: rendered by src/node/cli/completions.ts at install time,\n` +
  `${comment} so this file always matches the binary that wrote it.\n`;

// =============================================================================
// BASH
// =============================================================================

function renderBash(program: Command): string {
  const cases = groupsOf(program)
    .map(
      (group) => `    "${group.name()}")
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "${subcommandsOf(group)
          .map((c) => c.name())
          .join(' ')}" -- "\${current_word}") )
        return
      fi
      ;;`,
    )
    .join('\n');

  const triggers = fileTriggers(program)
    .map((name) => `"$prev_word" == "${name}"`)
    .join(' || ');

  return `#!/usr/bin/env bash
${HEADER('#')}
_ship_completions() {
  local current_word="\${COMP_WORDS[COMP_CWORD]}"
  local prev_word="\${COMP_WORDS[COMP_CWORD-1]}"

  # A word that looks like a path gets native file completion immediately.
  if [[ "$current_word" == ~* || "$current_word" == /* || "$current_word" == .* ]]; then
    COMPREPLY=( $(compgen -f -- "\${current_word}") )
    return
  fi

  case "\${COMP_WORDS[1]}" in
${cases}
  esac

  if [[ ${triggers} ]]; then
    COMPREPLY=( $(compgen -f -- "\${current_word}") )
    return
  fi

  if [[ "$current_word" == -* ]]; then
    local local_flags=""
    case "\${COMP_WORDS[1]} \${COMP_WORDS[2]}" in
${localFlagPairs(program)
  .map(
    ({ path, cmd }) =>
      `      "${path}") local_flags="${localFlags(cmd)
        .map((f) => f.flag)
        .join(' ')}" ;;`,
  )
  .join('\n')}
    esac
    COMPREPLY=( $(compgen -W "${globalFlags(program)
      .map((f) => f.flag)
      .join(' ')} \${local_flags}" -- "\${current_word}") )
    return
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${subcommandsOf(program)
      .map((c) => c.name())
      .join(' ')}" -- "\${current_word}") )
    return
  fi

  COMPREPLY=()
}

complete -F _ship_completions ship
`;
}

// =============================================================================
// ZSH
// =============================================================================

/**
 * `_describe` splits each entry on the FIRST colon, so a colon inside a
 * description would truncate it. The hand-written script dodged this by
 * rewriting `--token`'s description with an em dash — a silent divergence from
 * the text Commander actually carries. Escaping keeps the two identical.
 */
const zshDescribe = (name: string, description: string) =>
  `"${name}:${description.replace(/:/g, '\\:').replace(/"/g, '\\"')}"`;

function renderZsh(program: Command): string {
  const cases = groupsOf(program)
    .map(
      (group) => `      "${group.name()}")
        if [[ $CURRENT -eq 3 ]]; then
          completions=(${subcommandsOf(group)
            .map((c) => zshDescribe(c.name(), c.description()))
            .join(' ')})
          _describe '${group.name()} commands' completions
          return
        fi
        ;;`,
    )
    .join('\n');

  const triggers = fileTriggers(program)
    .map((name) => `"$prev_word" == "${name}"`)
    .join(' || ');

  return `#compdef ship
${HEADER('#')}
if [[ -n \${ZSH_VERSION-} ]]; then
  _ship() {
    local -a completions
    local state line

    if [[ -z \${words-} ]]; then
      return 1
    fi

    local current_word="\${words[CURRENT]}"
    local prev_word="\${words[CURRENT-1]}"

    # A word that looks like a path gets native file completion immediately.
    if [[ "$current_word" == \\~* || "$current_word" == \\/* || "$current_word" == \\./* || "$current_word" == \\.\\./* ]]; then
      _files
      return
    fi

    case "\${words[2]}" in
${cases}
    esac

    if [[ ${triggers} ]]; then
      _files
      return
    fi

    if [[ "$current_word" == -* ]]; then
      completions=(${globalFlags(program)
        .map((f) => zshDescribe(f.flag, f.description))
        .join(' ')})
      case "\${words[2]} \${words[3]}" in
${localFlagPairs(program)
  .map(
    ({ path, cmd }) =>
      `        "${path}") completions+=(${localFlags(cmd)
        .map((f) => zshDescribe(f.flag, f.description))
        .join(' ')}) ;;`,
  )
  .join('\n')}
      esac
      _describe 'options' completions
      return
    fi

    if [[ $CURRENT -eq 2 ]]; then
      completions=(${subcommandsOf(program)
        .map((c) => zshDescribe(c.name(), c.description()))
        .join(' ')})
      _describe 'commands' completions
      return
    fi

    return 1
  }

  if (( \${+functions[compdef]} )); then
    compdef _ship ship
  fi
fi
`;
}

// =============================================================================
// FISH
// =============================================================================

const fishQuote = (text: string) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function renderFish(program: Command): string {
  const lines: string[] = [];

  lines.push('# Top-level commands');
  for (const cmd of subcommandsOf(program)) {
    lines.push(
      `complete -c ship -f -n '__fish_use_subcommand' -a '${cmd.name()}' -d '${fishQuote(cmd.description())}'`,
    );
  }

  lines.push('', '# Global options');
  for (const option of program.options) {
    const name = option.long?.replace(/^--/, '');
    if (!name) continue;
    // `-r` requires a file argument, `-x` requires a non-file one, neither for
    // a boolean flag — the three states fish distinguishes.
    const arity = /<(file|path|dir)\w*>/i.test(option.flags)
      ? ' -r'
      : option.required || option.optional
        ? ' -x'
        : '';
    lines.push(`complete -c ship -l ${name} -d '${fishQuote(option.description)}'${arity}`);
  }

  for (const group of groupsOf(program)) {
    lines.push('', `# ${group.name()} subcommands`);
    for (const sub of subcommandsOf(group)) {
      lines.push(
        `complete -c ship -f -n '__fish_seen_subcommand_from ${group.name()}' -a '${sub.name()}' -d '${fishQuote(sub.description())}'`,
      );
    }
  }

  // Flags scoped to the subcommand that declares them — fish expresses the
  // condition natively, so this needs no lookup table.
  for (const { path, cmd } of localFlagPairs(program)) {
    const [group, sub] = path.split(' ');
    lines.push('', `# ${path} options`);
    for (const option of cmd.options) {
      const name = option.long?.replace(/^--/, '');
      if (!name) continue;
      const arity = option.required || option.optional ? ' -x' : '';
      lines.push(
        `complete -c ship -l ${name} -d '${fishQuote(option.description)}'${arity} ` +
          `-n '__fish_seen_subcommand_from ${group}; and __fish_seen_subcommand_from ${sub}'`,
      );
    }
  }

  const triggers = fileTriggers(program);
  lines.push(
    '',
    '# Native file completion where a filesystem argument is expected',
    'function __ship_needs_file',
    '  set -l cmd (commandline -opc)',
    '  if test (count $cmd) -ge 2',
    '    set -l prev $cmd[-1]',
    `    if contains -- "$prev" ${triggers.map((t) => `'${t}'`).join(' ')}`,
    '      return 0',
    '    end',
    '  end',
    '  return 1',
    'end',
    "complete -c ship -F -n '__ship_needs_file'",
  );

  return `${HEADER('#')}\n${lines.join('\n')}\n`;
}

// =============================================================================

/** The completion script for `shell`, rendered from `program`'s own tree. */
export function renderCompletion(program: Command, shell: Shell): string {
  switch (shell) {
    case 'bash':
      return renderBash(program);
    case 'zsh':
      return renderZsh(program);
    case 'fish':
      return renderFish(program);
  }
}
