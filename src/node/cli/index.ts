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
  ErrorType,
  isShipError,
  ShipError,
  validateApiUrl,
  validateToken,
} from '@shipstatic/types';
import { Command, CommanderError, Help, InvalidArgumentError } from 'commander';
import { bold, dim } from 'yoctocolors';
import { readEnvConfig } from '../core/config.js';
import type { Ship } from '../index.js';
import { installCompletion, uninstallCompletion } from './completion.js';
import { subcommandsOf } from './completions.js';
import { runConfig } from './config.js';
import { createClient, mergeCliConfig } from './create-client.js';
import { getUserMessage, toShipError } from './error-handling.js';
import { formatOutput, type OutputContext } from './formatters.js';
import { loadShipFile } from './shiprc.js';
import type {
  CLIResult,
  DeployCommandOptions,
  GlobalOptions,
  LabelOptions,
  ListCommandOptions,
  TokenCreateCommandOptions,
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
 * Argument parser for integer option values (`--ttl`, `--limit`). A mangled
 * number must fail HERE with a clear message — a bare `parseInt` once turned
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

/**
 * Merge label options from command and program levels.
 * Commander.js sometimes routes --label to program level instead of command level.
 */
function mergeLabelOption(
  cmdOptions: LabelOptions | undefined,
  programOpts: LabelOptions | undefined,
): string[] | undefined {
  const labels = cmdOptions?.label?.length ? cmdOptions.label : programOpts?.label;
  if (!labels?.length) return undefined;
  // Filter empty strings: --label '' means "clear all labels"
  const filtered = labels.filter((l) => l !== '');
  return filtered.length ? filtered : [];
}

/**
 * Merge password options from command and program levels.
 * Commander.js sometimes routes --password to program level instead of command level.
 *
 * An empty `--password ''` is forwarded to the SDK validator so the user
 * sees a clear length error rather than a silent drop. An empty
 * `SHIP_PASSWORD` is coerced to undefined, matching how SHIP_TOKEN
 * and SHIP_API_URL treat empty env vars (CI/Docker
 * often sets unset vars to "" — see core/config.ts).
 */
function mergePasswordOption(
  cmdOptions: { password?: string } | undefined,
  programOpts: { password?: string } | undefined,
): string | undefined {
  return cmdOptions?.password ?? programOpts?.password ?? (process.env.SHIP_PASSWORD || undefined);
}

/**
 * Process CLI options using Commander's built-in option merging.
 * Applies CLI-specific transformations (validation is done in preAction hook).
 */
function processOptions(command: Command): GlobalOptions {
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

  return options as GlobalOptions;
}

/**
 * What a command GROUP does when none of its own subcommands matched: name the
 * unknown word, then print scoped usage rather than the whole front page — the
 * user already knows which group they are in.
 *
 * **It states nothing about the tree.** Commander binds `this` to the command
 * and collects the leftover words in `this.args`, so the group's name and its
 * subcommands are read from the tree at parse time, exactly as the completion
 * renderer reads them. This took `(parentName, validSubcommands[])` by hand
 * until 2026-07-30 and was the last hand-written restatement of a tree
 * `buildProgram()` already holds — the fifth statement after the three shell
 * scripts that `completions.ts` deleted, and stale in the same way for the same
 * reason: `ship tokens get` shipped on 2026-07-28, the array beside it was not
 * updated, and `ship tokens bogus` answered `usage: ship tokens
 * <list|create|delete>` while the derived completion one module over offered
 * all four. A list that cannot be edited cannot drift.
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

/**
 * The credential the CLI actually resolved (flag > env > file). The error
 * path must diagnose with the same lens the client was built with — a user
 * whose `SHIP_TOKEN` or `.shiprc` token was rejected is credentialed, and
 * the anonymous-user hint would misdiagnose their failure. A config file
 * that fails to load counts as no file credential: that failure is already
 * the error being reported.
 */
function resolveCliToken(flags: {
  config?: string;
  apiUrl?: string;
  token?: string;
}): string | undefined {
  let file = {};
  try {
    file = loadShipFile(flags.config);
  } catch {}
  // Flags, env, and files only ever hold strings — provider functions exist
  // solely as constructor arguments, which the CLI never passes.
  const token = mergeCliConfig(flags, readEnvConfig(), file).token;
  return typeof token === 'string' ? token : undefined;
}

/** Spinner instance type from yocto-spinner */
interface Spinner {
  start(): Spinner;
  stop(): void;
}

/**
 * Common deploy logic used by both shortcut and explicit commands.
 */
async function performDeploy(
  client: Ship,
  deployPath: string,
  labels: string[] | undefined,
  password: string | undefined,
  cmdOptions: DeployCommandOptions | undefined,
  globalOptions: GlobalOptions,
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
    via: string;
    labels?: string[];
    password?: string;
    pathDetect?: boolean;
    spaDetect?: boolean;
    signal?: AbortSignal;
  } = { via: process.env.SHIP_VIA || 'cli' };

  // Handle labels
  if (labels !== undefined) deployOptions.labels = labels;

  // Empty password strings flow through to the SDK validator (clear length
  // error) instead of being silently dropped.
  if (password !== undefined) deployOptions.password = password;

  // Handle detection flags
  if (cmdOptions?.noPathDetect !== undefined) {
    deployOptions.pathDetect = !cmdOptions.noPathDetect;
  }
  if (cmdOptions?.noSpaDetect !== undefined) {
    deployOptions.spaDetect = !cmdOptions.noSpaDetect;
  }

  // Cancellation support
  const abortController = new AbortController();
  deployOptions.signal = abortController.signal;

  // Spinner (TTY only, not JSON, not --no-color)
  let spinner: Spinner | null = null;
  if (
    process.stdout.isTTY &&
    !globalOptions.json &&
    !globalOptions.quiet &&
    !globalOptions.noColor
  ) {
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
   * path took it too until 2026-07-29, and ignored it (`getUserMessage`'s
   * parameter was literally `_context`). It could not have used it either — the
   * wire message already names the resource, which is exactly why the CLI
   * relays it.
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
  program.hook('preAction', (thisCommand) => {
    const options = processOptions(thisCommand);

    try {
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

  deploymentsCmd
    .command('upload <path>')
    .description('Upload deployment from file or directory')
    .passThroughOptions()
    .option('--label <label>', 'Label to add (can be repeated)', collect, [])
    .option('--password <password>', 'Password-protect this deployment')
    .option('--no-path-detect', 'Disable automatic path optimization and flattening')
    .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
    .action(
      withErrorHandling(
        (
          client: Ship,
          options: GlobalOptions,
          deployPath: string,
          cmdOptions: DeployCommandOptions,
        ) =>
          performDeploy(
            client,
            deployPath,
            mergeLabelOption(cmdOptions, program.opts() as LabelOptions),
            mergePasswordOption(cmdOptions, program.opts() as { password?: string }),
            cmdOptions,
            options,
          ),
        { operation: 'upload', resource: 'deployment' },
      ),
    );

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
        async (
          client: Ship,
          _options: GlobalOptions,
          deployment: string,
          cmdOptions: LabelOptions,
        ) => {
          const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions) || [];
          return client.deployments.set(deployment, { labels });
        },
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
          _options: GlobalOptions,
          name: string,
          deployment: string | undefined,
          cmdOptions: LabelOptions,
        ) => {
          // Read deployment from stdin when piped (e.g., ship ./dist -q | ship domains set mysite.com)
          if (!deployment && !process.stdin.isTTY) {
            deployment = await new Promise<string | undefined>((resolve) => {
              let data = '';
              process.stdin.on('data', (chunk) => (data += chunk));
              process.stdin.on('end', () => resolve(data.trim() || undefined));
            });
          }

          const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions);

          const setOptions: { deployment?: string; labels?: string[] } = {};
          if (deployment) setOptions.deployment = deployment;
          if (labels !== undefined) setOptions.labels = labels;

          // SDK returns DomainSetResult (Domain + isCreate derived from HTTP 201/200) —
          // the resource interface in @shipstatic/types declares this directly, no cast needed.
          const result = await client.domains.set(name, setOptions);

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
    .option('--ttl <seconds>', 'Time to live in seconds (default: never expires)', parseInteger)
    .option('--label <label>', 'Label to set (can be repeated)', collect, [])
    .action(
      withErrorHandling(
        (client: Ship, _options: GlobalOptions, cmdOptions: TokenCreateCommandOptions) => {
          const options: { ttl?: number; labels?: string[] } = {};
          if (cmdOptions?.ttl !== undefined) options.ttl = cmdOptions.ttl;
          const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions);
          if (labels !== undefined) options.labels = labels;
          return client.tokens.create(options);
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

  // Deploy shortcut as default action. Two cases are answered BEFORE the
  // wrapped handler, so no client is created and no config file is resolved
  // for them: no argument (that is help, not a deploy) and an argument that
  // is a mistyped COMMAND rather than a path — a user with a broken config
  // file must still be told "unknown command", not handed a config error.
  const deployShortcut = withErrorHandling(
    (client: Ship, options: GlobalOptions, deployPath: string, cmdOptions?: DeployCommandOptions) =>
      performDeploy(
        client,
        deployPath,
        mergeLabelOption(cmdOptions, program.opts() as LabelOptions),
        mergePasswordOption(cmdOptions, program.opts() as { password?: string }),
        cmdOptions,
        options,
      ),
    { operation: 'upload', resource: 'deployment' },
  );

  program
    .argument('[path]', 'Path to deploy')
    .option('--label <label>', 'Label to add (can be repeated)', collect, [])
    .option('--password <password>', 'Password-protect this deployment')
    .option('--no-path-detect', 'Disable automatic path optimization and flattening')
    .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
    .action(async function (this: Command, deployPath?: string, cmdOptions?: DeployCommandOptions) {
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

      return deployShortcut.call(this, deployPath, cmdOptions);
    });

  return program;
}
