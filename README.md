# 🚢 Ship CLI & SDK

A modern, lightweight SDK and CLI for deploying static files, designed for both **Node.js** and **Browser** environments with a clean resource-based API.

## Features

- **🚀 Modern Resource API**: Clean `ship.deployments.create()` interface - no legacy wrappers
- **🌍 Universal**: Automatic environment detection (Node.js/Browser) with optimized implementations  
- **🔧 Dynamic Configuration**: Automatically fetches platform limits from API
- **📁 Flexible Input**: File paths (Node.js) or File objects (Browser/drag-drop)
- **🔐 Secure**: MD5 checksums and data integrity validation
- **📊 Progress Tracking**: Real-time deployment progress and statistics
- **⚡ Cancellable**: AbortSignal support for deployment cancellation
- **🛠️ CLI Ready**: Command-line interface for automation and CI/CD
- **📦 Bundle Optimized**: Lightweight builds (16KB Node, 275KB Browser)
- **🎯 Unified Error System**: Consistent `ShipError` handling across all components

## Installation

### CLI Usage

```bash
npm install -g @shipstatic/ship
```

### SDK Usage

```bash
npm install @shipstatic/ship
```

## Quick Start

### SDK Usage

```typescript
import { Ship } from '@shipstatic/ship';

// Authenticated deployments with API key
const ship = new Ship({
  apiUrl: 'https://api.shipstatic.com',
  apiKey: 'ship-your-64-char-hex-string'  // API key: ship- prefix + 64-char hex (69 chars total)
});

// OR single-use deployments with deploy token
const ship = new Ship({
  apiUrl: 'https://api.shipstatic.com',
  deployToken: 'token-your-64-char-hex-string'  // Deploy token: token- prefix + 64-char hex (70 chars total)
});

// Deploy project - SDK automatically fetches platform configuration
const result = await ship.deployments.create(['./dist'], {
  onProgress: (progress) => console.log(`${progress}%`)
});

console.log(`Deployed: ${result.deployment}`);
```

### CLI Usage

```bash
# Deploy shortcut - deploy a directory
ship ./dist

# Or deploy current directory
ship

# Explicit commands
ship deploy ./build          # Deploy project from path
ship list                    # List deployments
ship get abc123              # Get deployment details
ship remove abc123           # Remove deployment

# Manage aliases
ship aliases                 # List aliases
ship alias staging abc123    # Set alias to deployment

# Account
ship account                 # Get account details

# Connectivity
ship ping                    # Check API connectivity
```

## Dynamic Platform Configuration

Ship SDK automatically fetches platform configuration from the API on initialization:

```typescript
// SDK automatically calls GET /config and applies limits
const ship = new Ship({ apiKey: 'ship-your-key' });

// Platform limits are now available for validation:
// - maxFileSize: Dynamic file size limit
// - maxFilesCount: Dynamic file count limit  
// - maxTotalSize: Dynamic total size limit
```

**Benefits:**
- **Single source of truth** - Limits only need to be changed on the API side
- **Automatic updates** - SDK always uses current platform limits
- **Fail fast** - SDK fails if unable to fetch valid configuration

## API Reference

### Ship Class

```typescript
const ship = new Ship(options?: ShipOptions)
```

#### Options

```typescript
interface ShipOptions {
  apiUrl?: string;        // API endpoint (default: https://api.shipstatic.com)
  apiKey?: string;        // API key: ship- prefix + 64-char hex (69 chars total)
  deployToken?: string;   // Deploy token: token- prefix + 64-char hex (70 chars total)
  timeout?: number;       // Request timeout (ms)
}
```

#### Methods

- `ship.ping()` - Check API connectivity
- `ship.deployments` - Access deployment resource
- `ship.aliases` - Access alias resource  
- `ship.account` - Access account resource

### Deployments Resource

```typescript
// Deploy project
await ship.deployments.create(input, options?)

// List deployments
await ship.deployments.list()

// Remove deployment
await ship.deployments.remove(id)

// Get deployment details
await ship.deployments.get(id)
```

#### Deploy Input Types

**Node.js Environment:**
```typescript
type NodeDeployInput = string[];  // File paths
```

**Browser Environment:**
```typescript
type BrowserDeployInput = FileList | File[] | HTMLInputElement;
```

#### Deploy Options

```typescript
interface DeployOptions {
  apiUrl?: string;
  apiKey?: string;                  // API key: ship- prefix + 64-char hex (69 chars total)
  deployToken?: string;             // Deploy token: token- prefix + 64-char hex (70 chars total)
  signal?: AbortSignal;           // Cancellation
  subdomain?: string;             // Custom subdomain
  onCancel?: () => void;
  onProgress?: (progress: number) => void;
  progress?: (stats: ProgressStats) => void;
  maxConcurrency?: number;
  timeout?: number;
  stripCommonPrefix?: boolean;    // Remove common path prefix
}
```

### Environment-Specific Examples

#### Node.js File Deployment

```typescript
import { Ship } from '@shipstatic/ship';

const ship = new Ship({
  apiUrl: 'https://api.shipstatic.com',
  apiKey: process.env.SHIP_API_KEY  // ship-abc123...
});

// Deploy project and directories
const result = await ship.deployments.create([
  './dist/index.html',
  './dist/assets',
  './public'
], {
  stripCommonPrefix: true,
  onProgress: (progress) => {
    console.log(`Deployment: ${progress}% complete`);
  }
});

console.log(`✅ Deployed: ${result.deployment}`);
```

#### Browser File Upload

```typescript
import { Ship } from '@shipstatic/ship';

const ship = new Ship({
  apiUrl: 'https://api.shipstatic.com',
  apiKey: 'ship-your-64-char-hex-string'  // 69 chars total
});

// From file input
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const result = await ship.deployments.create(fileInput, {
  onProgress: (progress) => {
    document.getElementById('progress').textContent = `${progress}%`;
  }
});

// From File objects
const files: File[] = Array.from(fileInput.files || []);
const result2 = await ship.deployments.create(files);
```

## Unified Error Handling

The Ship SDK uses a unified error system with a single `ShipError` class:

```typescript
import { ShipError } from '@shipstatic/ship';

try {
  await ship.deployments.create(['./dist']);
} catch (error) {
  if (error instanceof ShipError) {
    console.error(`Ship Error: ${error.message}`);
    
    // Type-safe error checking
    if (error.isClientError()) {
      console.error(`Client Error: ${error.message}`);
    } else if (error.isNetworkError()) {
      console.error(`Network Error: ${error.message}`);
    } else if (error.isAuthError()) {
      console.error(`Auth Error: ${error.message}`);
    } else if (error.isValidationError()) {
      console.error(`Validation Error: ${error.message}`);
    }
  }
}
```

### Error Types

```typescript
// Factory methods for creating errors
ShipError.validation(message, details)    // Validation failed (400)
ShipError.notFound(resource, id)          // Resource not found (404)
ShipError.rateLimit(message)              // Rate limit exceeded (429)
ShipError.authentication(message)         // Authentication required (401)
ShipError.business(message, status)       // Business logic error (400)
ShipError.network(message, cause)         // Network/connection error
ShipError.cancelled(message)              // Operation was cancelled
ShipError.file(message, filePath)         // File operation error
ShipError.config(message)                 // Configuration error

// Type checking methods
error.isClientError()       // Client-side errors
error.isNetworkError()      // Network/connection issues
error.isAuthError()         // Authentication problems
error.isValidationError()   // Input validation failures
error.isFileError()         // File operation errors
error.isConfigError()       // Configuration problems
```

## Authentication

The Ship SDK supports two authentication methods:

### API Keys (Authenticated Deployments)
For persistent authentication with full account access:

```typescript
const ship = new Ship({
  apiKey: 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
});
```

### Deploy Tokens (Single-Use Deployments)
For temporary, single-use deployments:

```typescript
const ship = new Ship({
  deployToken: 'token-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
});
```

### API Requests

The SDK automatically sends credentials using standard Bearer token format:

```
Authorization: Bearer ship-your-64-char-hex-string   // API key (69 chars total)
Authorization: Bearer token-your-64-char-hex-string  // Deploy token (70 chars total)
```

## Configuration

Configuration is loaded hierarchically (highest precedence first):

1. **Constructor options** - Direct parameters to `new Ship()`
2. **Environment variables** - `SHIP_API_URL`, `SHIP_API_KEY` (Node.js only)  
3. **Config files** - `.shiprc` or `package.json` (ship key) in project directory (Node.js only)

### Config File Format

**.shiprc:**
```json
{
  "apiUrl": "https://api.shipstatic.com",
  "apiKey": "ship-your-api-key"
}
```

**package.json:**
```json
{
  "ship": {
    "apiUrl": "https://api.shipstatic.com",
    "apiKey": "ship-your-api-key"
  }
}
```

### Environment Variables

```bash
export SHIP_API_URL="https://api.shipstatic.com"
export SHIP_API_KEY="ship-your-api-key"
export SHIP_DEPLOY_TOKEN="token-your-deploy-token"
```

## CLI Commands

### Deployment Commands

```bash
ship                    # List deployments (no args)
ship ./dist             # Deploy specific directory  
ship deploy ./build     # Explicit deploy command
ship list               # List deployments
ship get abc123         # Get deployment details
ship remove abc123      # Remove deployment
```

### Alias Commands

```bash
ship aliases            # List aliases
ship alias staging abc123  # Set alias to deployment
```

### Account Commands

```bash
ship account            # Get account details
```

### Global Options

```bash
-u, --apiUrl <URL>         # API endpoint
-k, --apiKey <KEY>         # API key for authenticated deployments
--deploy-token <TOKEN>     # Deploy token for single-use deployments
--json                     # JSON output
```

## Bundle Sizes

**Optimized for production:**
- **Node.js**: 16KB (ESM), 17KB (CJS)
- **Browser**: 275KB (ESM with dependencies)
- **CLI**: 25KB (CJS)

**Recent Optimizations:**
- ✅ **Unified error system** - Single `ShipError` class for all components
- ✅ **Dynamic platform configuration** - Fetches limits from API
- ✅ **Replaced axios with native fetch** - Bundle size reduction
- ✅ **Simplified configuration loading** - Removed async complexity
- ✅ **Streamlined multipart uploads** - `files[]` + JSON checksums format
- ✅ **Direct validation throwing** - Eliminated verbose ValidationResult pattern

## TypeScript Support

Full TypeScript support with exported types from shared `@shipstatic/types`:

```typescript
import type { 
  ShipOptions,
  NodeDeployInput,
  BrowserDeployInput, 
  DeployOptions,
  DeploySuccessResponse,
  ProgressStats,
  StaticFile,
  ShipError,
  ErrorType
} from '@shipstatic/ship';
```

## Architecture

### Modern SDK Design
- **Class-based API**: `new Ship()` with resource properties
- **Environment detection**: Automatic Node.js/Browser optimizations
- **Native dependencies**: Uses built-in `fetch`, `crypto`, and `fs` APIs
- **Type safety**: Strict TypeScript with comprehensive error types
- **Dynamic configuration**: Platform limits fetched from API
- **Unified DTOs**: Shared type definitions from `@shipstatic/types`

### Codebase Organization
```
src/
├── core/                    # Cross-cutting concerns
│   ├── config.ts           # Configuration loading and merging
│   └── constants.ts        # Platform constants and defaults
├── lib/                    # Utility libraries (renamed from utils/)
│   ├── env.js              # Environment detection
│   ├── node-files.ts       # Node.js file system operations
│   ├── prepare-input.ts    # Input preparation (renamed from input-conversion.ts)
│   └── path.ts             # Path utilities (renamed from path-helpers.ts)
├── cli.ts                  # CLI implementation (moved from cli/index.ts)
├── index.ts                # Main SDK exports
└── types.ts                # All SDK types (consolidated from types/)

### File Processing Pipeline
**Node.js:**
```
File Paths → Discovery → Junk Filtering → Base Directory → Content Processing → StaticFile[]
```

**Browser:**
```
File Objects → Path Extraction → Junk Filtering → Content Processing → StaticFile[]
```

### Configuration System
- **Synchronous loading**: No async complexity for file config
- **Dynamic platform config**: Fetched from API on first use
- **Minimal search**: Only `.shiprc` and `package.json`
- **Simple validation**: Native type checking
- **Environment variables**: `SHIP_*` prefix for clarity

### Error System Architecture
- **Single source of truth**: All errors use `ShipError` from `@shipstatic/types`
- **Type-safe factories**: Specific factory methods for each error type
- **Wire format support**: Automatic serialization/deserialization
- **Helper methods**: Easy type checking with `is*Error()` methods

## Development Status

This is an **unlaunched project** optimized for modern development:

- ✅ **Deployment Resource**: Full implementation (create, list, get, remove)
- ✅ **Alias Resource**: Full implementation (set, get, list, remove)  
- ✅ **Account Resource**: Full implementation (get account details)
- ✅ **Unified Error System**: Single `ShipError` class with factory methods
- ✅ **Dynamic Platform Config**: Automatic limit fetching from API
- ✅ **Ultra-Simple CLI**: Deploy shortcut + explicit commands
- ✅ **Streamlined Multipart**: `files[]` array + JSON checksums format
- ✅ **Direct Validation**: Functions throw errors instead of returning results
- ✅ **Shared DTOs**: All types from `@shipstatic/types` package
- ✅ **Impossible Simplicity**: Maximum functionality with minimal complexity
- 🎯 No legacy compatibility constraints
- 🔧 Native fetch API for optimal performance
- ⚡ Modern ESM modules with TypeScript

## Testing

Comprehensive test coverage with modern tooling:

```bash
# Run all tests
pnpm test --run

# Run specific test suites
pnpm test tests/utils/node-files.test.ts --run
pnpm test tests/api/http.test.ts --run

# Build and test
pnpm build && pnpm test --run
```

**Test Organization:**
- **Unit tests**: Pure function testing
- **Integration tests**: Component interaction testing  
- **Edge case tests**: Boundary condition testing
- **Browser tests**: FileList and File object handling
- **Node.js tests**: Filesystem and path manipulation
- **Error tests**: Unified error handling patterns

**Current Status:** 264 tests passing ✅

## Contributing

The codebase prioritizes simplicity and maintainability:

- **"Do More with Less"** - Built-in over dependencies
- **No backward compatibility** constraints
- **Modern ES modules** and TypeScript
- **Comprehensive test coverage**
- **Clean resource-based** architecture
- **Unified error handling** across all components
- **Shared type system** via `@shipstatic/types`
- **Declarative code patterns** over imperative complexity

---

**Ship** - Deploy static files with modern tooling ⚡