/**
 * @file Main entry point for the Ship CLI.
 * Ultra-simple CLI with explicit commands and deploy shortcut.
 */
import { Command } from 'commander';
import { Ship, ShipError } from '../index.js';
import { validateApiKey, validateApiUrl } from '@shipstatic/types';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { formatTable, formatDetails, success, error, info, warn } from './utils.js';
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

  🌎 ${applyBold('Aliases')}
  ship aliases list                     List all aliases
  ship aliases set <name> <deployment>  Create or update alias pointing to deployment
  ship aliases get <name>               Show alias information
  ship aliases remove <name>            Delete alias permanently

  👨‍🚀 ${applyBold('Account')}
  ship whoami                           Get current account information

  🛠️  ${applyBold('Completion')}
  ship completion install               Install shell completion script
  ship completion uninstall             Uninstall shell completion script

${applyBold('FLAGS')}
  --api-key <key>           API key for authentication
  --config <file>           Custom config file path
  --preserve-dirs           Preserve directory structure in deployment
  --json                    Output results in JSON format
  --no-color                Disable colored output
  --version                 Show version information

${applyDim('Please report any issues to https://github.com/shipstatic/ship/issues')}
`;

  console.log(output);
}

/**
 * Helper to traverse command hierarchy and collect all options
 */
function getAllOptions(command: any): any {
  const options = {};
  let current = command;
  
  // Traverse up the command hierarchy and collect options
  while (current) {
    if (current.opts) {
      // Parent options are applied first, then overridden by child options
      Object.assign(options, current.opts(), options);
    }
    current = current.parent;
  }
  
  // Convert Commander.js --no-color flag (color: false) to our convention (noColor: true)
  if (options.color === false) {
    options.noColor = true;
  }
  
  // Validate options early
  if (options.apiKey && typeof options.apiKey === 'string') {
    validateApiKey(options.apiKey);
  }
  
  if (options.apiUrl && typeof options.apiUrl === 'string') {
    validateApiUrl(options.apiUrl);
  }
  
  return options;
}

/**
 * Error handler using ShipError type guards - all errors should be ShipError instances
 */
function handleError(err: any, context?: { operation?: string; resourceType?: string; resourceId?: string }, options?: any) {
  const opts = options || program.opts();
  // All errors in this codebase should be ShipError instances
  if (!(err instanceof ShipError)) {
    const message = err.message || err;
    
    if (opts.json) {
      console.error(JSON.stringify({ 
        error: message,
        details: { originalError: message }
      }, null, 2));
      console.error();
    } else {
      error(message, undefined, opts.noColor);
      // Show help after error (unless in JSON mode)
      displayHelp(opts.noColor);
    }
    process.exit(1);
  }

  let message = err.message;
  
  // Handle specific error types based on error details
  if (err.details?.data?.error === 'not_found') {
    if (context?.operation === 'remove') {
      const resourceType = context.resourceType || 'resource';
      const resourceId = context.resourceId || '';
      message = `${resourceId} ${resourceType.toLowerCase()} not found`;
    } else {
      // For other operations (like aliases set), use consistent format
      const originalMessage = err.details.data.message || 'Resource not found';
      // Convert "Deployment X not found" to "Deployment not found: X" format
      const match = originalMessage.match(/^(.*?)\s+(.+?)\s+not found$/);
      if (match) {
        const [, resourceType, resourceId] = match;
        message = `${resourceId} ${resourceType.toLowerCase()} not found`;
      } else {
        message = originalMessage;
      }
    }
  }
  // Handle business logic errors with detailed messages
  else if (err.details?.data?.error === 'business_logic_error') {
    message = err.details.data.message || 'Business logic error occurred';
  }
  // User-friendly messages for common error types  
  else if (err.isAuthError()) {
    message = 'authentication failed';
  }
  else if (err.isNetworkError()) {
    message = 'network error';
  }
  // For file, validation, and client errors, trust the original message
  // For server errors, provide generic fallback
  else if (!err.isFileError() && !err.isValidationError() && !err.isClientError()) {
    message = 'server error';
  }
  
  if (opts.json) {
    console.error(JSON.stringify({ 
      error: message,
      ...(err.details ? { details: err.details } : {})
    }, null, 2));
    console.error();
  } else {
    error(message, undefined, opts.noColor);
    // Show help after error (unless in JSON mode)
    displayHelp(opts.noColor);
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
    try {
      const client = createClient();
      const result = await handler(client, ...args);
      
      // Build context for output if provided
      const outputContext = context ? {
        operation: context.operation,
        resourceType: context.resourceType,
        resourceId: context.getResourceId ? context.getResourceId(...args) : undefined
      } : undefined;
      
      // Get all options from command hierarchy
      const globalOptions = getAllOptions(this);
      
      output(result, outputContext, globalOptions);
    } catch (error: any) {
      const errorContext = context ? {
        operation: context.operation,
        resourceType: context.resourceType,
        resourceId: context.getResourceId ? context.getResourceId(...args) : undefined
      } : undefined;
      
      // Get all options from command hierarchy
      const globalOptions = getAllOptions(this);
      
      handleError(error, errorContext, globalOptions);
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
  
  // Use synchronous constructor - initialization happens lazily
  return new Ship(shipOptions);
}

/**
 * Human-readable formatters for different result types
 */
const formatters = {
  deployments: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    if (!result.deployments || result.deployments.length === 0) {
      info('no deployments found', isJson, noColor);
      return;
    }
    
    // For deployments list: hide files, size, status, expires for cleaner output
    const listColumns = ['deployment', 'url', 'created'];
    console.log(formatTable(result.deployments, listColumns, noColor));
  },
  aliases: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    if (!result.aliases || result.aliases.length === 0) {
      info('no aliases found', isJson, noColor);
      return;
    }
    
    // For aliases list: hide status, confirmed for cleaner output
    const listColumns = ['alias', 'deployment', 'url', 'created'];
    console.log(formatTable(result.aliases, listColumns, noColor));
  },
  alias: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    // Always show success message for alias operations, particularly 'set'
    if (result.alias) {
      const operation = result.isCreate ? 'created' : 'updated';
      success(`${result.alias} alias ${operation}`, isJson, noColor);
    }
    console.log(formatDetails(result, noColor));
  },
  deployment: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    // Show success message for create operations only
    if (result.status && context?.operation === 'create') {
      success(`${result.deployment} deployment created`, isJson, noColor);
    }
    console.log(formatDetails(result, noColor));
  },
  email: (result: any, context?: { operation?: string }, isJson?: boolean, noColor?: boolean) => {
    console.log(formatDetails(result, noColor));
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
  
  if (cmdOptions?.preserveDirs) {
    deployOptions.preserveDirs = true;
  }
  
  // Set up cancellation support using SDK's built-in AbortController
  const abortController = new AbortController();
  deployOptions.signal = abortController.signal;
  
  // Display upload pending message
  let spinner: any = null;
  
  // Show spinner only in TTY (not piped), not in JSON mode, and not with --no-color (script parsing)
  const globalOptions = commandContext ? getAllOptions(commandContext) : {};
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
    const result = await client.deployments.create([path], deployOptions);
    
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
function output(result: any, context?: { operation?: string; resourceType?: string; resourceId?: string }, options?: any) {
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
  for (const [key, formatter] of Object.entries(formatters)) {
    if (result[key]) {
      formatter(result, context, opts.json, opts.noColor);
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
  .option('--api-key <key>', 'API key for authentication')
  .option('--config <file>', 'Custom config file path')
  .option('--api-url <url>', 'API URL (for development)')
  .option('--json', 'Output results in JSON format')
  .option('--no-color', 'Disable colored output')
  .option('-h, --help', 'Display help for command')
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
  .action(() => {
    // Show help for incomplete command
    const globalOptions = getAllOptions(program);
    displayHelp(globalOptions.noColor);
    process.exit(1);
  });

deploymentsCmd
  .command('list')
  .description('List all deployments')
  .action(withErrorHandling((client) => client.deployments.list()));

deploymentsCmd
  .command('create <path>')
  .description('Create deployment from file or directory')
  .option('--preserve-dirs', 'Preserve directory structure in deployment')
  .action(withErrorHandling(
    function(client, path: string, cmdOptions: any) { 
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

// Aliases commands
const aliasesCmd = program
  .command('aliases')
  .description('Manage aliases')
  .action(() => {
    // Show help for incomplete command
    const globalOptions = getAllOptions(program);
    displayHelp(globalOptions.noColor);
    process.exit(1);
  });

aliasesCmd
  .command('list')
  .description('List all aliases')
  .action(withErrorHandling((client) => client.aliases.list()));

aliasesCmd
  .command('get <name>')
  .description('Show alias information')
  .action(withErrorHandling(
    (client, name: string) => client.aliases.get(name),
    { operation: 'get', resourceType: 'Alias', getResourceId: (name: string) => name }
  ));

aliasesCmd
  .command('set <name> <deployment>')
  .description('Create or update alias pointing to deployment')
  .action(withErrorHandling(
    (client, name: string, deployment: string) => client.aliases.set(name, deployment),
    { operation: 'set', resourceType: 'Alias', getResourceId: (name: string) => name }
  ));

aliasesCmd
  .command('remove <name>')
  .description('Delete alias permanently')
  .action(withErrorHandling(
    (client, name: string) => client.aliases.remove(name),
    { operation: 'remove', resourceType: 'Alias', getResourceId: (name: string) => name }
  ));

// Account commands
const accountCmd = program
  .command('account')
  .description('Manage account')
  .action(() => {
    // Show help for incomplete command
    const globalOptions = getAllOptions(program);
    displayHelp(globalOptions.noColor);
    process.exit(1);
  });

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
  .action(() => {
    // Show help for incomplete command
    const globalOptions = getAllOptions(program);
    displayHelp(globalOptions.noColor);
    process.exit(1);
  });

completionCmd
  .command('install')
  .description('Install shell completion script')
  .action(async () => {
    const shell = process.env.SHELL || '';
    const homeDir = os.homedir();
    let installPath: string;
    let profileFile: string;
    let sourceLine: string;

    // Resolve the path to the bundled completion scripts
    const bashScriptPath = path.resolve(__dirname, 'completions/ship.bash');
    const zshScriptPath = path.resolve(__dirname, 'completions/ship.zsh');
    const fishScriptPath = path.resolve(__dirname, 'completions/ship.fish');

    try {
      if (shell.includes('bash')) {
        installPath = path.join(homeDir, '.ship_completion.bash');
        profileFile = path.join(homeDir, '.bash_profile');
        sourceLine = `\n# Ship CLI completion\nsource '${installPath}'\n`;
        fs.copyFileSync(bashScriptPath, installPath);
      } else if (shell.includes('zsh')) {
        installPath = path.join(homeDir, '.ship_completion.zsh');
        profileFile = path.join(homeDir, '.zshrc');
        sourceLine = `\n# Ship CLI completion\nsource '${installPath}'\n`;
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
        if (!profileContent.includes('ship_completion')) {
          fs.appendFileSync(profileFile, sourceLine);
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
        const filteredLines = lines.filter(line => 
          !line.includes('ship_completion') && 
          !line.includes('Ship CLI completion')
        );
        
        // Only write back if we actually removed something
        const options = program.opts();
        if (filteredLines.length !== lines.length) {
          fs.writeFileSync(profileFile, filteredLines.join('\n'));
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
  .option('--preserve-dirs', 'Preserve directory structure in deployment')
  .action(withErrorHandling(
    async function(client, path?: string, cmdOptions?: any) {
      if (!path) {
        const globalOptions = program.opts();
        // Convert Commander.js --no-color flag (color: false) to our convention (noColor: true)
        const noColor = globalOptions.color === false || globalOptions.noColor;
        displayHelp(noColor);
        process.exit(0);
      }
      
      // Check if the argument looks like a path (not a command)
      if (!path.includes('/') && !path.startsWith('.') && !path.startsWith('~')) {
        // This looks like an unknown command, not a path
        throw ShipError.validation(`unknown command '${path}'`);
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

  const completions = ['ping', 'whoami', 'deployments', 'aliases', 'account', 'completion'];
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