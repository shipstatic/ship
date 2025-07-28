# Shipstatic CLI Usage Guide

This guide shows how to use the Shipstatic CLI for deploying static websites directly from your terminal. The CLI provides a simple, resource-based interface with automatic configuration loading and comprehensive error handling.

## Features
- **Zero configuration**: Automatic config loading from environment/files
- **Optimized bundle size**: 25KB CLI bundle
- **Resource-based commands**: Intuitive `ship deployments create` syntax
- **Built-in shortcuts**: Quick `ship ./path` deployments and `ship whoami`
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

### 1. Command Line Options
```sh
ship ./dist -u https://api.shipstatic.com -k ship-your-api-key
```

### 2. Environment Variables
```sh
export SHIP_API_KEY=ship-your-api-key
export SHIP_API_URL=https://api.shipstatic.com  # optional
ship ./dist
```

### 3. Configuration Files

#### `.shiprc` file (JSON format)
Create a `.shiprc` file in your project directory:

```json
{
  "apiKey": "ship-your-api-key",
  "apiUrl": "https://api.shipstatic.com"
}
```

#### `package.json` configuration
Add a `ship` section to your `package.json`:

```json
{
  "name": "my-project",
  "ship": {
    "apiKey": "ship-your-api-key",
    "apiUrl": "https://api.shipstatic.com"
  }
}
```

**Notes:**
- API keys must start with `ship-` and be 69 characters total
- Only `apiKey` and `apiUrl` are supported in configuration files
- The CLI searches for config files in the current working directory

## Quick Start

```sh
# Get help and see all commands
ship

# Deploy your site (shortcut)
ship ./dist

# Check your account
ship whoami

# Test connectivity
ship ping
```

## Command Reference

### Main Usage
```
USAGE
  ship <path>            🚀 Deploy project

COMMANDS
  ship deployments       📦 Manage deployments
  ship aliases           🌎 Manage aliases
  ship whoami            👨‍🚀 Current account
  ship ping              📡 Check API connectivity

FLAGS
  -u, --api-url <url>    API URL
  -k, --api-key <key>    API key
  -p, --preserve-dirs    Keep nesting
  -j, --json             JSON output
  -h, --help             Show help
  -v, --version          Show version
```

### Deployment Commands
```sh
# Deploy project (shortcuts)
ship ./my-website
ship .

# Deploy using full command
ship deployments create ./my-website

# List all deployments
ship deployments list

# Get specific deployment details
ship deployments get abc123

# Remove a deployment
ship deployments remove abc123
```

### Alias Commands
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

### Account & Connectivity
```sh
# Get current account information
ship whoami

# Same as above (hidden shortcut)
ship account get

# Test API connection
ship ping
```

### Global Flags

All commands support these global flags:

- `-u, --api-url <url>` - Custom API base URL
- `-k, --api-key <key>` - API Key (must start with `ship-`)
- `-p, --preserve-dirs` - Keep directory structure when deploying
- `-j, --json` - Output results in JSON format
- `-h, --help` - Show help information
- `-v, --version` - Show version number

## Examples

### Basic Deployment
```sh
# Deploy current directory
ship .

# Deploy specific directory
ship ./dist

# Deploy with preserved directory structure
ship ./my-app --preserve-dirs
```

### Managing Deployments
```sh
# List all your deployments
ship deployments list

# Get details about a specific deployment
ship deployments get pink-elephant-4ruf23f

# Remove old deployment
ship deployments remove old-deployment-id
```

### Alias Management
```sh
# Set up staging environment
ship aliases set staging pink-elephant-4ruf23f

# Set up production
ship aliases set www.mysite.com pink-elephant-4ruf23f

# List all aliases
ship aliases list

# Check specific alias
ship aliases get staging
```

### Account Information
```sh
# Check your account details
ship whoami

# Get account info in JSON format
ship whoami --json
```

## Example Output

```
$ ship ./my-website
✅ Deployment successful: pink-elephant-4ruf23f
🌍 Your site: https://pink-elephant-4ruf23f.shipstatic.dev

$ ship whoami
alice@example.com (pro)

$ ship ping
🛰️ Connected

$ ship deployments list
pink-elephant-4ruf23f (success)
blue-whale-8xk92m1 (success)

$ ship aliases set staging pink-elephant-4ruf23f
staging -> pink-elephant-4ruf23f

$ ship aliases list
staging -> pink-elephant-4ruf23f
www.mysite.com -> blue-whale-8xk92m1
```

## Error Handling

The CLI provides clear error messages for common issues:

```sh
# Missing API key
$ ship ./dist
Error: API key is required. Set SHIP_API_KEY environment variable or use --api-key flag.

# Invalid path
$ ship ./nonexistent
Error: Path './nonexistent' does not exist.

# Network issues
$ ship ping
Error: Unable to connect to API. Check your internet connection.
```

## Configuration Priority

When multiple configuration sources are present, the CLI uses this priority order:

1. **Command line flags** (highest priority)
2. **Environment variables**
3. **`.shiprc` file**
4. **`package.json` ship section**
5. **Default values** (lowest priority)

## Related Examples
- [Browser Deploy Example](../browser/) - For web-based deployments
- [Node.js SDK Example](../node/) - For programmatic deployments in Node.js

## Support

Please report any issues to https://github.com/shipstatic/ship/issues