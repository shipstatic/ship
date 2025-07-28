/**
 * @file Main entry point for the Ship CLI.
 * Ultra-simple CLI with explicit commands and deploy shortcut.
 */
import { Command } from 'commander';
import { Ship, ShipError } from '../index.js';
import { readFileSync, existsSync, statSync } from 'fs';
import * as path from 'path';
import { formatTable, formatDetails, formatTimestamp, success, error, info, warn } from './utils.js';
// Removed tabtab dependency - now using custom completion script
import { bold, dim } from 'yoctocolors';
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


/**
 * Display comprehensive help information for all commands
 */
function displayMasterHelp() {
  const output = `
${bold('USAGE')}
  ship <path>               🚀 Deploy project

${bold('COMMANDS')}
  📦 ${bold('Deployments')}
  ship deployments list                     List all deployments
  ship deployments create <path>            Deploy project from path
  ship deployments get <deployment>         Get deployment details
  ship deployments remove <deployment>      Remove deployment

  🌎 ${bold('Aliases')}
  ship aliases list                         List all aliases
  ship aliases get <alias>                  Get alias details
  ship aliases set <alias> <deployment>     Set alias to deployment
  ship aliases remove <alias>               Remove alias

  👨‍🚀 ${bold('Account')}
  ship whoami                               Current account information

  🛠️  ${bold('Completion')}
  ship completion install                   Install shell completion
  ship completion uninstall                 Uninstall shell completion

${bold('FLAGS')}
  -k, --api-key <key>       API key for authentication
  -c, --config <file>       Custom config file path
  -p, --preserve-dirs       Preserve directory structure in deployment
  -j, --json                Output results in JSON format
  -v, --version             Show version information

${dim('Please report any issues to https://github.com/shipstatic/ship/issues')}
`;
  
  console.log(output);
}

const program = new Command();

// CLI formatting helpers are imported from utils.js

/**
 * Error handler using ShipError type guards - all errors should be ShipError instances
 */
function handleError(err: any, context?: { operation?: string; resourceType?: string; resourceId?: string }) {
  // All errors in this codebase should be ShipError instances
  if (!(err instanceof ShipError)) {
    const message = err.message || err;
    const options = program.opts();
    
    if (options.json) {
      console.error(JSON.stringify({ 
        error: `Unexpected error: ${message}`,
        details: { originalError: message }
      }, null, 2));
      console.error();
    } else {
      error(`Unexpected error: ${message}`);
      console.log();
    }
    process.exit(1);
  }

  let message = err.message;
  
  // Special handling for 404 errors on delete operations
  if (err.details?.data?.error === 'not_found' && context?.operation === 'remove') {
    const resourceType = context.resourceType || 'resource';
    const resourceId = context.resourceId || '';
    message = `${resourceType} not found: ${resourceId}`;
  } else if (err.isAuthError()) {
    message = 'Authentication failed. Check your API key.';
  } else if (err.isNetworkError()) {
    message = 'Network error. Check your connection and API URL.';
  } else if (err.isFileError()) {
    // Keep original file error message as it's usually specific and helpful
  } else if (err.isValidationError()) {
    // Keep original validation message as it's usually specific
  } else if (err.isClientError()) {
    // Keep original client error message
  } else {
    message = 'Server error. Please try again later.';
  }
  
  const options = program.opts();
  if (options.json) {
    console.error(JSON.stringify({ 
      error: message,
      ...(err.details ? { details: err.details } : {})
    }, null, 2));
    console.error();
  } else {
    error(message);
    console.log();
  }
  process.exit(1);
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
  deployments: (result: any) => {
    if (!result.deployments || result.deployments.length === 0) {
      info('No deployments found');
      console.log();
      return;
    }
    
    console.log(formatTable(result.deployments));
    console.log();
  },
  aliases: (result: any) => {
    if (!result.aliases || result.aliases.length === 0) {
      info('No aliases found');
      console.log();
      return;
    }
    
    console.log(formatTable(result.aliases));
    console.log();
  },
  deployment: (result: any, context?: { operation?: string }) => {
    // Show success message for create operations only
    if (result.status && context?.operation === 'create') {
      success(`Deployment created: ${result.deployment}`);
      console.log();
    }
    console.log(formatDetails(result));
    console.log();
  },
  alias: (result: any) => {
    // Show success message for create/update operations with proper terminology
    const operation = result.isCreate ? 'created' : 'updated';
    success(`Alias ${operation}: ${result.alias}`);
    console.log();
    console.log(formatDetails(result));
    console.log();
  },
  email: (result: any) => {
    console.log(formatDetails(result));
    console.log();
  }
};

/**
 * Format output based on --json flag
 */
function output(result: any, context?: { operation?: string; resourceType?: string; resourceId?: string }) {
  const options = program.opts();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    console.log();
    return;
  }
  
  // Handle void/undefined results (removal operations)
  if (result === undefined) {
    if (context?.operation === 'remove' && context.resourceType && context.resourceId) {
      success(`${context.resourceType} removed: ${context.resourceId}`);
    } else {
      success('Removed successfully');
    }
    console.log();
    return;
  }
  
  // Handle ping result (boolean or object with success property)
  if (result === true || (result && typeof result === 'object' && result.hasOwnProperty('success'))) {
    const isSuccess = result === true || result.success;
    if (isSuccess) {
      success('API connected');
    } else {
      error('API connection failed');
    }
    console.log();
    return;
  }
  
  // Find appropriate formatter based on result properties
  for (const [key, formatter] of Object.entries(formatters)) {
    if (result[key]) {
      formatter(result, context);
      return;
    }
  }
  
  // Default fallback
  console.log('Success');
  console.log();
}

/**
 * Shared deployment handler for both explicit and shortcut commands
 */
async function handleDeploy(path: string, cmdOptions: any) {
  try {
    // Validate path exists before proceeding
    if (!existsSync(path)) {
      throw ShipError.file(`Path does not exist: ${path}`, path);
    }
    
    // Check if path is a file or directory
    const stats = statSync(path);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw ShipError.file(`Path must be a file or directory: ${path}`, path);
    }
    
    const client = createClient();
    const deployOptions: any = {};
    
    if (cmdOptions?.preserveDirs) {
      deployOptions.preserveDirs = true;
    }
    
    // Display upload pending message
    const options = program.opts();
    let spinner: any = null;
    
    if (!options.json) {
      const { default: yoctoSpinner } = await import('yocto-spinner');
      spinner = yoctoSpinner({ text: 'Uploading…' }).start();
    }
    
    const result = await client.deployments.create([path], deployOptions);
    
    // Stop spinner before showing output
    if (spinner) {
      spinner.stop();
    }
    
    output(result, { operation: 'create' });
  } catch (error: any) {
    // Make sure to stop spinner on error too
    if (!program.opts().json) {
      // Try to stop any running spinner
      try {
        // Create a temporary spinner just to stop any running ones
        const { default: yoctoSpinner } = await import('yocto-spinner');
        const tempSpinner = yoctoSpinner({ text: '' });
        tempSpinner.stop();
      } catch (e) {
        // Ignore spinner cleanup errors
      }
    }
    handleError(error);
  }
}


program
  .name('ship')
  .description('')
  .version(packageJson.version)
  .option('-k, --api-key <key>', 'API key')
  .option('-c, --config <file>', 'Custom config file path')
  .option('-u, --api-url <url>', 'API URL')
  .option('-p, --preserve-dirs', 'Preserve directory structure')
  .option('-j, --json', 'JSON output')
  .exitOverride()
  .configureOutput({
    writeErr: (str) => {
      const options = program.opts();
      if (options.json) {
        console.error(JSON.stringify({ error: str.trim() }, null, 2));
        console.error();
      } else {
        error(str.trim());
        console.log();
      }
    }
  })
  .configureHelp({
    formatHelp: (cmd, helper) => {
      displayMasterHelp();
      return '';  // Return empty string since we're handling display ourselves
    }
  });

// Ping command
program
  .command('ping')
  .description('Check API connectivity')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.ping();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Whoami command
program
  .command('whoami')
  .description('Get current account information')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.whoami();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Deployments commands
const deploymentsCmd = program
  .command('deployments')
  .description('Manage deployments')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      displayMasterHelp();
      return '';
    }
  });

deploymentsCmd
  .command('list')
  .description('List all deployments')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.deployments.list();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

deploymentsCmd
  .command('create <path>')
  .description('Deploy project from path')
  .action(handleDeploy);

deploymentsCmd
  .command('get <deployment>')
  .description('Get deployment details')
  .action(async (deployment: string) => {
    try {
      const client = createClient();
      const result = await client.deployments.get(deployment);
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

deploymentsCmd
  .command('remove <deployment>')
  .description('Remove deployment')
  .action(async (deployment: string) => {
    try {
      const client = createClient();
      const result = await client.deployments.remove(deployment);
      output(result, { operation: 'remove', resourceType: 'Deployment', resourceId: deployment });
    } catch (error: any) {
      handleError(error, { operation: 'remove', resourceType: 'Deployment', resourceId: deployment });
    }
  });

// Aliases commands
const aliasesCmd = program
  .command('aliases')
  .description('Manage aliases')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      displayMasterHelp();
      return '';
    }
  });

aliasesCmd
  .command('list')
  .description('List all aliases')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.aliases.list();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

aliasesCmd
  .command('get <name>')
  .description('Get alias details')
  .action(async (name: string) => {
    try {
      const client = createClient();
      const result = await client.aliases.get(name);
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

aliasesCmd
  .command('set <name> <deployment>')
  .description('Set alias to deployment')
  .action(async (name: string, deployment: string) => {
    try {
      const client = createClient();
      const result = await client.aliases.set(name, deployment);
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

aliasesCmd
  .command('remove <name>')
  .description('Remove alias')
  .action(async (name: string) => {
    try {
      const client = createClient();
      const result = await client.aliases.remove(name);
      output(result, { operation: 'remove', resourceType: 'Alias', resourceId: name });
    } catch (error: any) {
      handleError(error, { operation: 'remove', resourceType: 'Alias', resourceId: name });
    }
  });

// Account commands
const accountCmd = program
  .command('account')
  .description('Manage account')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      displayMasterHelp();
      return '';
    }
  });

accountCmd
  .command('get')
  .description('Get account details')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.whoami();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Completion commands
const completionCmd = program
  .command('completion')
  .description('Setup shell completion')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      displayMasterHelp();
      return '';
    }
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
        success('Fish completion installed successfully!');
        info('Please restart your shell to apply the changes.');
        return;
      } else {
        error(`Unsupported shell: ${shell}. Could not install completion script.`);
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

      success(`Completion script installed for ${shell.split('/').pop()}.`);
      info(`Please run "source ${profileFile}" or restart your shell.`);
    } catch (e: any) {
      error(`Could not install completion script: ${e.message}`);
      if (shell.includes('bash') || shell.includes('zsh')) {
        info(`Please add the following line to your profile file manually:\n${sourceLine}`);
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
        if (fs.existsSync(installPath)) {
          fs.unlinkSync(installPath);
          success('Fish completion uninstalled successfully!');
        } else {
          warn('Fish completion was not installed.');
        }
        info('Please restart your shell to apply the changes.');
        return;
      } else {
        error(`Unsupported shell: ${shell}. Could not uninstall completion script.`);
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
        if (filteredLines.length !== lines.length) {
          fs.writeFileSync(profileFile, filteredLines.join('\n'));
          success(`Completion script uninstalled for ${shell.split('/').pop()}.`);
          info(`Please run "source ${profileFile}" or restart your shell.`);
        } else {
          warn('Completion was not found in profile.');
        }
      } else {
        warn('Profile file not found.');
      }
    } catch (e: any) {
      error(`Could not uninstall completion script: ${e.message}`);
    }
  });


// Path shortcut - handle as fallback
program
  .argument('[path]', 'Path to deploy (shortcut)')
  .action(async (path?: string, cmdOptions?: any) => {
    // If no path provided, show help
    if (!path) {
      displayMasterHelp();
      process.exit(0);
    }
    
    // Check if looks like a path (shortcut: ship ./path)
    if (path.startsWith('./') || path.startsWith('/') || path.startsWith('~') || path.includes('/')) {
      await handleDeploy(path, cmdOptions);
    } else {
      // Let Commander.js handle unknown commands with its default error handling
      const options = program.opts();
      if (options.json) {
        console.error(JSON.stringify({ error: `Unknown command: ${path}` }, null, 2));
        console.error();
      } else {
        error(`Unknown command: ${path}`);
        console.log();
        displayMasterHelp();
      }
      process.exit(1);
    }
  });



/**
 * Centralized completion handler for all shells
 */
function handleCompletion() {
  // Determine shell from the flag passed by the completion script
  const isZsh = process.argv.includes('--compzsh');
  const isBash = process.argv.includes('--compbash');
  const isFish = process.argv.includes('--compfish');

  if (!isZsh && !isBash && !isFish) return;

  const line = process.argv.find(arg => arg.startsWith('--compgen='))?.split('=')[1] || '';
  // For Bash/Zsh, we split by space. Fish provides the buffer similarly.
  const words = line.replace(/"/g, '').split(' ').filter(Boolean);
  const currentWord = words[words.length - 1] || '';
  const prev = words[words.length - 2] || 'ship'; // Default to 'ship' for root completions

  let completions: string[] = [];

  // Command logic
  if (prev === 'ship') {
    completions = ['deployments', 'aliases', 'whoami', 'ping', 'account', 'completion'];
  } else if (prev === 'deployments') {
    completions = ['list', 'create', 'get', 'remove'];
  } else if (prev === 'aliases') {
    completions = ['list', 'get', 'set', 'remove'];
  } else if (prev === 'account') {
    completions = ['get'];
  } else if (prev === 'completion') {
    completions = ['install', 'uninstall'];
  }
  
  // Filter based on the current word being typed
  const filteredCompletions = completions.filter(cmd => cmd.startsWith(currentWord));

  // Output space-separated for bash/zsh, and newline-separated for fish
  console.log(filteredCompletions.join(isFish ? '\n' : ' '));
  process.exit(0);
}

// Handle completion requests (before any other processing)
if (process.env.NODE_ENV !== 'test') {
  handleCompletion();
}

// Handle main CLI parsing
if (process.env.NODE_ENV !== 'test') {
  try {
    program.parse(process.argv);
  } catch (err: any) {
    // Commander.js will throw after calling writeErr, we just need to exit cleanly
    if (err.code && err.code.startsWith('commander.')) {
      process.exit(err.exitCode || 1);
    }
    throw err;
  }
}