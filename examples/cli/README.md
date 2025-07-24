# Shipstatic SDK – CLI Usage Guide

This guide shows how to use the Shipstatic CLI for deploying static websites directly from your terminal. The CLI provides a simple, resource-based interface with automatic configuration loading and comprehensive error handling.

## Features
- **Zero configuration**: Automatic config loading from environment/files
- **Optimized bundle size**: 25KB CLI bundle
- **Resource-based commands**: Intuitive `ship deployments create` syntax
- **Built-in shortcuts**: Quick `ship ./path` deployments
- **Rich terminal output:**
  - Real-time progress tracking
  - Colored error messaging
  - Structured JSON output option

## Installation

### Local Development (Pre-release)
Since the package is not yet publicly available, you can install and use the CLI locally:

```sh
# Navigate to the ship directory
cd ship

# Install dependencies and build
pnpm install
pnpm build

# Link globally (makes 'ship' command available)
pnpm link --global
```

After linking, the `ship` command should be available in your terminal.

### Standard Installation (When Published)
```sh
npm install -g @shipstatic/ship
# or
pnpm add -g @shipstatic/ship
```

## Configuration

The CLI automatically loads configuration from (in priority order):
- Command line options: `--api-key ship-your-key` and `--api-url https://api.shipstatic.com`
- Environment variables: `SHIP_API_KEY=ship-your-key` and optionally `SHIP_API_URL`
- Config files: `.shiprc` or `package.json` (ship property) in current directory
- API keys must start with `ship-` and be 69 characters total

## How to Use

1. **Deploy a directory:**
   ```sh
   # Deploy using shortcut (most common)
   ship ./my-website
   ship .
   
   # Deploy using full resource-based command
   ship deployments create ./my-website
   ship deployments create .
   ```

2. **Manage deployments:**
   ```sh
   # List all deployments
   ship deployments list
   
   # Get specific deployment details
   ship deployments get abc123
   
   # Remove a deployment
   ship deployments remove abc123
   ```

3. **Manage aliases:**
   ```sh
   # List all aliases
   ship aliases list
   
   # Get specific alias details
   ship aliases get staging
   
   # Set alias to deployment
   ship aliases set staging abc123
   
   # Remove alias
   ship aliases remove staging
   ```

4. **Check connectivity:**
   ```sh
   # Test API connection
   ship ping
   ```

## Command Overview

### Connectivity
- `ship ping` - Check API connectivity

### Deployment Commands
- `ship deployments list` - List all deployments
- `ship deployments create <path>` - Deploy files from path
- `ship deployments get <id>` - Get deployment details
- `ship deployments remove <id>` - Remove deployment

### Alias Commands
- `ship aliases list` - List all aliases
- `ship aliases get <name>` - Get alias details
- `ship aliases set <name> <deployment>` - Set alias to deployment
- `ship aliases remove <name>` - Remove alias

### Account Commands
- `ship account get` - Get account details

### Shortcuts & Discovery
- `ship` - Show help with all commands and examples
- `ship --help` - Same as above
- `ship ./path` - Deploy files (shortcut for `ship deployments create ./path`)

### Global Options
- `--api-url <URL>` - Custom API base URL
- `--api-key <KEY>` - API Key (must start with `ship-`)
- `--json` - Output in JSON format

### Deployment Options
- `--preserve-dirs` - Preserve directory structure when deploying (by default, common parent directories are removed)

## Example Output

```
$ ship ./my-website
✅ Deployment successful: deployment-abc123
🌍 Your site: https://deployment-abc123.shipstatic.dev

$ ship ping
✅ Connected to API

$ ship deployments list
deployment-abc123 (success) - 42 files
deployment-xyz789 (success) - 18 files

$ ship aliases set staging deployment-abc123
✅ Alias set: staging -> deployment-abc123

$ ship aliases list
staging -> deployment-abc123
```

## Related Examples
- Browser deploy example - For web-based deployments
- Node.js SDK example - For programmatic deployments in Node.js