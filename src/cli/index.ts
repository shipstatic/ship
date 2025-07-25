/**
 * @file Main entry point for the Ship CLI.
 * Ultra-simple CLI with explicit commands and deploy shortcut.
 */
import { Command } from 'commander';
import { Ship, ShipError } from '../index.js';
import { readFileSync } from 'fs';
import * as path from 'path';

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

/**
 * CLI formatting helpers
 */
const strong = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

/**
 * Error handler using ShipError type guards - all errors should be ShipError instances
 */
function handleError(error: any) {
  // All errors in this codebase should be ShipError instances
  if (!(error instanceof ShipError)) {
    const message = error.message || error;
    const options = program.opts();
    
    if (options.json) {
      console.error(JSON.stringify({ 
        error: `Unexpected error: ${message}`,
        details: { originalError: message }
      }, null, 2));
    } else {
      console.error(`🔴 Unexpected error type: ${message}`);
    }
    process.exit(1);
  }

  let message = error.message;
  
  if (error.isAuthError()) {
    message = 'Authentication failed. Check your API key.';
  } else if (error.isNetworkError()) {
    message = 'Network error. Check your connection and API URL.';
  } else if (error.isFileError()) {
    // Keep original file error message as it's usually specific and helpful
  } else if (error.isValidationError()) {
    // Keep original validation message as it's usually specific
  } else if (error.isClientError()) {
    // Keep original client error message
  } else {
    message = 'Server error. Please try again later.';
  }
  
  const options = program.opts();
  if (options.json) {
    console.error(JSON.stringify({ 
      error: message,
      ...(error.details ? { details: error.details } : {})
    }, null, 2));
  } else {
    console.error(`🔴 ${message}`);
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
    result.deployments.forEach((d: any) => {
      console.log(`${d.deployment} (${d.status})`);
    });
  },
  aliases: (result: any) => {
    result.aliases.forEach((a: any) => {
      console.log(`${a.alias} -> ${a.deploymentName}`);
    });
  },
  deployment: (result: any) => {
    console.log(`${result.deployment} (${result.status})`);
  },
  alias: (result: any) => {
    console.log(`${result.alias} -> ${result.deploymentName}`);
  },
  email: (result: any) => {
    console.log(`${result.email} (${result.subscription})`);
  }
};

/**
 * Format output based on --json flag
 */
function output(result: any) {
  const options = program.opts();
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  
  // Handle ping result (has success property)
  if (result && typeof result === 'object' && result.hasOwnProperty('success')) {
    console.log(result.success ? '🛰️ Connected' : '🔴 Connection failed');
    return;
  }
  
  // Find appropriate formatter based on result properties
  for (const [key, formatter] of Object.entries(formatters)) {
    if (result[key]) {
      formatter(result);
      return;
    }
  }
  
  // Default fallback
  console.log('Success');
}

/**
 * Shared deployment handler for both explicit and shortcut commands
 */
async function handleDeploy(path: string, cmdOptions: any) {
  try {
    const client = createClient();
    const deployOptions: any = {};
    
    if (cmdOptions?.preserveDirs) {
      deployOptions.preserveDirs = true;
    }
    
    const result = await client.deployments.create([path], deployOptions);
    output(result);
  } catch (error: any) {
    handleError(error);
  }
}

/**
 * Help formatting - "Impossible Simplicity" approach
 */
const COLUMN_WIDTH = 25;

const FLAGS_SECTION = [
  ['-k, --api-key <key>', 'API key'],
  ['-c, --config <file>', 'Config file'],
  ['-p, --preserve-dirs', 'Keep nesting'],
  ['-j, --json', 'JSON output'],
  ['-h, --help', 'Show help'],
  ['-v, --version', 'Show version']
];

function formatFlags(): string {
  return strong('FLAGS') + '\n' + 
    FLAGS_SECTION.map(([flag, desc]) => 
      `  ${flag.padEnd(COLUMN_WIDTH)} ${desc}`
    ).join('\n') + '\n\n';
}

function formatHelp(title: string, emoji: string, description: string, commands: Array<{name: string, desc: string}>, includeIssues = false): string {
  let output = title ? `\n${title}\n\n${emoji} ${description}\n\n` : `\n${emoji} ${description}\n\n`;
  
  if (commands.length > 0) {
    output += strong('COMMANDS') + '\n';
    commands.forEach(cmd => {
      output += `  ${cmd.name.padEnd(COLUMN_WIDTH)} ${cmd.desc}\n`;
    });
    output += '\n';
  }
  
  output += formatFlags();
  
  if (includeIssues) {
    output += dim('Please report any issues to https://github.com/shipstatic/ship/issues') + '\n\n';
  }
  
  return output;
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
  .configureHelp({
    formatHelp: (cmd, helper) => {
      // Special handling for main help - it has USAGE section first
      let output = '\n' + strong('USAGE') + '\n';
      output += `  ${'ship <path>'.padEnd(COLUMN_WIDTH)} 🚀 Deploy files\n\n`;
      
      // Get commands in specific order
      const commandOrder = ['deployments', 'aliases', 'whoami', 'ping'];
      const commands = cmd.commands.filter(c => !c.hidden && c.name() !== 'account');
      
      commands.sort((a, b) => {
        const aIndex = commandOrder.indexOf(a.name());
        const bIndex = commandOrder.indexOf(b.name());
        return aIndex - bIndex;
      });
      
      const formattedCommands = commands.map(command => {
        let desc = command.description();
        
        // Remove emoji from description if it already has one
        if (desc.startsWith('📦') || desc.startsWith('🌎') || desc.startsWith('👨‍🚀') || desc.startsWith('📡')) {
          desc = desc.substring(2).trim();
        }
        
        // Update descriptions to match format
        if (command.name() === 'whoami') desc = 'Current account';
        else if (command.name() === 'ping') desc = 'Check API connectivity';
        
        const emojis = { ping: '📡', whoami: '👨‍🚀', deployments: '📦', aliases: '🌎' };
        const emoji = emojis[command.name() as keyof typeof emojis] || '';
        
        return {
          name: `ship ${command.name()}`,
          desc: `${emoji} ${desc}`
        };
      });
      
      output += strong('COMMANDS') + '\n';
      formattedCommands.forEach(cmd => {
        output += `  ${cmd.name.padEnd(COLUMN_WIDTH)} ${cmd.desc}\n`;
      });
      output += '\n';
      
      output += formatFlags();
      output += dim('Please report any issues to https://github.com/shipstatic/ship/issues') + '\n\n';
      
      return output;
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
  .description('📦 Manage deployments')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const subcommands = cmd.commands.filter(c => !c.hidden).map(sub => ({
        name: `ship deployments ${sub.name()}`,
        desc: sub.description()
      }));
      
      return formatHelp('', '📦', 'Manage deployments', subcommands);
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
  .description('Deploy files from path')
  .action(handleDeploy);

deploymentsCmd
  .command('get <id>')
  .description('Get deployment details')
  .action(async (id: string) => {
    try {
      const client = createClient();
      const result = await client.deployments.get(id);
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

deploymentsCmd
  .command('remove <id>')
  .description('Remove deployment')
  .action(async (id: string) => {
    try {
      const client = createClient();
      const result = await client.deployments.remove(id);
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Aliases commands
const aliasesCmd = program
  .command('aliases')
  .description('🌎 Manage aliases')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const subcommands = cmd.commands.filter(c => !c.hidden).map(sub => ({
        name: `ship aliases ${sub.name()}`,
        desc: sub.description()
      }));
      
      return formatHelp('', '🌎', 'Manage aliases', subcommands);
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
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Account commands
const accountCmd = program
  .command('account')
  .description('👨‍🚀 Manage account')
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const subcommands = cmd.commands.filter(c => !c.hidden).map(sub => ({
        name: `ship account ${sub.name()}`,
        desc: sub.description()
      }));
      
      return formatHelp('', '👨‍🚀', 'Manage account', subcommands);
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

// Path shortcut - handle as fallback
program
  .argument('[path]', 'Path to deploy (shortcut)')
  .action(async (path?: string, cmdOptions?: any) => {
    // If no path provided, show help
    if (!path) {
      program.help();
      return;
    }
    
    // Check if looks like a path (shortcut: ship ./path)
    if (path.startsWith('./') || path.startsWith('/') || path.startsWith('~') || path.includes('/')) {
      await handleDeploy(path, cmdOptions);
    } else {
      console.error('Unknown command:', path);
      console.error('Use "ship --help" for available commands');
      process.exit(1);
    }
  });


if (process.env.NODE_ENV !== 'test') {
  program.parse(process.argv);
}