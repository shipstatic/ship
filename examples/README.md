# Shipstatic SDK Examples

This directory contains practical examples demonstrating how to use the Shipstatic SDK across different environments and use cases. Each example is self-contained and showcases the modern resource-based API with real-world implementation patterns.

## 📁 Available Examples

### [🌍 Browser Example](./browser/)
Deploy project directly from the browser with drag-and-drop support.
- **Use case**: Web-based deployment interfaces, client-side applications
- **Bundle size**: 275KB optimized for browsers
- **Features**: FileList/File object support, real-time progress, error handling
- **API**: `ship.deployments.create(files, options)`

### [⚡ Node.js Example](./node/)
Deploy project and directories from Node.js applications and scripts.
- **Use case**: Build tools, CI/CD pipelines, server-side deployments
- **Bundle size**: 16KB optimized for Node.js
- **Features**: Directory traversal, automatic config loading, colored terminal output
- **API**: `ship.deployments.create([paths], options)`

### [🚀 CLI Usage Guide](./cli/)
Deploy from the command line with simple, intuitive commands.
- **Use case**: Terminal workflows, automation scripts, quick deploys
- **Bundle size**: 25KB CLI bundle
- **Features**: Resource-based commands, shortcuts, JSON output
- **API**: `ship deployments create ./path` or `ship ./path`

## 🎯 Quick Start

Each example follows the same modern patterns:

```js
// 1. Import and initialize
const ship = new Ship({ apiKey: 'ship-your-key' });

// 2. Deploy with progress tracking
const result = await ship.deployments.create(input, {
  // Common parent directories are now removed by default
  // To preserve directory structure: preserveDirs: true
  onProgress: (progress) => console.log(`${progress}%`)
});

// 3. Access deployment information
console.log(`✅ Deployed: https://${result.deployment}.shipstatic.dev`);
```

## 🔧 Common Configuration

All examples support hierarchical configuration loading:

1. **Constructor options** (highest priority)
2. **Environment variables**: `SHIP_API_KEY`, `SHIP_API_URL`
3. **Config files**: `.shiprc` or `package.json` (ship property)

### API Key Format
- Must start with `ship-` prefix
- 64-character hexadecimal string
- Total length: 69 characters
- Example: `ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`

## 📊 SDK Features Demonstrated

### Universal Resource API
All examples use the same resource-based interface:
- `ship.deployments.create()` - Deploy project
- `ship.deployments.list()` - List deployments  
- `ship.aliases.set()` - Manage aliases
- `ship.account.get()` - Account details

### Progressive Enhancement
- **Browser**: File objects, drag-and-drop, visual progress
- **Node.js**: Directory paths, terminal colors, config files
- **CLI**: Command shortcuts, structured output, help system

### Error Handling
Unified `ShipError` system across all environments:
```js
try {
  await ship.deployments.create(input);
} catch (error) {
  if (error.isAuthError()) {
    console.error('Authentication failed');
  } else if (error.isValidationError()) {
    console.error('Invalid input');
  }
}
```

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+ and pnpm
- Valid Shipstatic API key

### Local Development
```sh
# 1. Install and build the SDK
cd ship
pnpm install
pnpm build

# 2. Run any example
cd examples/node
pnpm install
pnpm start ./my-website

# 3. Or try the browser example
cd ../browser
pnpm start
# Open http://localhost:3000
```

## 📚 Additional Resources

- **Main SDK Documentation**: [../README.md](../README.md)
- **API Reference**: Resource methods and options
- **Types**: Full TypeScript support with `@shipstatic/types`
- **Testing**: Comprehensive test suite with examples

## 🎨 Architecture Highlights

### Modern ES Modules
All examples use native ES modules with TypeScript support and automatic environment detection.

### Zero Configuration
Automatic configuration loading eliminates boilerplate while providing flexible override options.

### Unified Error System
Single `ShipError` class with type-safe factory methods and helper functions across all environments.

### Dynamic Platform Configuration
SDK automatically fetches current platform limits (file size, count, etc.) from the API on initialization.

---

**Start with the example that matches your environment, then explore the others to see different implementation patterns! 🚀**