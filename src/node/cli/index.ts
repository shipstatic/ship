/**
 * @file Main entry point for the Ship CLI.
 */
import { Command } from 'commander';
import { Ship, ShipError } from '../index.js';
import { validateApiKey, validateDeployToken, validateApiUrl } from '@shipstatic/types';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { success, error } from './utils.js';
import { formatOutput } from './formatters.js';
import { installCompletion, uninstallCompletion } from './completion.js';
import { getUserMessage, ensureShipError, formatErrorJson, type ErrorContext } from './error-handling.js';
import { bold, dim } from 'yoctocolors';

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
    
    const globalOptions = program.opts();

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
  ship deployments set <id>             Set deployment tags
  ship deployments remove <id>          Delete deployment permanently

  🌎 ${applyBold('Domains')}
  ship domains list                     List all domains
  ship domains set <name> [deployment]  Point domain to deployment, or update tags
  ship domains get <name>               Show domain information
  ship domains verify <name>            Trigger DNS verification for external domain
  ship domains remove <name>            Delete domain permanently

  🔑 ${applyBold('Tokens')}
  ship tokens list                      List all deploy tokens
  ship tokens create                    Create a new deploy token
  ship tokens remove <token>            Delete token permanently

  🦸 ${applyBold('Account')}
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
 * Used for --tag flag that can be specified multiple times.
 */
function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

/**
 * Merge tag options from command and program levels.
 * Commander.js sometimes routes --tag to program level instead of command level.
 */
function mergeTagOption(cmdOptions: any, programOpts: any): string[] | undefined {
  const tags = cmdOptions?.tag?.length > 0 ? cmdOptions.tag : programOpts?.tag;
  return tags?.length > 0 ? tags : undefined;
}

/**
 * Handle unknown subcommand for parent commands.
 * Shows error for unknown subcommand, then displays help.
 */
function handleUnknownSubcommand(validSubcommands: string[]): (...args: any[]) => void {
  return (...args: any[]) => {
    const globalOptions = processOptions(program);

    // Get the command object (last argument)
    const commandObj = args[args.length - 1];

    // Check if an unknown subcommand was provided
    if (commandObj?.args?.length > 0) {
      const unknownArg = commandObj.args.find((arg: string) => !validSubcommands.includes(arg));
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
function processOptions(command: any): any {
  // Use Commander's built-in option merging - much simpler!
  // Use optsWithGlobals() to get both command-level and global options
  const options = command.optsWithGlobals ? command.optsWithGlobals() : command.opts();

  // Convert Commander.js --no-color flag (color: false) to our convention (noColor: true)
  if (options.color === false) {
    options.noColor = true;
  }

  // Note: Validation is handled by the preAction hook to avoid duplication
  return options;
}

/**
 * Error handler - outputs errors consistently in text or JSON format.
 * Message formatting is delegated to the error-handling module.
 */
function handleError(
  err: any,
  context?: ErrorContext
) {
  const opts = program.opts();

  // Wrap non-ShipError instances using the extracted helper
  const shipError = ensureShipError(err);

  // Get user-facing message using the extracted pure function
  const message = getUserMessage(shipError, context, {
    apiKey: opts.apiKey,
    deployToken: opts.deployToken
  });

  // Output in appropriate format
  if (opts.json) {
    console.error(formatErrorJson(message, shipError.details) + '\n');
  } else {
    error(message, opts.json, opts.noColor);
    // Show help only for unknown command errors (user CLI mistake)
    if (shipError.isValidationError() && message.includes('unknown command')) {
      displayHelp(opts.noColor);
    }
  }

  process.exit(1);
}

/**
 * Wrapper for CLI actions that handles errors and client creation consistently
 * Reduces boilerplate while preserving context for error handling
 */
function withErrorHandling<T extends any[], R>(
  handler: (client: Ship, ...args: T) => Promise<R>,
  context?: { operation?: string; resourceType?: string; getResourceId?: (...args: T) => string }
) {
  return async function(this: any, ...args: T) {
    // Process options once at the start (used by both success and error paths)
    const globalOptions = processOptions(this);

    try {
      const client = createClient();
      const result = await handler(client, ...args);

      // Build context for output if provided
      const outputContext = context ? {
        operation: context.operation,
        resourceType: context.resourceType,
        resourceId: context.getResourceId ? context.getResourceId(...args) : undefined,
        client // Pass client for async operations in formatters
      } : { client };

      await output(result, outputContext, globalOptions);
    } catch (err: any) {
      const errorContext = context ? {
        operation: context.operation,
        resourceType: context.resourceType,
        resourceId: context.getResourceId ? context.getResourceId(...args) : undefined
      } : undefined;

      handleError(err, errorContext);
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

/**
 * Common deploy logic used by both shortcut and explicit commands
 */
async function performDeploy(client: Ship, deployPath: string, cmdOptions: any, commandContext?: any): Promise<any> {
  if (!existsSync(deployPath)) {
    throw ShipError.file(`${deployPath} path does not exist`, deployPath);
  }

  const stats = statSync(deployPath);
  if (!stats.isDirectory() && !stats.isFile()) {
    throw ShipError.file(`${deployPath} path must be a file or directory`, deployPath);
  }

  const deployOptions: any = { via: 'cli' };

  // Handle tags
  const tags = mergeTagOption(cmdOptions, program.opts());
  if (tags) deployOptions.tags = tags;

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
  let spinner: any = null;
  const globalOptions = commandContext ? processOptions(commandContext) : {};
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
    const result = await client.deployments.create(deployPath, deployOptions);
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
    return result;
  } catch (err) {
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
    throw err;
  }
}

/**
 * Output result using formatters module
 */
function output(result: any, context: { operation?: string; resourceType?: string; resourceId?: string }, options?: any) {
  const opts = options || program.opts();
  formatOutput(result, context, { isJson: opts.json, noColor: opts.noColor });
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
program.hook('preAction', (thisCommand, actionCommand) => {
  const options = thisCommand.opts();
  if (options.help) {
    const noColor = options.color === false || options.noColor;
    displayHelp(noColor);
    process.exit(0);
  }
});

// Validate options early - before any action is executed
program.hook('preAction', (thisCommand, actionCommand) => {
  const options = thisCommand.opts();
  
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
    if (validationError instanceof ShipError) {
      const noColor = options.color === false || options.noColor;
      error(validationError.message, options.json, noColor);
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
  .option('--tag <tag>', 'Tag to add (can be repeated)', collect, [])
  .option('--no-path-detect', 'Disable automatic path optimization and flattening')
  .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
  .action(withErrorHandling(
    function(this: any, client: Ship, deployPath: string, cmdOptions: any) {
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
  .description('Set deployment tags')
  .passThroughOptions()
  .option('--tag <tag>', 'Tag to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    async (client: Ship, deployment: string, cmdOptions: any) => {
      const tags = mergeTagOption(cmdOptions, program.opts()) || [];
      return client.deployments.set(deployment, { tags });
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
  .action(handleUnknownSubcommand(['list', 'get', 'set', 'verify', 'remove']));

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
  .command('verify <name>')
  .description('Trigger DNS verification for external domain')
  .action(withErrorHandling(
    (client: Ship, name: string) => client.domains.verify(name),
    { operation: 'verify', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('set <name> [deployment]')
  .description('Point domain to deployment, or update tags')
  .passThroughOptions()
  .option('--tag <tag>', 'Tag to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    async (client: Ship, name: string, deployment: string | undefined, cmdOptions: any) => {
      const tags = mergeTagOption(cmdOptions, program.opts());

      // Validate: must provide either deployment or tags
      if (!deployment && (!tags || tags.length === 0)) {
        throw ShipError.validation('Must provide deployment or --tag');
      }

      const options: { deployment?: string; tags?: string[] } = {};
      if (deployment) options.deployment = deployment;
      if (tags && tags.length > 0) options.tags = tags;

      const result = await client.domains.set(name, options);

      // Enrich with DNS info for new external domains (pure formatter will display it)
      if (result.isCreate && name.includes('.') && !result.verified) {
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
  .option('--tag <tag>', 'Tag to set (can be repeated)', collect, [])
  .action(withErrorHandling(
    (client: Ship, cmdOptions: any) => {
      const options: { ttl?: number; tags?: string[] } = {};
      if (cmdOptions?.ttl !== undefined) options.ttl = cmdOptions.ttl;
      const tags = mergeTagOption(cmdOptions, program.opts());
      if (tags && tags.length > 0) options.tags = tags;
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
    const options = program.opts();
    const scriptDir = path.resolve(__dirname, 'completions');
    installCompletion(scriptDir, { isJson: options.json, noColor: options.noColor });
  });

completionCmd
  .command('uninstall')
  .description('Uninstall shell completion script')
  .action(() => {
    const options = program.opts();
    uninstallCompletion({ isJson: options.json, noColor: options.noColor });
  });


// Deploy shortcut as default action
program
  .argument('[path]', 'Path to deploy')
  .option('--tag <tag>', 'Tag to add (can be repeated)', collect, [])
  .option('--no-path-detect', 'Disable automatic path optimization and flattening')
  .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
  .action(withErrorHandling(
    async function(this: any, client: Ship, path?: string, cmdOptions?: any) {
      if (!path) {
        const globalOptions = program.opts();
        // Convert Commander.js --no-color flag (color: false) to our convention (noColor: true)
        const noColor = globalOptions.color === false || globalOptions.noColor;
        displayHelp(noColor);
        process.exit(0);
      }

      // Check if the argument is a valid path by checking filesystem
      // This correctly handles paths like "dist", "build", "public" without slashes
      if (!existsSync(path)) {
        // Path doesn't exist - could be unknown command or typo
        // Check if it looks like a command (no path separators, no extension)
        const looksLikeCommand = !path.includes('/') && !path.includes('\\') &&
                                  !path.includes('.') && !path.startsWith('~');
        if (looksLikeCommand) {
          throw ShipError.validation(`unknown command '${path}'`);
        }
        // Otherwise let performDeploy handle the "path does not exist" error
      }

      return performDeploy(client, path, cmdOptions, this);
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

  const completions = ['ping', 'whoami', 'deployments', 'domains', 'account', 'completion'];
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
  } catch (err: any) {
    // Commander.js errors are already handled by exitOverride above
    // This catch is just for safety - exitOverride should handle all Commander errors
    if (err.code && err.code.startsWith('commander.')) {
      process.exit(err.exitCode || 1);
    }
    throw err;
  }
}