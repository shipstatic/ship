/**
 * @file Main entry point for the Ship CLI.
 * Ultra-simple CLI with explicit commands and deploy shortcut.
 */
import { Command } from 'commander';
import { Ship, ShipError } from '../index.js';
import { validateApiKey, validateDeployToken, validateApiUrl } from '@shipstatic/types';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { formatTable, formatDetails, success, error, info, warn } from './utils.js';
import { getUserMessage, ensureShipError, formatErrorJson, type ErrorContext } from './error-handling.js';
import { bold, dim } from 'yoctocolors';
// Removed tabtab dependency - now using custom completion script
import * as fs from 'fs';
import * as os from 'os';

// Get package.json data for version information using robust path resolution
let packageJson: any = { version: '0.0.0' };

try {
  // For the built CLI, package.json is always one level up from the dist directory
  // This is more reliable than hardcoded multiple fallback paths
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
} catch (error) {
  // Fallback for development/testing scenarios where the structure might differ
  const developmentPath = path.resolve(__dirname, '../../package.json');
  try {
    packageJson = JSON.parse(readFileSync(developmentPath, 'utf-8'));
  } catch (fallbackError) {
    // Final fallback - use default version
    // This is better than silent failure as it gives visibility into the issue
  }
}



const program = new Command();

// Override Commander.js error handling while preserving help/version behavior
program
  .exitOverride((err) => {
    // Only override actual errors, not help/version exits
    if (err.code === 'commander.help' || err.code === 'commander.version' || err.exitCode === 0) {
      process.exit(err.exitCode || 0);
    }
    
    const globalOptions = program.opts();
    
    // Extract the actual error message from Commander.js error
    let message = err.message || 'unknown command error';
    
    // Clean up common Commander.js error messages
    message = message
      .replace(/^error: /, '') // Remove Commander's error prefix
      .replace(/\n.*/, '') // Keep only the first line
      .replace(/\.$/, '') // Remove trailing period
      .toLowerCase(); // Make lowercase
    
    // Route through our error function for consistent formatting
    error(message, globalOptions.json, globalOptions.noColor);
    
    // Show help after error (unless in JSON mode)
    if (!globalOptions.json) {
      displayHelp(globalOptions.noColor);
    }
    
    process.exit(err.exitCode || 1);
  })
  .configureOutput({
    // Suppress Commander's default error output - we handle it in exitOverride
    writeErr: (str) => {
      // Only suppress error output, allow help/version to go through
      if (!str.startsWith('error:')) {
        process.stderr.write(str);
      }
    },
    writeOut: (str) => process.stdout.write(str)
  });

// CLI formatting helpers are imported from utils.js


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
  ship deployments create <path>        Create deployment from file or directory
  ship deployments get <deployment>     Show deployment information
  ship deployments remove <deployment>  Delete deployment permanently

  🌎 ${applyBold('Domains')}
  ship domains list                     List all domains
  ship domains set <name> <deployment>  Create or update domain pointing to deployment
  ship domains get <name>               Show domain information
  ship domains confirm <name>           Manually trigger DNS confirmation for external domain
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
 * Create Ship client with synchronous constructor
 */
function createClient(): Ship {
  const options = program.opts();
  const shipOptions: any = {};
  
  // Only include options that are actually set (not undefined)
  if (options.config !== undefined) {
    shipOptions.configFile = options.config;
  }
  if (options.apiUrl !== undefined) {
    shipOptions.apiUrl = options.apiUrl;
  }
  if (options.apiKey !== undefined) {
    shipOptions.apiKey = options.apiKey;
  }
  if (options.deployToken !== undefined) {
    shipOptions.deployToken = options.deployToken;
  }
  
  // Use synchronous constructor - initialization happens lazily
  return new Ship(shipOptions);
}

/**
 * Human-readable formatters for different result types
 */
const formatters = {
  deployments: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    if (!result.deployments || result.deployments.length === 0) {
      if (isJson) {
        console.log(JSON.stringify({ deployments: [] }, null, 2));
      } else {
        console.log('no deployments found');
        console.log();
      }
      return;
    }
    
    // For deployments list: show url (as "deployment"), tags, created
    const listColumns = ['url', 'tags', 'created'];
    console.log(formatTable(result.deployments, listColumns, noColor, { url: 'deployment' }));
  },
  domains: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    if (!result.domains || result.domains.length === 0) {
      if (isJson) {
        console.log(JSON.stringify({ domains: [] }, null, 2));
      } else {
        console.log('no domains found');
        console.log();
      }
      return;
    }

    // For domains list: show url (as "domain"), deployment, tags, created
    const listColumns = ['url', 'deployment', 'tags', 'created'];
    console.log(formatTable(result.domains, listColumns, noColor, { url: 'domain' }));
  },
  domain: async (result: any, context?: { operation?: string; client?: Ship }, isJson?: boolean, noColor?: boolean) => {
    // Always show success message for domain operations, particularly 'set'
    if (result.domain) {
      const operation = result.isCreate ? 'created' : 'updated';
      success(`${result.domain} domain ${operation}`, isJson, noColor);
    }

    // For external domains that were just created and not confirmed, fetch DNS info
    if (!isJson && result.isCreate && result.domain?.includes('.') && !result.confirmed && context?.client) {
      try {
        // Fetch records and share info in parallel
        const [records, share] = await Promise.all([
          context.client.domains.records(result.domain),
          context.client.domains.share(result.domain)
        ]);

        // Display DNS records
        if (records.records && records.records.length > 0) {
          console.log();
          info('DNS Records to configure:', isJson, noColor);
          records.records.forEach((record: any) => {
            console.log(`  ${record.type}: ${record.name} → ${record.value}`);
          });
        }

        // Display instructions link
        if (share.hash) {
          const instructionsUrl = `https://setup.shipstatic.com/${share.hash}/${result.domain}`;
          console.log();
          info(`Setup instructions: ${instructionsUrl}`, isJson, noColor);
        }
      } catch (err) {
        // Fallback to generic message if fetching fails
        console.log();
        warn(`To complete setup, configure DNS records for ${result.domain}`, isJson, noColor);
      }
    }

    console.log();
    console.log(formatDetails(result, noColor));
  },
  deployment: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    // Show success message for create operations only
    if (result.status && context?.operation === 'create') {
      success(`${result.deployment} deployment created ✨`, isJson, noColor);
    }
    console.log(formatDetails(result, noColor));
  },
  email: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    console.log(formatDetails(result, noColor));
  },
  message: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    // Handle messages from operations like DNS check
    if (result.message) {
      success(result.message, isJson, noColor);
    }
  }
};

/**
 * Common deploy logic used by both shortcut and explicit commands
 */
async function performDeploy(client: Ship, path: string, cmdOptions: any, commandContext?: any): Promise<any> {
  // Validate path exists before proceeding
  if (!existsSync(path)) {
    throw ShipError.file(`${path} path does not exist`, path);
  }
  
  // Check if path is a file or directory
  const stats = statSync(path);
  if (!stats.isDirectory() && !stats.isFile()) {
    throw ShipError.file(`${path} path must be a file or directory`, path);
  }
  
  const deployOptions: any = {};

  // Handle tags option - Commander.js collect gives us an array directly
  if (cmdOptions?.tag && cmdOptions.tag.length > 0) {
    deployOptions.tags = cmdOptions.tag;
  }

  // Handle path detection flag
  if (cmdOptions?.noPathDetect !== undefined) {
    deployOptions.pathDetect = !cmdOptions.noPathDetect;
  }

  // Handle SPA detection flag
  if (cmdOptions?.noSpaDetect !== undefined) {
    deployOptions.spaDetect = !cmdOptions.noSpaDetect;
  }
  
  // Set up cancellation support using SDK's built-in AbortController
  const abortController = new AbortController();
  deployOptions.signal = abortController.signal;
  
  // Display upload pending message
  let spinner: any = null;
  
  // Show spinner only in TTY (not piped), not in JSON mode, and not with --no-color (script parsing)
  const globalOptions = commandContext ? processOptions(commandContext) : {};
  if (process.stdout.isTTY && !globalOptions.json && !globalOptions.noColor) {
    const { default: yoctoSpinner } = await import('yocto-spinner');
    spinner = yoctoSpinner({ text: 'uploading…' }).start();
  }
  
  // Handle Ctrl+C by aborting the request
  const sigintHandler = () => {
    abortController.abort();
    if (spinner) spinner.stop();
    process.exit(130);
  };
  process.on('SIGINT', sigintHandler);
  
  try {
    const result = await client.deployments.create(path, deployOptions);
    
    // Cleanup
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
    
    return result;
  } catch (error) {
    // Cleanup on error
    process.removeListener('SIGINT', sigintHandler);
    if (spinner) spinner.stop();
    throw error;
  }
}

/**
 * Format output based on --json flag
 */
async function output(result: any, context?: { operation?: string; resourceType?: string; resourceId?: string; client?: Ship }, options?: any) {
  const opts = options || program.opts();

  // Handle void/undefined results (removal operations)
  if (result === undefined) {
    if (context?.operation === 'remove' && context.resourceType && context.resourceId) {
      success(`${context.resourceId} ${context.resourceType.toLowerCase()} removed`, opts.json, opts.noColor);
    } else {
      success('removed successfully', opts.json, opts.noColor);
    }
    return;
  }

  // Handle ping result (boolean or object with success property)
  if (result === true || (result && typeof result === 'object' && result.hasOwnProperty('success'))) {
    const isSuccess = result === true || result.success;
    if (isSuccess) {
      success('api reachable', opts.json, opts.noColor);
    } else {
      error('api unreachable', opts.json, opts.noColor);
    }
    return;
  }

  // For regular results in JSON mode, output the raw JSON
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    console.log();
    return;
  }

  // Find appropriate formatter based on result properties (non-JSON mode)
  // Explicit lookup order for deterministic behavior
  const formatterOrder: (keyof typeof formatters)[] = ['deployments', 'domains', 'domain', 'deployment', 'email', 'message'];
  for (const key of formatterOrder) {
    if (result[key]) {
      await formatters[key](result, context, opts.json, opts.noColor);
      return;
    }
  }

  // Default fallback
  success('success', opts.json, opts.noColor);
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
  .action(withErrorHandling((client) => client.ping()));

// Whoami shortcut - alias for account get
program
  .command('whoami')
  .description('Get current account information')
  .action(withErrorHandling(
    (client) => client.whoami(),
    { operation: 'get', resourceType: 'Account' }
  ));

// Deployments commands
const deploymentsCmd = program
  .command('deployments')
  .description('Manage deployments')
  .action(handleUnknownSubcommand(['list', 'create', 'get', 'remove']));

deploymentsCmd
  .command('list')
  .description('List all deployments')
  .action(withErrorHandling((client) => client.deployments.list()));

deploymentsCmd
  .command('create <path>')
  .description('Create deployment from file or directory')
  .option('--tag <tag>', 'Tag to add (can be repeated)', collect, [])
  .option('--no-path-detect', 'Disable automatic path optimization and flattening')
  .option('--no-spa-detect', 'Disable automatic SPA detection and configuration')
  .action(withErrorHandling(
    function(this: any, client: Ship, path: string, cmdOptions: any) {
      return performDeploy(client, path, cmdOptions, this);
    },
    { operation: 'create' }
  ));

deploymentsCmd
  .command('get <deployment>')
  .description('Show deployment information')
  .action(withErrorHandling(
    (client, deployment: string) => client.deployments.get(deployment),
    { operation: 'get', resourceType: 'Deployment', getResourceId: (deployment: string) => deployment }
  ));

deploymentsCmd
  .command('remove <deployment>')
  .description('Delete deployment permanently')
  .action(withErrorHandling(
    (client, deployment: string) => client.deployments.remove(deployment),
    { operation: 'remove', resourceType: 'Deployment', getResourceId: (deployment: string) => deployment }
  ));

// Domains commands
const domainsCmd = program
  .command('domains')
  .description('Manage domains')
  .action(handleUnknownSubcommand(['list', 'get', 'set', 'confirm', 'remove']));

domainsCmd
  .command('list')
  .description('List all domains')
  .action(withErrorHandling((client) => client.domains.list()));

domainsCmd
  .command('get <name>')
  .description('Show domain information')
  .action(withErrorHandling(
    (client, name: string) => client.domains.get(name),
    { operation: 'get', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('confirm <name>')
  .description('Trigger DNS confirmation for external domain')
  .action(withErrorHandling(
    (client, name: string) => client.domains.confirm(name),
    { operation: 'confirm', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('set <name> <deployment>')
  .description('Create or update domain pointing to deployment')
  .option('--tag <tag>', 'Tag to add (can be repeated)', collect, [])
  .action(withErrorHandling(
    (client: Ship, name: string, deployment: string, cmdOptions: any) => {
      // Commander.js collect gives us an array directly
      const tags = cmdOptions?.tag && cmdOptions.tag.length > 0 ? cmdOptions.tag : undefined;
      return client.domains.set(name, deployment, tags);
    },
    { operation: 'set', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

domainsCmd
  .command('remove <name>')
  .description('Delete domain permanently')
  .action(withErrorHandling(
    (client, name: string) => client.domains.remove(name),
    { operation: 'remove', resourceType: 'Domain', getResourceId: (name: string) => name }
  ));

// Tokens commands
const tokensCmd = program
  .command('tokens')
  .description('Manage deploy tokens')
  .action(handleUnknownSubcommand(['list', 'create', 'remove']));

tokensCmd
  .command('list')
  .description('List all tokens')
  .action(withErrorHandling((client) => client.tokens.list()));

tokensCmd
  .command('create')
  .description('Create a new deploy token')
  .option('--ttl <seconds>', 'Time to live in seconds (default: never expires)', parseInt)
  .option('--tag <tag>', 'Tag to add (can be repeated)', collect, [])
  .action(withErrorHandling(
    (client: Ship, cmdOptions: any) => {
      const ttl = cmdOptions?.ttl;
      const tags = cmdOptions?.tag && cmdOptions.tag.length > 0 ? cmdOptions.tag : undefined;
      return client.tokens.create(ttl, tags);
    },
    { operation: 'create', resourceType: 'Token' }
  ));

tokensCmd
  .command('remove <token>')
  .description('Delete token permanently')
  .action(withErrorHandling(
    (client, token: string) => client.tokens.remove(token),
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
    (client) => client.whoami(),
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
  .action(async () => {
    const shell = process.env.SHELL || '';
    const homeDir = os.homedir();
    let installPath: string;
    let profileFile: string;
    let sourceLine: string = '';

    // Resolve the path to the bundled completion scripts
    const bashScriptPath = path.resolve(__dirname, 'completions/ship.bash');
    const zshScriptPath = path.resolve(__dirname, 'completions/ship.zsh');
    const fishScriptPath = path.resolve(__dirname, 'completions/ship.fish');

    try {
      if (shell.includes('bash')) {
        installPath = path.join(homeDir, '.ship_completion.bash');
        profileFile = path.join(homeDir, '.bash_profile');
        sourceLine = `# ship\nsource '${installPath}'\n# ship end`;
        fs.copyFileSync(bashScriptPath, installPath);
      } else if (shell.includes('zsh')) {
        installPath = path.join(homeDir, '.ship_completion.zsh');
        profileFile = path.join(homeDir, '.zshrc');
        sourceLine = `# ship\nsource '${installPath}'\n# ship end`;
        fs.copyFileSync(zshScriptPath, installPath);
      } else if (shell.includes('fish')) {
        const fishCompletionsDir = path.join(homeDir, '.config/fish/completions');
        if (!fs.existsSync(fishCompletionsDir)) {
          fs.mkdirSync(fishCompletionsDir, { recursive: true });
        }
        installPath = path.join(fishCompletionsDir, 'ship.fish');
        fs.copyFileSync(fishScriptPath, installPath);
        const options = program.opts();
        success('fish completion installed successfully', options.json, options.noColor);
        info('please restart your shell to apply the changes', options.json, options.noColor);
        return;
      } else {
        const options = program.opts();
        error(`unsupported shell: ${shell}. could not install completion script`, options.json, options.noColor);
        return;
      }

      // For bash and zsh, we need to add sourcing to profile
      const profileExists = fs.existsSync(profileFile);
      if (profileExists) {
        const profileContent = fs.readFileSync(profileFile, 'utf-8');
        if (!profileContent.includes('# ship') || !profileContent.includes('# ship end')) {
          // Ensure there's a newline before our block if file doesn't end with one
          const needsNewline = profileContent.length > 0 && !profileContent.endsWith('\n');
          const prefix = needsNewline ? '\n' : '';
          fs.appendFileSync(profileFile, prefix + sourceLine);
        }
      } else {
        fs.writeFileSync(profileFile, sourceLine);
      }

      const options = program.opts();
      success(`completion script installed for ${shell.split('/').pop()}`, options.json, options.noColor);
      warn(`run "source ${profileFile}" or restart your shell`, options.json, options.noColor);
    } catch (e: any) {
      const options = program.opts();
      error(`could not install completion script: ${e.message}`, options.json, options.noColor);
      if (shell.includes('bash') || shell.includes('zsh')) {
        warn(`add the following line to your profile file manually\n${sourceLine}`, options.json, options.noColor);
      }
    }
  });

completionCmd
  .command('uninstall')
  .description('Uninstall shell completion script')
  .action(async () => {
    const shell = process.env.SHELL || '';
    const homeDir = os.homedir();
    let installPath: string;
    let profileFile: string;

    try {
      if (shell.includes('bash')) {
        installPath = path.join(homeDir, '.ship_completion.bash');
        profileFile = path.join(homeDir, '.bash_profile');
      } else if (shell.includes('zsh')) {
        installPath = path.join(homeDir, '.ship_completion.zsh');
        profileFile = path.join(homeDir, '.zshrc');
      } else if (shell.includes('fish')) {
        const fishCompletionsDir = path.join(homeDir, '.config/fish/completions');
        installPath = path.join(fishCompletionsDir, 'ship.fish');
        
        // Remove fish completion file
        const options = program.opts();
        if (fs.existsSync(installPath)) {
          fs.unlinkSync(installPath);
          success('fish completion uninstalled successfully', options.json, options.noColor);
        } else {
          warn('fish completion was not installed', options.json, options.noColor);
        }
        info('please restart your shell to apply the changes', options.json, options.noColor);
        return;
      } else {
        const options = program.opts();
        error(`unsupported shell: ${shell}. could not uninstall completion script`, options.json, options.noColor);
        return;
      }

      // Remove completion script file
      if (fs.existsSync(installPath)) {
        fs.unlinkSync(installPath);
      }

      // Remove sourcing line from profile
      if (fs.existsSync(profileFile)) {
        const profileContent = fs.readFileSync(profileFile, 'utf-8');
        const lines = profileContent.split('\n');
        
        // Find and remove the ship block using start/end markers
        const filteredLines: string[] = [];
        let i = 0;
        let removedSomething = false;
        
        while (i < lines.length) {
          const line = lines[i];
          
          // Check if this is the start of a ship block
          if (line.trim() === '# ship') {
            removedSomething = true;
            // Skip all lines until we find the end marker
            i++;
            while (i < lines.length && lines[i].trim() !== '# ship end') {
              i++;
            }
            // Skip the end marker too
            if (i < lines.length && lines[i].trim() === '# ship end') {
              i++;
            }
          } else {
            // Keep this line
            filteredLines.push(line);
            i++;
          }
        }
        
        const options = program.opts();
        if (removedSomething) {
          // Preserve the original file's ending format (with or without final newline)
          const originalEndsWithNewline = profileContent.endsWith('\n');
          let newContent;
          if (filteredLines.length === 0) {
            newContent = '';
          } else if (originalEndsWithNewline) {
            newContent = filteredLines.join('\n') + '\n';
          } else {
            newContent = filteredLines.join('\n');
          }
          fs.writeFileSync(profileFile, newContent);
          success(`completion script uninstalled for ${shell.split('/').pop()}`, options.json, options.noColor);
          warn(`run "source ${profileFile}" or restart your shell`, options.json, options.noColor);
        } else {
          error('completion was not found in profile', options.json, options.noColor);
        }
      } else {
        const options = program.opts();
        error('profile file not found', options.json, options.noColor);
      }
    } catch (e: any) {
      const options = program.opts();
      error(`could not uninstall completion script: ${e.message}`, options.json, options.noColor);
    }
  });


// Deploy shortcut as default action
program
  .argument('[path]', 'Path to deploy')
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