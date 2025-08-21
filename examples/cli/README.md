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

1. Configure your API key via environment, config file, or CLI flag
2. Run `ship [path]` to deploy
3. See deployment progress and URL in terminal output

## Command Examples

Basic deployment commands:

```bash
# Deploy current directory
ship .

# Deploy with API key
ship ./dist --api-key ship-your-key

# List deployments
ship deployments list

# Check account
ship whoami

# Test connectivity
ship ping
```

That's it! Minimal CLI commands for quick deployments - no complex setup, just simple terminal commands.