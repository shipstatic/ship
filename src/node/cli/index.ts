/**
 * @file Main entry point for the Ship CLI.
 *
 * `buildProgram()` constructs the full Commander tree and is the seam the
 * in-process tests drive (`tests/node/cli/index.test.ts`). The bin execution
 * path at the bottom of this file is what `dist/cli.cjs` runs and is proven
 * by the child-process smoke tier. Commander instances are not reusable
 * across parses (option state accumulates), so every caller gets a fresh
 * tree.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import {
  type Deployment,
  DeploymentVia,
  type DeploymentViaType,
  ErrorType,
  isShipError,
  normalizeVia,
  ShipError,
  validateApiUrl,
  validateToken,
} from '@shipstatic/types';
import { Command, CommanderError, Help, InvalidArgumentError } from 'commander';
import { bold, dim } from 'yoctocolors';
import type { Ship } from '../index.js';
import { installCompletion, uninstallCompletion } from './completion.js';
import { subcommandsOf } from './completions.js';
import { runConfig } from './config.js';
import { createClient, resolveCliToken } from './create-client.js';
import { CREDENTIAL_HINT, getUserMessage, toShipError } from './error-handling.js';
import { announceStep, formatOutput, type OutputContext } from './formatters.js';
import type {
  CLIResult,
  DeployCommandOptions,
  EffectiveOptions,
  EnrichedDomain,
  GlobalOptions,
  LabelOptions,
  ListCommandOptions,
} from './types.js';
import { error } from './utils.js';

// Load package.json for version
function loadPackageJson(): { version: string } {
  const paths = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json'),
  ];
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {}
  }
  return { version: '0.0.0' };
}

const packageJson = loadPackageJson();

/**
 * The CLI's FRONT PAGE — what `ship`, `ship --help`, and `ship help` render.
 * This hand-written overview is the product's front door and is kept exactly
 * as designed; do not swap it for generated output.
 *
 * Subcommand help is the other scope: `ship deployments --help` and
 * `ship help deployments` render Commander's NATIVE help, which knows that
 * command's exact usage, arguments, and options. The split lives in ONE
 * conditional (`configureHelp.formatHelp` in `buildProgram`): root → this
 * page, everything else → native. Riding the built-in machinery is what
 * makes every help route credential-free and lets `--help` beside a parse
 * error win (Commander processes it before argument errors).
 */
function helpText(noColor?: boolean): string {
  const applyBold = (text: string) => (noColor ? text : bold(text));
  const applyDim = (text: string) => (noColor ? text : dim(text));
  const icon = (emoji: string) => (noColor ? '' : `${emoji} `);

  const output = `${applyBold('USAGE')}
  ship <path>               ${icon('🚀')}Deploy static sites with simplicity

${applyBold('COMMANDS')}
  ${icon('📦')}${applyBold('Deployments')}
  ship deployments list                 List deployments
  ship deployments upload <path>        Upload deployment from file or directory
  ship deployments get <deployment>     Show deployment information
  ship deployments set <deployment>     Set deployment labels
  ship deployments delete <deployment>  Delete deployment permanently

  ${icon('🌎')}${applyBold('Domains')}
  ship domains list                     List domains
  ship domains set <name> [deployment]  Create domain, link to deployment, or update labels
  ship domains get <name>               Show domain information
  ship domains validate <name>          Check if domain name is valid and available
  ship domains records <name>           Show required DNS records for domain setup
  ship domains dns <name>               Look up DNS provider for a domain
  ship domains share <name>             Get shareable DNS setup link
  ship domains verify <name>            Trigger DNS verification for external domain
  ship domains delete <name>            Delete domain permanently

  ${icon('🔑')}${applyBold('Tokens')}
  ship tokens list                      List deploy tokens
  ship tokens create                    Create a new deploy token
  ship tokens get <token>               Show token information
  ship tokens delete <token>            Delete token permanently

  ${icon('⚙️')}${applyBold('Setup')}
  ship config                           Save your token
  ship whoami                           Get current account information
  ship ping                             Check API connectivity

  ${icon('🛠️')}${applyBold('Completion')}
  ship completion install               Install shell completion script
  ship completion uninstall             Uninstall shell completion script

${applyBold('FLAGS')}
  --token <token>           Any ship token: API key (ship-…) or deploy token (deploy-…)
  --config <file>           Custom config file path
  --domain <domain>         Serve this deployment at a domain (needs a token)
  --label <label>           Set label (repeatable, replaces all existing)
  --password <password>     Password-protect this deployment
  --no-path-detect          Disable automatic path optimization and flattening
  --no-spa-detect           Disable automatic SPA detection and configuration
  --no-color                Disable colored output
  --json                    Output results in JSON format
  -q, --quiet               Output only the resource identifier
  -V, --version             Show version information

${applyBold('EXAMPLES')}
  ship ./dist
  ship ./dist --domain www.example.com
  ship domains set www.example.com happy-cat-abc1234.shipstatic.com
  ship ./dist -q | ship domains set www.example.com

${applyDim('Please report any issues to https://github.com/shipstatic/ship/issues')}
`;

  return output;
}

/**
 * A CLI grammar error — a command or flag this binary does not have.
 *
 * Deliberately STATUSLESS. `ErrorResponse.status` is documented "(API
 * contexts)", and no API ever sees `ship foo`, so a 400 here would be an HTTP
 * fact about an exchange that never happened. The dual-validation errors are
 * the opposite case and rightly DO carry 400 — a blocked extension or a bad
 * label is a rule the server enforces too, and the error must read the same
 * wherever it was caught. See CLAUDE.md, "What a status means".
 */
const usageError = (message: string) => new ShipError(ErrorType.Validation, message);

/**
 * Collector function for Commander.js to accumulate repeated option values.
 * Used for --label flag that can be specified multiple times.
 */
function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

/**
 * Argument parser for integer option values (`--limit`). A mangled number
 * must fail HERE with a clear message — a bare `parseInt` once turned
 * `--ttl abc` into `NaN` on the wire. Range rules stay server-side (the SDK
 * is a transparent pipe); only the not-a-number corruption is a client bug.
 */
function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new InvalidArgumentError('Not a number.');
  }
  return parsed;
}

/** The suffixes `--ttl` accepts, and what each is worth in seconds. */
const TTL_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Argument parser for `--ttl`, on the deploy and on `tokens create` alike —
 * **one word, one grammar, everywhere.** Bare seconds (`3600`) or a
 * `<n><unit>` suffix (`90s`, `30m`, `1h`, `7d`). The wire stays a number of
 * seconds; the suffix is a spelling this parser owns and nothing downstream
 * ever sees.
 *
 * `tokens create --ttl` took bare integers only until 2026-08-12. It was the
 * platform's only ttl then, so there was nothing to be consistent with —
 * and the moment the deploy learned the same word, two spellings of one
 * duration would have been two grammars for a user to remember.
 *
 * **The RANGE is not judged here.** `validateTtl` in `@shipstatic/types` owns
 * that, and it runs at the SDK's request boundary for both commands, so the
 * refusal reads identically whether it came from the CLI, the SDK or the API.
 * What this parser owns is the one thing a range check cannot do: refuse a
 * value that is not a duration at all, before `NaN` reaches the wire.
 */
function parseTtl(value: string): number {
  const match = /^(\d+)([smhd])?$/.exec(value.trim().toLowerCase());
  if (!match) {
    throw new InvalidArgumentError('Expected seconds or a duration like 90s, 30m, 1h, 7d.');
  }
  // Non-null: the pattern cannot match without group 1, and group 2 is either
  // a key of TTL_UNITS or absent (bare seconds).
  const amount = Number.parseInt(match[1] as string, 10);
  return amount * (match[2] ? (TTL_UNITS[match[2]] as number) : 1);
}

/**
 * The labels a command was given, or `undefined` when it was given none.
 *
 * `--label ''` means "clear all labels", so an all-empty list becomes `[]`
 * (send the clearing) while no list at all stays absent (send nothing).
 */
function labelsOf(options: LabelOptions): string[] | undefined {
  const labels = options.label;
  if (!labels?.length) return undefined;
  const filtered = labels.filter((l) => l !== '');
  return filtered.length ? filtered : [];
}

/**
 * The deploy password: the flag, else `SHIP_PASSWORD`.
 *
 * An empty `--password ''` is forwarded to the SDK validator so the user sees
 * a clear length error rather than a silent drop. An empty `SHIP_PASSWORD` is
 * coerced to undefined, matching how SHIP_TOKEN and SHIP_API_URL treat empty
 * env vars (CI/Docker often sets unset vars to "" — see core/config.ts).
 *
 * The env tier is a different axis from flag position: `--domain` has no
 * `SHIP_DOMAIN` twin, because that tier exists for values a subprocess wrapper
 * cannot put on argv — secrets, ambient keys — and a domain rides argv fine.
 */
function passwordOf(options: DeployCommandOptions): string | undefined {
  return options.password ?? (process.env.SHIP_PASSWORD || undefined);
}

/**
 * The requested lifetime, read from the EFFECTIVE options — for the deploy
 * and for `tokens create` alike.
 *
 * The tier is what decides the source, per "one place each flag is read":
 * `--ttl` is declared on the deploy shortcut, which IS the program, so
 * Commander's root consumes it wherever it sits in argv and it never reaches
 * a subcommand's own `cmdOptions`. `tokens create` declared it alone until
 * 2026-08-12 and correctly read `cmdOptions.ttl`; the moment the deploy
 * declared the same flag, that read went silently undefined — every
 * `ship tokens create --ttl 1h` minting a permanent token. Reading one source
 * for both is what makes that unrepresentable rather than remembered.
 *
 * **No `SHIP_TTL` env twin** — the env tier exists for values a subprocess
 * wrapper cannot put on argv (secrets, ambient keys). A duration rides argv
 * fine, the same reason `--domain` has no twin.
 */
function ttlOf(options: DeployCommandOptions): number | undefined {
  return options.ttl;
}

/**
 * The flags that mean the same thing on every command — identity and channel.
 * Stated once, as data.
 *
 * Only the GLOBAL tier is written down; command-owned is the complement, so a
 * flag added to the deploy shortcut joins the law by being declared and there
 * is no second list to keep in step. `-h` is Commander's own and never reaches
 * an action; `--version` is listed because `.version()` does put it here.
 */
const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  '--token',
  '--config',
  '--api-url',
  '--json',
  '--quiet',
  '--no-color',
  '--version',
]);

/**
 * What a user types to reach a command — `deployments upload`.
 *
 * The ROOT has no name in such a path: the deploy shortcut IS the program, so
 * what a user types there is its ARGUMENT, and `ship <path>` is what the front
 * page and every published doc call it. Rendering that from
 * `registeredArguments` is what lets the shortcut appear in an owner list at
 * all — read from the tree, like every other entry.
 */
function pathOf(command: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = command; c?.parent; c = c.parent) parts.unshift(c.name());
  if (!parts.length) parts.push(...command.registeredArguments.map((a) => `<${a.name()}>`));
  return parts.join(' ');
}

/**
 * Every command that declares this flag — INCLUDING the one it is given, which
 * for the top call is the program, whose entry is the deploy shortcut.
 *
 * That inclusion is not cosmetic. `assertFlagsApply` returns early for the
 * program precisely BECAUSE the program owns these flags, so a survey that
 * structurally could not name it contradicted its own caller ten lines up —
 * and left the advice pointing only at `ship deployments upload` while
 * `ship <path> --domain …` is the spelling the docs lead with.
 *
 * Read, never restated. The shortcut comes first because the program is the
 * root, which is also the order a reader wants.
 */
function ownersOf(command: Command, long: string): string[] {
  return [
    ...(command.options.some((o) => o.long === long) ? [pathOf(command)] : []),
    ...command.commands.flatMap((sub) => ownersOf(sub, long)),
  ];
}

/**
 * A flag parses only where it means something.
 *
 * Commander recognises a PROGRAM option anywhere in argv — the same mechanism
 * that lets `--json` follow a subcommand, so it is not something to switch
 * off. The consequence is that the deploy shortcut's flags, which must live on
 * the program because the shortcut IS the program, are also accepted in front
 * of every other command, where nothing reads them: `ship --domain www.x.com
 * domains list` parsed cleanly and dropped the domain, and a user who typed it
 * believed they had linked one. Silent-swallow is the worse half of the
 * defect — worse than a refusal, and worse than an unknown-option error.
 *
 * So the law is enforced where it can be: before any action runs, a
 * command-owned flag that was actually TYPED must be declared by the command
 * about to run. Presence is read from the SOURCE, never from the value —
 * `--label` defaults to `[]` and `--no-path-detect` to `true`, so a truthiness
 * test would refuse every subcommand always.
 *
 * POSITION is deliberately not part of the law: `ship --label x deployments
 * upload ./dist` is honoured, because Commander stores it identically to the
 * canonical spelling and telling the two apart would mean scanning raw argv
 * beside the parser — a second parser, which this file refuses on the same
 * grounds it refuses a second copy of the command tree. See CLAUDE.md,
 * "Two flag tiers".
 */
function assertFlagsApply(program: Command, actionCommand: Command): void {
  // The shortcut IS the program, so the program's own flags always apply.
  if (actionCommand === program) return;

  for (const option of program.options) {
    const long = option.long;
    if (!long || GLOBAL_FLAGS.has(long)) continue;
    if (program.getOptionValueSource(option.attributeName()) !== 'cli') continue;
    if (actionCommand.options.some((o) => o.long === long)) continue;

    const owners = ownersOf(program, long).map((p) => `ship ${p}`);
    throw usageError(
      `option '${long}' does not apply to 'ship ${pathOf(actionCommand)}'${
        owners.length ? ` — it belongs to ${owners.join(', ')}` : ''
      }`,
    );
  }
}

/**
 * Process CLI options using Commander's built-in option merging.
 * Applies CLI-specific transformations (validation is done in preAction hook).
 */
function processOptions(command: Command): EffectiveOptions {
  const options = command.optsWithGlobals();

  // Convert Commander.js --no-color flag (color: false) to our convention (noColor: true)
  if (options.color === false) {
    options.noColor = true;
  }

  // Auto-suppress color when stdout is not a TTY (like grep --color=auto)
  // Also respect NO_COLOR convention (https://no-color.org/)
  // FORCE_COLOR overrides for CI environments that explicitly want color
  // FORCE_COLOR=0 means "force no color" per the convention (0=off, 1/2/3=on)
  const forceColor = !!process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0';
  if (!options.noColor && !forceColor) {
    if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined) {
      options.noColor = true;
    }
  }

  return options as EffectiveOptions;
}

/**
 * What a command GROUP does when none of its own subcommands matched: name the
 * unknown word, then print scoped usage rather than the whole front page — the
 * user already knows which group they are in.
 *
 * **It states nothing about the tree.** Commander binds `this` to the command
 * and collects the leftover words in `this.args`, so the group's name and its
 * subcommands are read from the tree at parse time, exactly as the completion
 * renderer reads them. A list that cannot be edited cannot drift.
 *
 * See CLAUDE.md, "the last hand-written copy of the command tree".
 */
function handleUnknownSubcommand(this: Command): void {
  const options = processOptions(this);
  const subcommands = subcommandsOf(this).map((c) => c.name());

  const unknown = this.args.find((arg) => !subcommands.includes(arg));
  if (unknown) {
    error(usageError(`unknown command '${unknown}'`), options.json, options.noColor);
  }

  if (!options.json) {
    console.log(`usage: ship ${this.name()} <${subcommands.join('|')}>\n`);
  }
  process.exitCode = 1;
}

/** Spinner instance type from yocto-spinner */
interface Spinner {
  start(): Spinner;
  stop(): void;
}

/**
 * Common deploy logic used by both shortcut and explicit commands.
 *
 * It takes the EFFECTIVE options and nothing else — every deploy flag reaches
 * it through Commander's own merge, so there is no per-flag plumbing and no
 * source to arbitrate between. See CLAUDE.md, "Two flag tiers".
 */
async function performDeploy(
  client: Ship,
  deployPath: string,
  options: EffectiveOptions,
): Promise<Deployment> {
  if (!existsSync(deployPath)) {
    throw ShipError.file(`${deployPath} path does not exist`, { filePath: deployPath });
  }

  const stats = statSync(deployPath);
  if (!stats.isDirectory() && !stats.isFile()) {
    throw ShipError.file(`${deployPath} path must be a file or directory`, {
      filePath: deployPath,
    });
  }

  const deployOptions: {
    via: DeploymentViaType;
    labels?: string[];
    password?: string;
    ttl?: number;
    idempotencyKey?: string;
    pathDetect?: boolean;
    spaDetect?: boolean;
    signal?: AbortSignal;
  } = {
    // `SHIP_VIA` exists so a wrapper can relabel the origin — the GitHub
    // Action sends `git`. An unrecognized label falls back to `cli` rather
    // than riding along: the server silently drops what it does not know, so
    // forwarding a typo recorded NOTHING, while the honest default records
    // the truth (this deploy did come from the CLI).
    via: normalizeVia(process.env.SHIP_VIA) ?? DeploymentVia.CLI,
  };

  // Handle labels
  const labels = labelsOf(options);
  if (labels !== undefined) deployOptions.labels = labels;

  // `SHIP_IDEMPOTENCY_KEY` is the subprocess-wrapping consumer's half of the
  // SDK's `idempotencyKey` — the same tier and the same reason as
  // `SHIP_PASSWORD`: an integration that shells out to `ship` has no other way
  // to reach a per-call option. The GitHub Action derives one per workflow
  // run, so pressing "re-run jobs" replays the original 201 instead of
  // deploying twice. Empty is absence (CI sets unset variables to ""); the
  // value itself is validated by the SDK, which is where the wire rule lives.
  const idempotencyKey = process.env.SHIP_IDEMPOTENCY_KEY || undefined;
  if (idempotencyKey !== undefined) deployOptions.idempotencyKey = idempotencyKey;

  // Empty password strings flow through to the SDK validator (clear length
  // error) instead of being silently dropped.
  const password = passwordOf(options);
  if (password !== undefined) deployOptions.password = password;

  // Seconds by the time it lands here — `parseTtl` owns the `1h` / `7d`
  // spelling and the wire carries a plain number. The RANGE is the SDK's
  // request boundary to judge, from the rule `@shipstatic/types` owns.
  const ttl = ttlOf(options);
  if (ttl !== undefined) deployOptions.ttl = ttl;

  // The detection flags, under the names Commander actually gives them —
  // `--no-x` stores the POSITIVE key, defaulted true. Read as `noPathDetect` /
  // `noSpaDetect` until 2026-08-12, which is to say never read at all.
  if (options.pathDetect !== undefined) deployOptions.pathDetect = options.pathDetect;
  if (options.spaDetect !== undefined) deployOptions.spaDetect = options.spaDetect;

  // Cancellation support
  const abortController = new AbortController();
  deployOptions.signal = abortController.signal;

  // Spinner (TTY only, not JSON, not --no-color)
  let spinner: Spinner | null = null;
  if (process.stdout.isTTY && !options.json && !options.quiet && !options.noColor) {
    const { default: yoctoSpinner } = await import('yocto-spinner');
    spinner = yoctoSpinner({ text: 'uploading…' }).start();
  }

  const sigintHandler = () => {
    abortController.abort();
    if (spinner) spinner.stop();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);

  try {
    return await client.deployments.upload(deployPath, deployOptions);
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
  }
}

/**
 * THE link: upsert a domain and answer with it, DNS enrichment included.
 *
 * This is everything `ship domains set` does once its own grammar has produced
 * arguments — the stdin fallback and the label read stay in that command,
 * because they are how it reads a request, not how it links. What is left is
 * shared with the deploy's `--domain` arm, so the two spellings link
 * identically by construction rather than by anyone remembering to.
 *
 * Returns `EnrichedDomain` in both cases: its two enrichment fields are
 * optional, so a plain `DomainSetResult` already IS one, and the caller has a
 * single type to render.
 */
async function performDomainSet(
  client: Ship,
  name: string,
  options: { deployment?: string; labels?: string[] },
): Promise<EnrichedDomain> {
  // SDK returns DomainSetResult (Domain + isCreate derived from HTTP 201/200) —
  // the resource interface in @shipstatic/types declares this directly, no cast needed.
  const result = await client.domains.set(name, options);

  // Enrich with DNS info for new external domains (pure formatter will display it)
  if (result.isCreate && name.includes('.')) {
    try {
      const [records, share] = await Promise.all([
        client.domains.records(name),
        client.domains.share(name),
      ]);
      return {
        ...result,
        _dnsRecords: records.records,
        _shareHash: share.hash,
      };
    } catch {
      // Graceful degradation - return without DNS info
    }
  }
  return result;
}

/**
 * Build the complete `ship` command tree.
 *
 * Everything that closes over the program instance — the exit override, the
 * error handler, the action wrapper — lives inside this factory so that each
 * call returns a fully independent tree. The bin path below builds one and
 * parses `process.argv`; in-process tests build one per invocation.
 */
export function buildProgram(): Command {
  const program = new Command();

  // Override Commander.js error handling while preserving help/version behavior.
  //
  // Nothing in the tree calls `process.exit` — actions and this override set
  // `process.exitCode` or throw a `CommanderError`, and the bin path lets the
  // process end naturally once the event loop drains. That is Commander's own
  // recommended shape: `process.exit` can truncate stdout still buffered on a
  // pipe, and a tree that never exits mid-flight is drivable in-process.
  program
    .exitOverride((err) => {
      // Clean exits (help/version) — nothing to add, let the bin observe it.
      if (err.code === 'commander.help' || err.code === 'commander.version' || err.exitCode === 0) {
        throw err;
      }

      const globalOptions = processOptions(program);

      let message = err.message || 'unknown command error';
      message = message
        .replace(/^error: /, '')
        .replace(/\n.*/, '')
        .replace(/\.$/, '')
        .toLowerCase();

      // A Commander parse failure is a usage error — typed as such so
      // `--json` carries `validation_failed` rather than bare prose.
      error(usageError(message), globalOptions.json, globalOptions.noColor);

      if (!globalOptions.json) {
        program.outputHelp();
      }

      throw err;
    })
    .configureOutput({
      writeErr: (str) => {
        if (!str.startsWith('error:')) {
          process.stderr.write(str);
        }
      },
      writeOut: (str) => process.stdout.write(str),
    });

  /**
   * Error handler - outputs errors consistently in text or JSON format.
   * Message formatting is delegated to the error-handling module.
   */
  function handleError(err: unknown) {
    const opts = processOptions(program);
    const shipError = toShipError(err);

    // Text translates, JSON transmits: the machine channel emits the error's
    // own `ErrorResponse`, so `error` names the ErrorType the API produced;
    // the human channel gets the CLI's actionable rewording of it.
    if (opts.json) {
      error(shipError, true, opts.noColor);
    } else {
      // Only the auth branch consults the credential, and resolving it reads
      // `.shiprc` — so a local failure (`completion install`, `config`) must
      // not pay for it. Eager resolution made every error touch the disk.
      const message = getUserMessage(shipError, {
        token: shipError.isAuthError() ? resolveCliToken(program.opts()) : undefined,
      });
      error(message, false, opts.noColor);
      // Show help only for unknown command errors (user CLI mistake)
      if (shipError.type === ErrorType.Validation && message.includes('unknown command')) {
        program.outputHelp();
      }
    }

    process.exitCode = 1;
  }

  /**
   * Wrapper for CLI actions: one client, one output path, one error path.
   *
   * The context says what the command IS — never what the caller typed, since
   * the arguments are the request and every sentence about a result is composed
   * from the response. It reaches `formatOutput` and nothing else: the error
   * path has no use for it, because the wire message already names the
   * resource, which is exactly why the CLI relays it.
   */
  function withErrorHandling<T extends unknown[], R extends CLIResult>(
    handler: (client: Ship, options: GlobalOptions, ...args: T) => Promise<R>,
    context: OutputContext,
  ) {
    return async function (this: Command, ...args: T) {
      const globalOptions = processOptions(this);

      try {
        const { config, apiUrl, token } = program.opts();
        const client = createClient({ config, apiUrl, token });
        const result = await handler(client, globalOptions, ...args);
        formatOutput(result, context, {
          json: globalOptions.json,
          quiet: globalOptions.quiet,
          noColor: globalOptions.noColor,
        });
      } catch (err) {
        handleError(err);
      }
    };
  }

  program
    .name('ship')
    .description('🚀 Deploy static sites with simplicity')
    .version(packageJson.version, '-V, --version', 'Show version information')
    .option('--token <token>', 'Any ship token: API key (ship-…) or deploy token (deploy-…)')
    .option('--config <file>', 'Custom config file path')
    .option('--api-url <url>', 'API URL (for development)')
    .option('--json', 'Output results in JSON format')
    .option('-q, --quiet', 'Output only the resource identifier')
    .option('--no-color', 'Disable colored output')
    // Two help scopes, one machinery: the ROOT renders our hand-written
    // front page (helpText — the kept design); subcommands render
    // Commander's native scoped help, which knows their exact usage and
    // options. `Help.prototype` is the escape past our own override, which
    // subcommands inherit at registration.
    .helpOption('-h, --help', 'Display help for command')
    .helpCommand('help [command]', 'Display help for command')
    .configureHelp({
      formatHelp: (cmd, helper) =>
        cmd.parent === null
          ? `${helpText(processOptions(cmd).noColor)}\n`
          : Help.prototype.formatHelp.call(helper, cmd, helper),
    })
    // Recorded opt-out of v13+'s excess-arguments error: the deploy shortcut
    // takes `[path]` with trailing noise tolerated, and unknown subcommands
    // must REACH handleUnknownSubcommand (as excess args) to get scoped
    // usage instead of Commander's generic "too many arguments".
    .allowExcessArguments();

  // Validate options early - before any action is executed
  program.hook('preAction', (thisCommand, actionCommand) => {
    const options = processOptions(thisCommand);

    try {
      // Grammar before values: an invocation that names a flag the command
      // cannot read is malformed, whatever the flag's value turns out to be.
      assertFlagsApply(program, actionCommand);

      if (options.token && typeof options.token === 'string') {
        validateToken(options.token);
      }

      if (options.apiUrl && typeof options.apiUrl === 'string') {
        validateApiUrl(options.apiUrl);
      }
    } catch (validationError) {
      if (isShipError(validationError)) {
        error(validationError, options.json, options.noColor);
        // Already reported — the bare CommanderError just carries the code.
        throw new CommanderError(1, 'ship.invalidOption', validationError.message);
      }
      throw validationError;
    }
  });

  // Ping command
  program
    .command('ping')
    .description('Check API connectivity')
    .action(
      withErrorHandling(
        // Reachability is the absence of a throw: `ping()` resolves the server
        // clock or raises a typed error, so there is nothing here to test. The
        // exit code follows — 0 on resolve, 1 through `handleError` — which is
        // the same composability `domains validate` relies on.
        (client: Ship, _options: GlobalOptions) => client.ping(),
        { operation: 'ping' },
      ),
    );

  // Whoami shortcut - alias for account get
  program
    .command('whoami')
    .description('Get current account information')
    .action(
      withErrorHandling((client: Ship, _options: GlobalOptions) => client.whoami(), {
        operation: 'get',
        resource: 'account',
      }),
    );

  // ───────────────────────────────────────────────────────────────────────────
  // The deploy action — two spellings, two identities, one implementation.
  //
  // `ship <path>` and `ship deployments upload <path>` register the SAME
  // action function below, so the flag set and the behaviour cannot drift
  // between them; there is nothing to keep in step.
  // ───────────────────────────────────────────────────────────────────────────

  /** A deploy, answering as the deployment it created. */
  const deployOnly = withErrorHandling(
    (client: Ship, options: EffectiveOptions, deployPath: string) => {
      // The second flag that needs a token, and for the same reason `--domain`
      // does: both make a promise that outlives the upload. An anonymous
      // deployment already has a lifetime the PLATFORM chose — the claim
      // window is measured against it — so there is no deployer to grant a
      // different one, and the API refuses this independently.
      //
      // Refused here so the refusal costs nothing: discovering it after the
      // upload would have minted a public, expiring, claimable deployment as
      // the side effect of a failed authenticated intent. Same shape as the
      // `--domain` preflight below — statusless `Config`, asked of the
      // credential the CLI RESOLVED, sharing the one `CREDENTIAL_HINT`.
      if (ttlOf(options) !== undefined && !resolveCliToken(program.opts())) {
        throw ShipError.config(`--ttl sets an expiry, which needs a token: ${CREDENTIAL_HINT}`);
      }
      return performDeploy(client, deployPath, options);
    },
    { operation: 'upload', resource: 'deployment' },
  );

  /**
   * A deploy that also serves the result at `domain` — the one-intent spelling
   * of `ship ./dist -q | ship domains set <name>`, which stays and stays
   * documented. The pipe is the wrong shape for CI: a workflow `run:` block is
   * `bash -e` WITHOUT `pipefail`, so a pipeline reports the LAST command's
   * status and a failed deploy is masked by `domains set`'s own confusion —
   * and a CI consumer needs the deploy's full `--json`, which `-q` discards.
   * One process, one exit code, one JSON.
   *
   * **The answer is the DOMAIN**, because the domain is what was asked about:
   * "deploy this *to www.example.com*" is a question about the destination,
   * and `domains.set()` already answers it — the `Domain` it returns carries
   * the freshly linked deployment and its URL. So the composed command answers
   * exactly as `ship domains set` answers, through the row that command
   * already has: no new response shape, no new formatter, no new output row.
   */
  const deployAndLink = (domain: string) =>
    withErrorHandling(
      async (client: Ship, options: EffectiveOptions, deployPath: string) => {
        // Preflight, before a single file is read. An anonymous account cannot
        // own a domain, so `--domain` without a credential is ALWAYS a mistake
        // — and discovering it after the upload would have minted a public,
        // expiring, claimable deployment as the side effect of a failed
        // AUTHENTICATED intent, which fail-closed anonymity forbids.
        //
        // Asked of the credential the CLI RESOLVED, not of the three sources,
        // so a fourth source slots into `resolveCliToken` and never here.
        //
        // Statusless and `Config`-typed, per CLAUDE.md "What a status means":
        // no exchange happened, so there is no HTTP status to report.
        // `Authentication` would carry a 401 for a request never made AND hand
        // the sentence to `getUserMessage`'s generic auth arm, losing the one
        // thing worth saying — that it is `--domain` that needs the token,
        // since the same deploy without it works fine.
        if (!resolveCliToken(program.opts())) {
          throw ShipError.config(
            `--domain links a domain, which needs a token: ${CREDENTIAL_HINT}`,
          );
        }

        // A domain is a commitment; a deadline is its opposite. The API
        // refuses to link any deployment with a non-null `expires` — which is
        // what keeps the reaper from tearing a live domain's target away — so
        // this combination cannot succeed, and the only question is whether
        // the user learns that before or after paying for an upload.
        //
        // Statusless `Validation`, per "What a status means": this is the
        // CLI's own command grammar, and no API judged it.
        if (ttlOf(options) !== undefined) {
          throw usageError(
            '--ttl and --domain cannot be combined: a domain cannot point at a deployment that expires.',
          );
        }

        const deployment = await performDeploy(client, deployPath, options);

        // Beat one, streamed: the deployment's own sentence the moment it
        // lands. Load-bearing rather than decorative — if the link then fails,
        // the id the user has already paid for is on screen.
        announceStep(deployment, { operation: 'upload', resource: 'deployment' }, options);

        // Beat two, and the answer. A failure here leaves a deployed-but-
        // unlinked site, which is a valid platform state and needs no rollback:
        // an idempotent re-run replays the deploy and simply links again.
        return performDomainSet(client, domain, { deployment: deployment.deployment });
      },
      { operation: 'set', resource: 'domain' },
    );

  /**
   * `--domain` does not decorate the deploy; it makes it a different command.
   * So the flag chooses which of the two runs, and identity and behaviour are
   * chosen TOGETHER from ONE reading of it — the alternative (a static action
   * plus a context resolved separately) branches on the same condition twice
   * and lets the two answers disagree.
   */
  function runDeploy(this: Command, deployPath: string) {
    const { domain } = processOptions(this);
    return (domain ? deployAndLink(domain) : deployOnly).call(this, deployPath);
  }

  /** The deploy flags, on both registrations — declared once, applied twice. */
  const withDeployOptions = (cmd: Command) =>
    cmd
      .option('--domain <domain>', 'Serve this deployment at a domain (needs a token)')
      .option('--label <label>', 'Label to add (can be repeated)', collect, [])
      .option('--password <password>', 'Password-protect this deployment')
      .option('--ttl <duration>', 'Expire after this long — 3600, 1h, 7d (needs a token)', parseTtl)
      .option('--no-path-detect', 'Disable automatic path optimization and flattening')
      .option('--no-spa-detect', 'Disable automatic SPA detection and configuration');

  // Deployments commands
  const deploymentsCmd = program
    .command('deployments')
    .description('Manage deployments')
    .enablePositionalOptions()
    .action(handleUnknownSubcommand);

  deploymentsCmd
    .command('list')
    .description('List deployments (one page — see --limit and --cursor)')
    .option('--limit <count>', 'Maximum number of results per page', parseInteger)
    .option('--cursor <cursor>', "Continue from a previous page's cursor")
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, cmdOptions: ListCommandOptions) =>
          client.deployments.list(cmdOptions),
        { operation: 'list', resource: 'deployment' },
      ),
    );

  withDeployOptions(
    deploymentsCmd
      .command('upload <path>')
      .description('Upload deployment from file or directory')
      .passThroughOptions(),
  ).action(runDeploy);

  deploymentsCmd
    .command('get <deployment>')
    .description('Show deployment information')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, deployment: string) =>
          client.deployments.get(deployment),
        { operation: 'get', resource: 'deployment' },
      ),
    );

  deploymentsCmd
    .command('set <deployment>')
    .description('Set deployment labels')
    .passThroughOptions()
    .option('--label <label>', 'Label to set (can be repeated)', collect, [])
    .action(
      withErrorHandling(
        async (client: Ship, options: EffectiveOptions, deployment: string) =>
          client.deployments.set(deployment, { labels: labelsOf(options) || [] }),
        {
          operation: 'set',
          resource: 'deployment',
        },
      ),
    );

  deploymentsCmd
    .command('delete <deployment>')
    .description('Delete deployment permanently')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, deployment: string) =>
          client.deployments.delete(deployment),
        {
          operation: 'delete',
          resource: 'deployment',
        },
      ),
    );

  // Domains commands
  const domainsCmd = program
    .command('domains')
    .description('Manage domains')
    .enablePositionalOptions()
    .action(handleUnknownSubcommand);

  domainsCmd
    .command('list')
    .description('List domains (one page — see --limit and --cursor)')
    .option('--limit <count>', 'Maximum number of results per page', parseInteger)
    .option('--cursor <cursor>', "Continue from a previous page's cursor")
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, cmdOptions: ListCommandOptions) =>
          client.domains.list(cmdOptions),
        { operation: 'list', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('get <name>')
    .description('Show domain information')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.get(name),
        { operation: 'get', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('validate <name>')
    .description('Check if domain name is valid and available')
    .action(
      withErrorHandling(
        async (client: Ship, _options: GlobalOptions, name: string) => {
          const result = await client.domains.validate(name);
          if (!result.valid) process.exitCode = 1;
          return result;
        },
        { operation: 'validate', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('verify <name>')
    .description('Trigger DNS verification for external domain')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.verify(name),
        { operation: 'verify', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('records <name>')
    .description('Show required DNS records for domain setup')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.records(name),
        { operation: 'records', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('dns <name>')
    .description('Look up DNS provider for a domain')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.dns(name),
        { operation: 'dns', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('share <name>')
    .description('Get shareable DNS setup link')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.share(name),
        { operation: 'share', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('set <name> [deployment]')
    .description('Create domain, link to deployment, or update labels')
    .passThroughOptions()
    .option('--label <label>', 'Label to set (can be repeated)', collect, [])
    .action(
      withErrorHandling(
        async (
          client: Ship,
          options: EffectiveOptions,
          name: string,
          deployment: string | undefined,
        ) => {
          // Read deployment from stdin when piped (e.g., ship ./dist -q | ship domains set mysite.com)
          if (!deployment && !process.stdin.isTTY) {
            deployment = await new Promise<string | undefined>((resolve) => {
              let data = '';
              process.stdin.on('data', (chunk) => (data += chunk));
              process.stdin.on('end', () => resolve(data.trim() || undefined));
            });
          }

          const labels = labelsOf(options);

          const setOptions: { deployment?: string; labels?: string[] } = {};
          if (deployment) setOptions.deployment = deployment;
          if (labels !== undefined) setOptions.labels = labels;

          return performDomainSet(client, name, setOptions);
        },
        { operation: 'set', resource: 'domain' },
      ),
    );

  domainsCmd
    .command('delete <name>')
    .description('Delete domain permanently')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, name: string) => client.domains.delete(name),
        { operation: 'delete', resource: 'domain' },
      ),
    );

  // Tokens commands
  const tokensCmd = program
    .command('tokens')
    .description('Manage deploy tokens')
    .enablePositionalOptions()
    .action(handleUnknownSubcommand);

  tokensCmd
    .command('list')
    .description('List deploy tokens (one page — see --limit and --cursor)')
    .option('--limit <count>', 'Maximum number of results per page', parseInteger)
    .option('--cursor <cursor>', "Continue from a previous page's cursor")
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, cmdOptions: ListCommandOptions) =>
          client.tokens.list(cmdOptions),
        { operation: 'list', resource: 'token' },
      ),
    );

  tokensCmd
    .command('create')
    .description('Create a new deploy token')
    .option('--ttl <duration>', 'Expire after this long — 3600, 1h, 7d', parseTtl)
    .option('--label <label>', 'Label to set (can be repeated)', collect, [])
    .action(
      withErrorHandling(
        (client: Ship, options: EffectiveOptions) => {
          // Both flags are declared on the program too (the deploy shortcut
          // owns them), so Commander's root consumes both and BOTH are read
          // from the effective options — never from this command's own.
          const create: { ttl?: number; labels?: string[] } = {};
          const ttl = ttlOf(options);
          if (ttl !== undefined) create.ttl = ttl;
          const labels = labelsOf(options);
          if (labels !== undefined) create.labels = labels;
          return client.tokens.create(create);
        },
        { operation: 'create', resource: 'token' },
      ),
    );

  tokensCmd
    .command('get <token>')
    .description('Show one deploy token')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, token: string) => client.tokens.get(token),
        { operation: 'get', resource: 'token' },
      ),
    );

  tokensCmd
    .command('delete <token>')
    .description('Delete token permanently')
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, token: string) => client.tokens.delete(token),
        { operation: 'delete', resource: 'token' },
      ),
    );

  // Account commands
  const accountCmd = program
    .command('account')
    .description('Manage account')
    .action(handleUnknownSubcommand);

  accountCmd
    .command('get')
    .description('Show account information')
    .action(
      withErrorHandling((client: Ship, _options: GlobalOptions) => client.whoami(), {
        operation: 'get',
        resource: 'account',
      }),
    );

  // Completion commands
  const completionCmd = program
    .command('completion')
    .description('Setup shell completion')
    .action(handleUnknownSubcommand);

  completionCmd
    .command('install')
    .description('Install shell completion script')
    .action(() => {
      const options = processOptions(program);
      try {
        // The tree renders its own completion — no file is shipped to copy.
        installCompletion(program, { json: options.json, noColor: options.noColor });
      } catch (err) {
        handleError(err);
      }
    });

  completionCmd
    .command('uninstall')
    .description('Uninstall shell completion script')
    .action(() => {
      const options = processOptions(program);
      try {
        uninstallCompletion({ json: options.json, noColor: options.noColor });
      } catch (err) {
        handleError(err);
      }
    });

  // Config command
  program
    .command('config')
    .description('Save your token')
    .action(async () => {
      const options = processOptions(program);
      try {
        // `--json` is a RENDERING channel on every other command. Here it used
        // to change what the command DID — skip the prompt and print a status
        // report instead — which is a second command wearing the first one's
        // name. The report is gone; the wizard is all this is.
        if (options.json) {
          throw usageError(
            'ship config is interactive — run it without --json (it shows the token already saved)',
          );
        }
        await runConfig({
          noColor: options.noColor,
          // `--config` names the file to read everywhere else, so it names the
          // file to write here.
          configFile: options.config,
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Deploy shortcut as default action — the same `runDeploy` the explicit
  // command registers. Two cases are answered BEFORE it, so no client is
  // created and no config file is resolved for them: no argument (that is
  // help, not a deploy) and an argument that is a mistyped COMMAND rather than
  // a path — a user with a broken config file must still be told "unknown
  // command", not handed a config error.
  withDeployOptions(program.argument('[path]', 'Path to deploy')).action(async function (
    this: Command,
    deployPath?: string,
  ) {
    if (!deployPath) {
      this.outputHelp();
      return;
    }

    // A nonexistent path with no separators, extension, or `~` reads as a
    // mistyped command ("dist", "build" and friends exist, so they still
    // deploy). Everything else falls through to performDeploy, whose
    // "path does not exist" error names the path.
    if (!existsSync(deployPath)) {
      const looksLikeCommand =
        !deployPath.includes('/') &&
        !deployPath.includes('\\') &&
        !deployPath.includes('.') &&
        !deployPath.startsWith('~');
      if (looksLikeCommand) {
        handleError(usageError(`unknown command '${deployPath}'`));
        return;
      }
    }

    return runDeploy.call(this, deployPath);
  });

  return program;
}
