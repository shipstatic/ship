# Ship Static CLI Usage Guide

This guide shows how to use the Ship Static CLI for deploying static websites directly from your terminal. The CLI provides a simple, resource-based interface with automatic configuration loading and comprehensive error handling.

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
ship ./dist --api-url https://api.shipstatic.dev --api-key ship-your-api-key
# OR
ship ./dist --api-url https://api.shipstatic.dev --deploy-token token-your-deploy-token
```

### 2. Environment Variables
```sh
export SHIP_API_KEY=ship-your-api-key
# OR
export SHIP_DEPLOY_TOKEN=token-your-deploy-token
export SHIP_API_URL=https://api.shipstatic.dev  # optional
ship ./dist
```

### 3. Configuration Files

#### `.shiprc` file (JSON format)
Create a `.shiprc` file in your project directory:

```json
{
  "apiKey": "ship-your-api-key",
  "apiUrl": "https://api.shipstatic.dev"
}
```

OR for deploy tokens:

```json
{
  "deployToken": "token-your-deploy-token",
  "apiUrl": "https://api.shipstatic.dev"
}
```

#### `package.json` configuration
Add a `ship` section to your `package.json`:

```json
{
  "name": "my-project",
  "ship": {
    "apiKey": "ship-your-api-key",
    "apiUrl": "https://api.shipstatic.dev"
  }
}
```

**Notes:**
- API keys must start with `ship-` and are 69 characters total
- Deploy tokens must start with `token-` and are 70 characters total
- Both `apiKey`/`deployToken` and `apiUrl` are supported in configuration files
- The CLI searches for config files in the current working directory
- For reCAPTCHA-based deployments, see `web/` examples for token fetching patterns

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
  ship [path]            🚀 Deploy project

COMMANDS
  ship deployments       📦 Manage deployments
  ship aliases           🌎 Manage aliases
  ship account           🦸 Manage account
  ship whoami            🦸 Current account
  ship ping              📡 Check API connectivity
  ship completion        ⚡ Setup shell completion

FLAGS
  --api-key <key>         API key for authenticated deployments
  --deploy-token <token>  Deploy token for single-use deployments
  --config <file>         Custom config file path
  --api-url <url>         API URL (for development)
  --no-path-detect        Disable automatic path optimization and flattening
  --no-spa-detect         Disable automatic SPA detection and configuration
  --json                  Output results in JSON format
  --no-color              Disable colored output
  --version               Show version information
  --help                  Display help for command
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

- `--api-key <key>` - API key for authenticated deployments (must start with `ship-`)
- `--deploy-token <token>` - Deploy token for single-use deployments (must start with `token-`)
- `--config <file>` - Custom config file path
- `--api-url <url>` - API URL (for development)
- `--no-path-detect` - Disable automatic path optimization and flattening
- `--no-spa-detect` - Disable automatic SPA detection and configuration
- `--json` - Output results in JSON format
- `--no-color` - Disable colored output
- `--version` - Show version information
- `--help` - Display help for command

## Examples

### Basic Deployment
```sh
# Deploy current directory
ship .

# Deploy specific directory
ship ./dist

# Deploy with path detection disabled
ship ./my-app --no-path-detect

# Deploy without colors (useful for CI/scripts)
ship ./dist --no-color
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

# Alternative account command
ship account get
```

### Shell Completion
```sh
# Install shell completion for your current shell
ship completion install

# Uninstall shell completion
ship completion uninstall
```

## Example Output

### Standard Output (with colors)
```
$ ship ./my-website
uploading…
pink-elephant-4ruf23f deployment created

deployment:  pink-elephant-4ruf23f
url:         https://pink-elephant-4ruf23f.shipstatic.dev
files:       15
size:        2.1Mb
status:      success
created:     2024-07-30 19:15:42Z

$ ship ping
api reachable

$ ship deployments list
deployment              url                                              created
pink-elephant-4ruf23f   https://pink-elephant-4ruf23f.shipstatic.dev    2024-07-30 19:15:42Z
blue-whale-8xk92m1      https://blue-whale-8xk92m1.shipstatic.dev       2024-07-30 18:45:12Z

$ ship aliases set staging pink-elephant-4ruf23f
staging alias created
```

### JSON Output
```
$ ship ./my-website --json
{
  "deployment": "pink-elephant-4ruf23f",
  "url": "https://pink-elephant-4ruf23f.shipstatic.dev",
  "files": 15,
  "size": 2204672,
  "status": "success",
  "created": 1722365742
}

$ ship deployments list --json
{
  "deployments": [
    {
      "deployment": "pink-elephant-4ruf23f",
      "url": "https://pink-elephant-4ruf23f.shipstatic.dev",
      "files": 15,
      "size": 2204672,
      "status": "success",
      "created": 1722365742
    }
  ]
}
```

### No Color Output (for CI/scripts)
```
$ ship ./my-website --no-color
uploading…
pink-elephant-4ruf23f deployment created

deployment:  pink-elephant-4ruf23f
url:         https://pink-elephant-4ruf23f.shipstatic.dev
files:       15
size:        2.1Mb
status:      success
created:     2024-07-30 19:15:42Z
```

## Error Handling

The CLI provides clear error messages for common issues:

```sh
# Missing API key
$ ship ./dist
error authentication failed

# Invalid path
$ ship ./nonexistent
error ./nonexistent path does not exist

# Network issues
$ ship ping
error network error

# JSON error output
$ ship ./dist --json
{
  "error": "authentication failed"
}

# No color error output
$ ship ./dist --no-color
error authentication failed
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