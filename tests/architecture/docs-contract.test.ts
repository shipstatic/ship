import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../src/node/cli/index';

/**
 * Suite-wide fence: a published doc is a contract, and this reads it against
 * the code it describes.
 *
 * Why this exists. `package.json` ships `README.md` AND `SKILL.md`, so both are
 * API surface — and for an agent `SKILL.md` IS the API surface: it is the file
 * read before a command is typed. On 2026-07-29 the platform standardised
 * destruction on `delete` (root `CLAUDE.md`, "One operation, one verb"). Every
 * source file, every test and README were swept; `SKILL.md` was not, and
 * `2.0.0-beta.8` shipped teaching three commands the CLI does not have —
 * `deployments remove`, `domains remove`, `tokens remove` — with no alias to
 * soften the landing. The same file documented `"total": N` on list responses,
 * a field `@shipstatic/types` had deliberately removed.
 *
 * Neither drift was catchable. That wave's five fences covered types, route
 * literals, the `--json` channel, mocks and `/setup`; prose sat outside all of
 * them, and prose is the only surface an agent reads. A doc is a contract only
 * if something checks it.
 *
 * Four questions, one subject — does the documentation describe this code?
 *
 *   1. does every command the docs teach exist?
 *   2. does every command that exists get taught?
 *   3. does every SDK call the docs show name real members?
 *   4. does every response key the docs print exist on a published type?
 *
 * `helpText()` — the hand-curated front page (`npm/ship/CLAUDE.md`, "Two help
 * scopes") — is covered too, but on its own terms: curation is legitimate
 * there, so a command may be left off PROVIDED the omission is recorded with a
 * reason. Silent omission is not curation, it is forgetting; the page was
 * missing `ping`, `account get` and `tokens get` when this was written, none of
 * it decided.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

/**
 * The docs under contract are whatever the package PUBLISHES — read from
 * `files` rather than listed here, so a third markdown file joins the fence by
 * being shipped, which is the only act that makes it a contract.
 */
const publishedDocs: string[] = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).files as string[]
).filter((f) => f.endsWith('.md'));

/**
 * Property names declared anywhere in `@shipstatic/types`. Comments are
 * stripped first so prose about a removed field cannot vouch for it.
 *
 * A set rather than a per-type map on purpose: this answers "is this a word the
 * published contract still uses", which is the drift class — a renamed verb, a
 * deleted field. Which type carries it is a question `pnpm typecheck` already
 * answers for every call site, and duplicating that here would be a second,
 * weaker type checker.
 */
const publishedNames = ((): ReadonlySet<string> => {
  const dts = readFileSync(require.resolve('@shipstatic/types').replace(/\.js$/, '.d.ts'), 'utf8');
  const code = dts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const names = new Set<string>();
  for (const m of code.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)) {
    names.add(m[1]);
  }
  return names;
})();

/** A candidate command line, with enough context to find it again. */
interface Snippet {
  doc: string;
  line: number;
  text: string;
}

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'console', '']);

/**
 * Every shell snippet in a doc: the lines of a shell fenced block, and every
 * inline `code span` outside one. Prose is included on purpose — the sentence
 * "check status with `ship domains get <name>`" teaches a command exactly as a
 * fenced block does, and drifts exactly as easily.
 */
function shellSnippets(doc: string, body: string): Snippet[] {
  const found: Snippet[] = [];
  let fenceLang: string | null = null;

  body.split('\n').forEach((line, i) => {
    const fence = line.match(/^\s*```([a-zA-Z]*)\s*$/);
    if (fence) {
      fenceLang = fenceLang === null ? fence[1].toLowerCase() : null;
      return;
    }
    if (fenceLang !== null) {
      if (SHELL_LANGS.has(fenceLang)) found.push({ doc, line: i + 1, text: line });
      return;
    }
    for (const span of line.matchAll(/`([^`\n]+)`/g)) {
      found.push({ doc, line: i + 1, text: span[1] });
    }
  });

  return found;
}

/**
 * The argv a snippet hands to `ship`, or null if it invokes something else.
 * Shell separators are split first, so a pipeline teaches every command in it
 * (`ship … -q | xargs -I{} ship deployments delete {}` teaches two).
 */
function invocations(text: string): string[][] {
  const withoutComment = text.replace(/\s+#.*$/, '');
  return withoutComment
    .split(/\||&&|\|\||;/)
    .map((segment) => {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      // `npx -y @shipstatic/ship …` is the no-install form SKILL.md leads with.
      const bare = tokens.indexOf('ship');
      const npx = tokens.indexOf('@shipstatic/ship');
      const at = npx !== -1 && (bare === -1 || npx < bare) ? npx : bare;
      return at === -1 ? null : tokens.slice(at + 1);
    })
    .filter((argv): argv is string[] => argv !== null);
}

const isOption = (token: string) => token.startsWith('-') && token !== '-';

/** The declaration of a flag on `cmd` — or on the root, where globals live. */
const optionFor = (program: Command, cmd: Command, token: string) => {
  const flag = token.split('=')[0];
  return [...cmd.options, ...program.options].find((o) => o.short === flag || o.long === flag);
};

/**
 * Walk the command tree as far as the argv names real subcommands, keeping the
 * flags passed along the way.
 *
 * Flags are COLLECTED rather than stepped over. Skipping them silently is the
 * first hole this fence had: `ship deployments list --api-key abc` resolved to
 * a real command, the dead flag was passed over on the way, and the flag
 * assertion saw an empty list and went green.
 */
function resolve(program: Command, argv: string[]) {
  let cmd = program;
  const path: string[] = [];
  const flags: string[] = [];
  let i = 0;

  for (; i < argv.length; i++) {
    const token = argv[i];
    if (isOption(token)) {
      flags.push(token);
      // A flag taking a value consumes the next token, which is otherwise
      // indistinguishable from a subcommand name.
      const declared = optionFor(program, cmd, token);
      if (!token.includes('=') && (declared?.required || declared?.optional)) i++;
      continue;
    }
    const next = cmd.commands.find((c) => c.name() === token || c.aliases().includes(token));
    if (!next) break;
    cmd = next;
    path.push(token);
  }

  return { cmd, path, flags, rest: argv.slice(i) };
}

const docs = publishedDocs.map((doc) => ({
  doc,
  body: readFileSync(join(ROOT, doc), 'utf8'),
}));

describe('the published docs describe this code', () => {
  it('reads every published doc (guards against a fence that checks nothing)', () => {
    expect(publishedDocs).toContain('README.md');
    expect(publishedDocs).toContain('SKILL.md');
    expect(publishedNames.size).toBeGreaterThan(100);
  });

  // Collected once — assertions 1 and 2 are the two directions of one walk.
  const program = buildProgram();
  const unknownCommands: string[] = [];
  const unknownFlags: string[] = [];
  const taught = new Set<string>();

  for (const { doc, body } of docs) {
    for (const snippet of shellSnippets(doc, body)) {
      for (const argv of invocations(snippet.text)) {
        const { cmd, path, flags, rest } = resolve(program, argv);
        const where = `${doc}:${snippet.line}  ship ${argv.join(' ')}`;

        // A group with no positional of its own cannot take a bare word: that
        // word is a subcommand, and it does not exist. The root is exempt —
        // its `[path]` argument IS the deploy shortcut.
        const stray = rest.find((t) => !isOption(t));
        if (stray !== undefined && cmd.commands.length > 0 && !cmd.registeredArguments.length) {
          unknownCommands.push(`${where}   ← no such command: '${stray}'`);
          continue;
        }

        taught.add(path.join(' '));
        for (const token of [...flags, ...rest.filter(isOption)]) {
          if (!optionFor(program, cmd, token)) {
            unknownFlags.push(`${where}   ← no such flag: '${token}'`);
          }
        }
      }
    }
  }

  it('every command the docs teach exists', () => {
    expect(
      unknownCommands,
      'A published doc names a command the CLI does not have. Either the doc ' +
        'missed a rename, or the command was removed without sweeping its docs.',
    ).toEqual([]);
  });

  it('every flag the docs teach exists', () => {
    expect(
      unknownFlags,
      'A published doc names a flag the CLI does not declare — on that command ' +
        'or as a global.',
    ).toEqual([]);
  });

  /**
   * Commands the curated front page deliberately does not list. Adding an entry
   * is a decision; a command drifting off the page is not possible, because the
   * assertion below rejects anything not named here.
   */
  const HELP_OMISSIONS: ReadonlyArray<{ path: string; reason: string }> = [
    {
      path: 'account get',
      reason:
        '`ship whoami` is the same read and is what the page shows — listing both ' +
        'would put two spellings of one command on a page whose whole job is brevity',
    },
    {
      path: 'completion install',
      reason: 'shell setup, run once and never browsed for; the page groups it as `completion`',
    },
    {
      path: 'completion uninstall',
      reason: 'the sibling of the above',
    },
  ];

  it('every command the CLI has is on the front page, or recorded as left off', () => {
    // The page is documentation the CLI ships in its own binary, so it answers
    // the same completeness question as README and SKILL.md — it just gets to
    // say no, in writing.
    const page = program.helpInformation();
    const excused = new Set(HELP_OMISSIONS.map((o) => o.path));

    const leaves = (cmd: Command, path: string[] = []): string[][] =>
      cmd.commands.length
        ? cmd.commands.flatMap((sub) => leaves(sub, [...path, sub.name()]))
        : [path];

    const missing = leaves(program)
      .map((path) => path.join(' '))
      .filter((path) => path && !excused.has(path))
      .filter((path) => !page.includes(`ship ${path}`));

    expect(
      missing,
      'The front page is curated, so a command MAY be left off — but the ' +
        'omission has to be a decision. Add it to the page, or record it in ' +
        'HELP_OMISSIONS with the reason it does not belong there.',
    ).toEqual([]);
  });

  it('every recorded help omission is still a real command', () => {
    // The other direction: an excuse outliving the command it excused is how a
    // list like this rots into noise.
    const known = new Set(
      program.commands.flatMap((c) =>
        c.commands.length ? c.commands.map((s) => `${c.name()} ${s.name()}`) : [c.name()],
      ),
    );

    expect(HELP_OMISSIONS.map((o) => o.path).filter((path) => !known.has(path))).toEqual([]);
  });

  /**
   * Flags the CLI has that no published doc teaches. Same shape and same
   * doctrine as `HELP_OMISSIONS`: an omission may be legitimate, but it has to
   * be a decision someone wrote down.
   *
   * Empty, and that is the interesting part — every flag this CLI declares is
   * taught somewhere, `--api-url` included.
   */
  const FLAG_OMISSIONS: ReadonlyArray<{ flag: string; reason: string }> = [];

  /**
   * Commander's own options, not surface this CLI designed. Everything else on
   * every command is quantified over.
   */
  const BUILT_IN_FLAGS = new Set(['--help', '--version']);

  /** Every option the tree declares, with the command a reader would find it on. */
  const declaredFlags = ((): ReadonlyArray<{ flag: string; where: string }> => {
    const walk = (cmd: Command, path: string[]): Array<{ flag: string; where: string }> => [
      ...cmd.options
        .map((o) => o.long)
        .filter((long): long is string => !!long && !BUILT_IN_FLAGS.has(long))
        .map((flag) => ({ flag, where: ['ship', ...path].join(' ') })),
      ...cmd.commands.flatMap((sub) => walk(sub, [...path, sub.name()])),
    ];
    return walk(program, []);
  })();

  /** A flag is taught where it is named as itself, not as part of a longer word. */
  const isTaught = (flag: string) => {
    const pattern = new RegExp(
      `(^|[^-\\w])${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`,
    );
    return docs.some(({ body }) => pattern.test(body));
  };

  it('finds a non-trivial flag surface (guards the quantifier)', () => {
    // Were the walk to return nothing, the assertion below would pass while
    // proving nothing — the tautology this fence's own history warns about.
    expect(declaredFlags.length).toBeGreaterThan(10);
    expect(declaredFlags.map((f) => f.flag)).toContain('--token');

    // And the matcher must be able to say NO. Quantifying over a real surface
    // proves the inputs are non-empty; it does not prove the judgement is,
    // and a matcher that answered `true` for everything would make "every
    // flag is taught" unfailable while reading exactly as it does now.
    expect(isTaught('--token')).toBe(true);
    expect(isTaught('--flag-that-cannot-exist')).toBe(false);
  });

  it('every flag the CLI has is taught by a published doc', () => {
    // The direction this fence was missing until 2026-08-12. It held "every
    // flag the docs teach exists" and BOTH directions for commands, so a new
    // flag with no docs was silently green — which is the asymmetry that
    // produced this fence's own origin story one noun over.
    const excused = new Set(FLAG_OMISSIONS.map((o) => o.flag));
    const untaught = [
      ...new Set(
        declaredFlags
          .filter(({ flag }) => !excused.has(flag) && !isTaught(flag))
          .map(({ flag, where }) => `${flag}   (on ${where})`),
      ),
    ];

    expect(
      untaught,
      'The CLI declares a flag no published doc names. Teach it in README or ' +
        'SKILL.md, or record it in FLAG_OMISSIONS with the reason it is not ' +
        'user-facing surface.',
    ).toEqual([]);
  });

  it('every recorded flag omission is still a real flag', () => {
    // The other direction, so the list cannot rot into noise — the same pairing
    // HELP_OMISSIONS gets.
    const known = new Set(declaredFlags.map((f) => f.flag));
    expect(FLAG_OMISSIONS.map((o) => o.flag).filter((flag) => !known.has(flag))).toEqual([]);
  });

  it('every command the CLI has is taught by a published doc', () => {
    // Leaves only: a group is a namespace, not something a reader invokes.
    const leaves = (cmd: Command, path: string[] = []): string[][] =>
      cmd.commands.length
        ? cmd.commands.flatMap((sub) => leaves(sub, [...path, sub.name()]))
        : [path];

    const untaught = leaves(program)
      .map((path) => path.join(' '))
      .filter((path) => !taught.has(path));

    expect(
      untaught,
      'The CLI has a command no published doc mentions. README and SKILL.md may ' +
        'differ in depth — this asks only that ONE of them teach it, which is ' +
        'the difference between a curated page and a reference.',
    ).toEqual([]);
  });

  it('every SDK call the docs show names real members', () => {
    // `ship.<resource>.<method>(` only. One-level calls (`ship.deploy`,
    // `ship.whoami`) live on the Ship class in this repo, not in the published
    // types, so they have nothing to check against here.
    const offenders: string[] = [];

    for (const { doc, body } of docs) {
      body.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\bship\.([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/g)) {
          for (const name of [m[1], m[2]]) {
            if (!publishedNames.has(name)) {
              offenders.push(
                `${doc}:${i + 1}  ship.${m[1]}.${m[2]}()   ← no such member: '${name}'`,
              );
            }
          }
        }
      });
    }

    expect(
      offenders,
      '@shipstatic/types declares no such member. A doc showing a resource or ' +
        'method the published contract dropped teaches a call that throws.',
    ).toEqual([]);
  });

  it('every response key the docs print exists on a published type', () => {
    // The key literals of a documented response — fenced JSON and the inline
    // `{"deployments": [...], "cursor": null}` shorthand alike. This is the
    // `total` class: a field deleted from the contract, still printed as though
    // a caller could read it.
    const offenders: string[] = [];

    for (const { doc, body } of docs) {
      body.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)) {
          if (!publishedNames.has(m[1])) {
            offenders.push(`${doc}:${i + 1}   ← no such field: '${m[1]}'`);
          }
        }
      });
    }

    expect(
      offenders,
      'A documented response prints a key no published type declares. Either ' +
        'the field was removed and the doc kept it, or the doc invented it.',
    ).toEqual([]);
  });
});
