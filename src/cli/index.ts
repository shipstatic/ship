/**
 * @file Main entry point for the Ship CLI.
 * Ultra-simple CLI with explicit commands and deploy shortcut.
 */
import { Command } from 'commander';
import { Ship } from '../index.js';
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
 * Simple error handler - just log and exit
 */
function handleError(error: any) {
  console.error('Error:', error.message || error);
  process.exit(1);
}

/**
 * Create Ship client with CLI options
 */
function createClient(): Ship {
  const options = program.opts();
  return new Ship({
    apiUrl: options.api,
    apiKey: options.apiKey
  });
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
      console.log(`${a.alias} -> ${a.deployment}`);
    });
  },
  deployment: (result: any) => {
    console.log(`${result.deployment} (${result.status})`);
  },
  alias: (result: any) => {
    console.log(`${result.alias} -> ${result.deployment}`);
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

program
  .name('ship')
  .description('CLI for Shipstatic')
  .version(packageJson.version)
  .option('-u, --api <URL>', 'API URL')
  .option('-k, --apiKey <KEY>', 'API key')
  .option('--json', 'JSON output')
  .addHelpText('after', `
Examples:
  ship ./path                    Deploy files (shortcut, dirs flattened by default)
  ship ./dist --preserve-dirs    Deploy preserving directory structure
  ship ping                      Check API connectivity
  
  ship deployments list          List all deployments
  ship deployments create ./app  Deploy app directory (dirs flattened by default)
  ship deployments create ./dist --preserve-dirs  Deploy preserving dir structure
  ship deployments get abc123    Get deployment details
  ship deployments remove abc123 Remove deployment
  
  ship aliases list              List all aliases
  ship aliases get staging       Get alias details
  ship aliases set staging abc123   Set alias to deployment
  ship aliases remove staging    Remove alias
  
  ship account get               Get account details`);

// Ping command
program
  .command('ping')
  .description('Check API connectivity')
  .action(async () => {
    try {
      const client = createClient();
      const success = await client.ping();
      console.log(success ? 'Connected' : 'Failed');
    } catch (error: any) {
      handleError(error);
    }
  });

// Deployments commands
const deploymentsCmd = program
  .command('deployments')
  .description('Manage deployments');

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
  .option('--preserve-dirs', 'Preserve directory structure (by default, common parent directories are flattened)')
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
  .description('Manage aliases');

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
  .description('Manage account');

accountCmd
  .command('get')
  .description('Get account details')
  .action(async () => {
    try {
      const client = createClient();
      const result = await client.account.get();
      output(result);
    } catch (error: any) {
      handleError(error);
    }
  });

// Path shortcut - handle as fallback
program
  .argument('[path]', 'Path to deploy (shortcut)')
  .option('--preserve-dirs', 'Preserve directory structure (by default, common parent directories are flattened)')
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