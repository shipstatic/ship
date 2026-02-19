/**
 * @file Main entry point for the Ship CLI.
 */
import { Command } from 'commander';
import { Ship } from '../index.js';
import { ShipError, validateApiKey, validateDeployToken, validateApiUrl, isShipError, type Deployment } from '@shipstatic/types';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { success, error } from './utils.js';
import { formatOutput, type OutputContext } from './formatters.js';
import { installCompletion, uninstallCompletion } from './completion.js';
import { runConfig } from './config.js';
import { getUserMessage, toShipError, formatErrorJson } from './error-handling.js';
import { bold, dim } from 'yoctocolors';
import type { GlobalOptions, DeployCommandOptions, LabelOptions, TokenCreateCommandOptions, CLIResult } from './types.js';
import type { DomainSetResult } from '../../shared/types.js';

// Load package.json for version
function loadPackageJson(): { version: string } {
  const paths = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json')
  ];
  for (const p of paths) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch {}
  }
  return { version: '0.0.0' };
}

const packageJson = loadPackageJson();



const program = new Command();

// Override Commander.js error handling while preserving help/version behavior
program
  .exitOverride((err) => {
    // Only override actual errors, not help/version exits
    if (err.code === 'commander.help' || err.code === 'commander.version' || err.exitCode === 0) {
      process.exit(err.exitCode || 0);
    }

    const globalOptions = processOptions(program);

    let message = err.message || 'unknown command error';
    message = message
      .replace(/^error: /, '')
      .replace(/\n.*/, '')
      .replace(/\.$/, '')
      .toLowerCase();

    error(message, globalOptions.json, globalOptions.noColor);

    if (!globalOptions.json) {
      displayHelp(globalOptions.noColor);
    }

    process.exit(err.exitCode || 1);
  })
  .configureOutput({
    writeErr: (str) => {
      if (!str.startsWith('error:')) {
        process.stderr.write(str);
      }
    },
    writeOut: (str) => process.stdout.write(str)
  });


/**
 * Display comprehensive help information for all commands
 */
function displayHelp(noColor?: boolean) {
  const applyBold = (text: string) => noColor ? text : bold(text);
  const applyDim = (text: string) => noColor ? text : dim(text);
  
  const output = `${applyBold('USAGE')}
  ship <path>               🚀 Deploy static sites with simplicity

${applyBold('COMMANDS')}
  📦 ${applyBold('Deployments')}
  ship deployments list                 List all deployments
  ship deployments create <path>        Create deployment from directory
  ship deployments get <id>             Show deployment information
  ship deployments set <id>             Set deployment labels
  ship deployments remove <id>          Delete deployment permanently

  🌎 ${applyBold('Domains')}
  ship domains list                     List all domains
  ship domains set <name> [deployment]  Create domain, link to deployment, or update labels
  ship domains get <name>               Show domain information
  ship domains validate <name>          Check if domain name is valid and available
  ship domains verify <name>            Trigger DNS verification for external domain
  ship domains remove <name>            Delete domain permanently

  🔑 ${applyBold('Tokens')}
  ship tokens list                      List all deploy tokens
  ship tokens create                    Create a new deploy token
  ship tokens remove <token>            Delete token permanently

  ⚙️  ${applyBold('Setup')}
  ship config                           Create or update ~/.shiprc configuration
  ship whoami                           Get current account information

  🛠️  ${applyBold('Completion')}
  ship completion install               Install shell completion script
  ship completion uninstall             Uninstall shell completion script

${applyBold('FLAGS')}
  --api-key <key>           API key for authenticated deployments
  --deploy-token <token>    Deploy token for single-use deployments
  --config <file>           Custom config file path
  --no-path-detect          Disable automatic path optimization and flattening
  --no-spa-detect           Disable automatic SPA detection and configuration
  --no-color                Disable colored output
  --json                    Output results in JSON format
  --version                 Show version information

${applyDim('Please report any issues to https://github.com/shipstatic/ship/issues')}
`;

  console.log(output);
}

/**
 * Collector function for Commander.js to accumulate repeated option values.
 * Used for --label flag that can be specified multiple times.
 */
function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

/**
 * Merge label options from command and program levels.
 * Commander.js sometimes routes --label to program level instead of command level.
 */
function mergeLabelOption(cmdOptions: LabelOptions | undefined, programOpts: LabelOptions | undefined): string[] | undefined {
  const labels = cmdOptions?.label?.length ? cmdOptions.label : programOpts?.label;
  return labels?.length ? labels : undefined;
}

/**
 * Handle unknown subcommand for parent commands.
 * Shows error for unknown subcommand, then displays help.
 */
function handleUnknownSubcommand(validSubcommands: string[]): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const globalOptions = processOptions(program);

    // Get the command object (last argument) - Commander passes it as the final arg
    const commandObj = args[args.length - 1] as { args?: string[] } | undefined;

    // Check if an unknown subcommand was provided
    if (commandObj?.args?.length) {
      const unknownArg = commandObj.args.find((arg) => !validSubcommands.includes(arg));
      if (unknownArg) {
        error(`unknown command '${unknownArg}'`, globalOptions.json, globalOptions.noColor);
      }
    }

    displayHelp(globalOptions.noColor);
    process.exit(1);
  };
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

  return options as GlobalOptions;
}

/**
 * Error handler - outputs errors consistently in text or JSON format.
 * Message formatting is delegated to the error-handling module.
 */
function handleError(
  err: unknown,
  context?: OutputContext
) {
  const opts = processOptions(program);
  const shipError = toShipError(err);

  // Get user-facing message using the extracted pure function
  const message = getUserMessage(shipError, context, {
    apiKey: opts.apiKey,
    deployToken: opts.deployToken
  });

  // Output in appropriate format
  if (opts.json) {
    console.error(formatErrorJson(message, shipError.details) + '\n');
  } else {
    error(message, false, opts.noColor);
    // Show help only for unknown command errors (user CLI mistake)
    if (shipError.isValidationError() && message.includes('unknown command')) {
      displayHelp(opts.noColor);
    }
  }

  process.exit(1);
}

/**
 * Wrapper for CLI actions that handles errors and client creation consistently.
 * Reduces boilerplate while preserving context for error handling.
 */
function withErrorHandling<T extends unknown[], R extends CLIResult>(
  handler: (client: Ship, ...args: T) => Promise<R>,
  context?: { operation?: string; resourceType?: string; getResourceId?: (...args: T) => string }
) {
  return async function(this: Command, ...args: T) {
    const globalOptions = processOptions(this);

    // Build context once for both output and error paths
    const resolvedContext: OutputContext = context ? {
      operation: context.operation,
      resourceType: context.resourceType,
      resourceId: context.getResourceId?.(...args)
    } : {};

    try {
      const client = createClient();
      const result = await handler(client, ...args);
      formatOutput(result, resolvedContext, { json: globalOptions.json, noColor: globalOptions.noColor });
    } catch (err) {
      handleError(err, resolvedContext);
    }
  };
}

/**
 * Create Ship client from CLI options
 */
function createClient(): Ship {
  const { config, apiUrl, apiKey, deployToken } = program.opts();
  return new Ship({ configFile: config, apiUrl, apiKey, deployToken });
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
  cmdOptions: DeployCommandOptions | undefined,
  commandContext: Command
): Promise<Deployment> {
  if (!existsSync(deployPath)) {
    throw ShipError.file(`${deployPath} path does not exist`, deployPath);
  }

  const stats = statSync(deployPath);
  if (!stats.isDirectory() && !stats.isFile()) {
    throw ShipError.file(`${deployPath} path must be a file or directory`, deployPath);
  }

  const deployOptions: {
    via: string;
    labels?: string[];
    pathDetect?: boolean;
    spaDetect?: boolean;
    signal?: AbortSignal;
  } = { via: 'cli' };

  // Handle labels
  const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions);
  if (labels) deployOptions.labels = labels;

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
  const globalOptions = processOptions(commandContext);
  if (process.stdout.isTTY && !globalOptions.json && !globalOptions.noColor) {
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
    return await client.deployments.create(deployPath, deployOptions);
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
  }
}



program
  .name('ship')
  .description('🚀 Deploy static sites with simplicity')
  .version(packageJson.version, '--version', 'Show version information')
  .option('--api-key <key>', 'API key for authenticated deployments')
  .option('--deploy-token <token>', 'Deploy token for single-use deployments')
  .option('--config <file>', 'Custom config file path')
  .option('--api-url <url>', 'API URL (for development)')
  .option('--json', 'Output results in JSON format')
  .option('--no-color', 'Disable colored output')
  .option('--help', 'Display help for command')
  .helpOption(false); // Disable default help

// Handle --help flag manually to show custom help
program.hook('preAction', (thisCommand) => {
  const options = processOptions(thisCommand);
  if (options.help) {
    displayHelp(options.noColor);
    process.exit(0);
  }
});

// Validate options early - before any action is executed
program.hook('preAction', (thisCommand) => {
  const options = processOptions(thisCommand);

  try {
    if (options.apiKey && typeof options.apiKey === 'string') {
      validateApiKey(options.apiKey);
    }

    if (options.deployToken && typeof options.deployToken === 'string') {
      validateDeployToken(options.deployToken);
    }

    if (options.apiUrl && typeof options.apiUrl === 'string') {
      validateApiUrl(options.apiUrl);
    }
  } catch (validationError) {
    if (isShipError(validationError)) {
      error(validationError.message, options.json, options.noColor);
      process.exit(1);
    }
    throw validationError;
  }
});

// Ping command
program
  .command('ping')
  .description('Check API connectivity')
  .action(withErrorHandling((client: Ship) => client.ping()));

// Whoami shortcut - alias for account get
program
  .command('whoami')
  .description('Get current account information')
  .action(withErrorHandling(
    (client: Ship) => client.whoami(),
    { operation: 'get', resourceType: 'Account' }
  ));

// Deployments commands
const deploymentsCmd = program
  .command('deployments')
  .description('Manage deployments')
  .enablePositionalOptions()
  .action(handleUnknownSubcommand(['list', 'create', 'get', 'set', 'remove']));

deploymentsCmd
  .command('list')
  .description('List all deployments')
  .action(withErrorHandling((client: Ship) => client.deployments.list()));

deploymentsCmd
  .command('create <path>')
  .description('Create deployment from file or directory')
  .passThroughOptions()
  .option('--label <label>', 'Label to add (can be repeated)', collect, [])
  .option('--no-path-detect', 'Disable automatic path optimization and flattening')
  .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
  .action(withErrorHandling(
    function(this: Command, client: Ship, deployPath: string, cmdOptions: DeployCommandOptions) {
      return performDeploy(client, deployPath, cmdOptions, this);
    },
    { operation: 'create' }
  ));

deploymentsCmd
  .command('get <deployment>')
  .description('Show deployment information')
  .action(withErrorHandling(
    (client: Ship, deployment: string) => client.deployments.get(deployment),
    { operation: 'get', resourceType: 'Deployment', getResourceId: (id: string) => id }
  ));

deploymentsCmd
  .command('set <deployment>')
  .description('Set deployment labels')
  .passThroughOptions()
  .option('--label <label>', 'Label to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    async (client: Ship, deployment: string, cmdOptions: LabelOptions) => {
      const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions) || [];
      return client.deployments.set(deployment, { labels });
    },
    { operation: 'set', resourceType: 'Deployment', getResourceId: (deployment: string) => deployment }
  ));

deploymentsCmd
  .command('remove <deployment>')
  .description('Delete deployment permanently')
  .action(withErrorHandling(
    (client: Ship, deployment: string) => client.deployments.remove(deployment),
    { operation: 'remove', resourceType: 'Deployment', getResourceId: (deployment: string) => deployment }
  ));

// Domains commands
const domainsCmd = program
  .command('domains')
  .description('Manage domains')
  .enablePositionalOptions()
  .action(handleUnknownSubcommand(['list', 'get', 'set', 'validate', 'verify', 'remove']));

domainsCmd
  .command('list')
  .description('List all domains')
  .action(withErrorHandling((client: Ship) => client.domains.list()));

domainsCmd
  .command('get <name>')
  .description('Show domain information')
  .action(withErrorHandling(
    (client: Ship, name: string) => client.domains.get(name),
    { operation: 'get', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('validate <name>')
  .description('Check if domain name is valid and available')
  .action(withErrorHandling(
    (client: Ship, name: string) => client.domains.validate(name),
    { operation: 'validate', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('verify <name>')
  .description('Trigger DNS verification for external domain')
  .action(withErrorHandling(
    (client: Ship, name: string) => client.domains.verify(name),
    { operation: 'verify', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('set <name> [deployment]')
  .description('Create domain, link to deployment, or update labels')
  .passThroughOptions()
  .option('--label <label>', 'Label to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    async (client: Ship, name: string, deployment: string | undefined, cmdOptions: LabelOptions) => {
      const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions);

      const options: { deployment?: string; labels?: string[] } = {};
      if (deployment) options.deployment = deployment;
      if (labels && labels.length > 0) options.labels = labels;

      // SDK returns DomainSetResult (Domain + isCreate derived from HTTP 201/200)
      const result = await client.domains.set(name, options) as DomainSetResult;

      // Enrich with DNS info for new external domains (pure formatter will display it)
      if (result.isCreate && name.includes('.')) {
        try {
          const [records, share] = await Promise.all([
            client.domains.records(name),
            client.domains.share(name)
          ]);
          return {
            ...result,
            _dnsRecords: records.records,
            _shareHash: share.hash
          };
        } catch {
          // Graceful degradation - return without DNS info
        }
      }
      return result;
    },
    { operation: 'set', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('remove <name>')
  .description('Delete domain permanently')
  .action(withErrorHandling(
    (client: Ship, name: string) => client.domains.remove(name),
    { operation: 'remove', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

// Tokens commands
const tokensCmd = program
  .command('tokens')
  .description('Manage deploy tokens')
  .enablePositionalOptions()
  .action(handleUnknownSubcommand(['list', 'create', 'remove']));

tokensCmd
  .command('list')
  .description('List all tokens')
  .action(withErrorHandling((client: Ship) => client.tokens.list()));

tokensCmd
  .command('create')
  .description('Create a new deploy token')
  .option('--ttl <seconds>', 'Time to live in seconds (default: never expires)', parseInt)
  .option('--label <label>', 'Label to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    (client: Ship, cmdOptions: TokenCreateCommandOptions) => {
      const options: { ttl?: number; labels?: string[] } = {};
      if (cmdOptions?.ttl !== undefined) options.ttl = cmdOptions.ttl;
      const labels = mergeLabelOption(cmdOptions, program.opts() as LabelOptions);
      if (labels && labels.length > 0) options.labels = labels;
      return client.tokens.create(options);
    },
    { operation: 'create', resourceType: 'Token' }
  ));

tokensCmd
  .command('remove <token>')
  .description('Delete token permanently')
  .action(withErrorHandling(
    (client: Ship, token: string) => client.tokens.remove(token),
    { operation: 'remove', resourceType: 'Token', getResourceId: (token: string) => token }
  ));

// Account commands
const accountCmd = program
  .command('account')
  .description('Manage account')
  .action(handleUnknownSubcommand(['get']));

accountCmd
  .command('get')
  .description('Show account information')
  .action(withErrorHandling(
    (client: Ship) => client.whoami(),
    { operation: 'get', resourceType: 'Account' }
  ));

// Completion commands
const completionCmd = program
  .command('completion')
  .description('Setup shell completion')
  .action(handleUnknownSubcommand(['install', 'uninstall']));

completionCmd
  .command('install')
  .description('Install shell completion script')
  .action(() => {
    const options = processOptions(program);
    const scriptDir = path.resolve(__dirname, 'completions');
    installCompletion(scriptDir, { json: options.json, noColor: options.noColor });
  });

completionCmd
  .command('uninstall')
  .description('Uninstall shell completion script')
  .action(() => {
    const options = processOptions(program);
    uninstallCompletion({ json: options.json, noColor: options.noColor });
  });

// Config command
program
  .command('config')
  .description('Create or update ~/.shiprc configuration')
  .action(async () => {
    const options = processOptions(program);
    try {
      await runConfig({ noColor: options.noColor, json: options.json });
    } catch (err) {
      handleError(err);
    }
  });


// Deploy shortcut as default action
program
  .argument('[path]', 'Path to deploy')
  .option('--label <label>', 'Label to add (can be repeated)', collect, [])
  .option('--no-path-detect', 'Disable automatic path optimization and flattening')
  .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
  .action(withErrorHandling(
    async function(this: Command, client: Ship, deployPath?: string, cmdOptions?: DeployCommandOptions) {
      if (!deployPath) {
        displayHelp(processOptions(program).noColor);
        process.exit(0);
      }

      // Check if the argument is a valid path by checking filesystem
      // This correctly handles paths like "dist", "build", "public" without slashes
      if (!existsSync(deployPath)) {
        // Path doesn't exist - could be unknown command or typo
        // Check if it looks like a command (no path separators, no extension)
        const looksLikeCommand = !deployPath.includes('/') && !deployPath.includes('\\') &&
                                  !deployPath.includes('.') && !deployPath.startsWith('~');
        if (looksLikeCommand) {
          throw ShipError.validation(`unknown command '${deployPath}'`);
        }
        // Otherwise let performDeploy handle the "path does not exist" error
      }

      return performDeploy(client, deployPath, cmdOptions, this);
    },
    { operation: 'create' }
  ));



/**
 * Simple completion handler - no self-invocation, just static completions
 */
function handleCompletion() {
  const args = process.argv;
  const isBash = args.includes('--compbash');
  const isZsh = args.includes('--compzsh');
  const isFish = args.includes('--compfish');

  if (!isBash && !isZsh && !isFish) return;

  const completions = ['ping', 'whoami', 'deployments', 'domains', 'tokens', 'account', 'config', 'completion'];
  console.log(completions.join(isFish ? '\n' : ' '));
  process.exit(0);
}

// Handle completion requests (before any other processing)
if (process.env.NODE_ENV !== 'test' && (process.argv.includes('--compbash') || process.argv.includes('--compzsh') || process.argv.includes('--compfish'))) {
  handleCompletion();
}

// Handle main CLI parsing
if (process.env.NODE_ENV !== 'test') {
  try {
    program.parse(process.argv);
  } catch (err) {
    // Commander.js errors are already handled by exitOverride above
    // This catch is for safety - check if it's a Commander error
    if (err instanceof Error && 'code' in err) {
      const code = (err as Error & { code?: string }).code;
      const exitCode = (err as Error & { exitCode?: number }).exitCode;
      if (code?.startsWith('commander.')) {
        process.exit(exitCode || 1);
      }
    }
    throw err;
  }
}