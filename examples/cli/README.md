# Ship SDK - CLI Example

The most minimal CLI application demonstrating Ship SDK usage.

## Quick Start

```bash
# Install CLI globally
cd ship && npm link

# Deploy current directory
ship .

# Deploy specific directory  
ship ./dist
```

## Usage

1. Run `ship [path]` to deploy — no account, no API key, nothing to configure
2. The terminal prints the live URL, plus a **claim link**
3. Open the claim link to keep the site permanently, or configure a token
   (environment, config file, or `--token`) so deploys land in your account
   from the start. That token is your API key — one credential, two names.

## Command Examples

Basic deployment commands:

```bash
# Deploy current directory
ship .

# Deploy with a token (your API key)
ship ./dist --token ship-your-api-key

# Deploy with labels
ship ./dist --label production --label v1.0.0

# List deployments
ship deployments list

# Set domain with labels
ship domains set staging abc123 --label prod

# Check account
ship whoami

# Test connectivity
ship ping
```

That's it! Minimal CLI commands for quick deployments - no complex setup, just simple terminal commands.