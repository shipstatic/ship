# 🚢 Ship CLI & SDK

A modern, lightweight SDK and CLI for deploying static files, designed for both **Node.js** and **Browser** environments with a clean resource-based API and comprehensive event system for observability.

## Features

- **🚀 Modern Resource API**: Clean `ship.deployments.create()` interface - no legacy wrappers
- **🌍 Universal**: Automatic environment detection (Node.js/Browser) with optimized implementations
- **📡 Event System**: Complete observability with request, response, and error events
- **🔧 Dynamic Configuration**: Automatically fetches platform limits from API
- **✅ Client-Side Validation**: Validate files before upload (size, count, MIME types)
- **📁 Flexible Input**: File paths (Node.js) or File objects (Browser/drag-drop)
- **🔐 Secure**: MD5 checksums and data integrity validation
- **📊 Progress Tracking**: Real-time deployment progress and statistics
- **⚡ Cancellable**: AbortSignal support for deployment cancellation
- **🛠️ CLI Ready**: Command-line interface for automation and CI/CD
- **📦 Bundle Optimized**: Lightweight builds (21KB Node, 185KB Browser)
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

## Import Patterns

### Default Import (Main Class)
```javascript
// ES Modules
import Ship from '@shipstatic/ship';

// CommonJS  
const Ship = require('@shipstatic/ship');
```

### Named Imports (Utilities)
```javascript
// ES Modules
import { ShipError } from '@shipstatic/ship';

// CommonJS
const { ShipError } = require('@shipstatic/ship');
```

## Quick Start

### SDK Usage

```javascript
// ES Modules
import Ship from '@shipstatic/ship';

// CommonJS
const Ship = require('@shipstatic/ship');

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

# Deploy with tags
ship deployments create ./dist --tag production --tag v1.0.0

# Explicit commands
ship deploy ./build          # Deploy project from path
ship list                    # List deployments
ship get abc123              # Get deployment details
ship remove abc123           # Remove deployment

# Manage domains
ship domains list                                   # List domains
ship domains set staging abc123                     # Set domain to deployment
ship domains set prod abc123 --tag production       # Set domain with tag
ship domains set prod abc123 --tag prod --tag v1    # Set domain with multiple tags
ship domains confirm www.example.com                # Trigger DNS confirmation
ship domains remove staging                         # Remove domain

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

// Platform limits are available for validation:
// - maxFileSize: Dynamic file size limit
// - maxFilesCount: Dynamic file count limit  
// - maxTotalSize: Dynamic total size limit
```

**Benefits:**
- **Single source of truth** - Limits only need to be changed on the API side
- **Always current** - SDK always uses current platform limits
- **Fail fast** - SDK fails if unable to fetch valid configuration

## Client-Side File Validation

Ship SDK provides utilities for validating files before upload. Validation is **atomic** - if any file is invalid, the entire upload is rejected.

```typescript
import { validateFiles, formatFileSize } from '@shipstatic/ship';

// Get platform configuration
const config = await ship.getConfig();

// Validate files before upload
const result = validateFiles(files, config);

if (result.error) {
  // Global summary
  console.error(result.error.details); // "2 files failed validation"

  // All specific errors
  result.error.errors.forEach(err => console.error(err));
  // "file1.wasm: File type 'application/wasm' is not allowed"
  // "file2.txt: File size (10 MB) exceeds limit of 5 MB"

  // Per-file status (all files marked failed in atomic validation)
  result.files.forEach(f => {
    console.log(`${f.name}: ${f.statusMessage}`);
  });
} else {
  console.log(`${result.validFiles.length} files ready to upload`);
  await ship.deployments.create(result.validFiles);
}
```

**Validation checks:**
- File count limit
- Individual file size limit
- Total deployment size limit
- MIME type validation (against allowed categories)
- Empty file detection

**Error handling:**
- `error.details` - Human-readable summary ("2 files failed validation")
- `error.errors` - Array of all validation errors for detailed display
- `file.statusMessage` - Individual file status for UI highlighting

**Utilities:**
- `validateFiles(files, config)` - Validate files against config limits
- `formatFileSize(bytes, decimals?)` - Format bytes to human-readable string
- `getValidFiles(files)` - Filter files with `READY` status
- `FILE_VALIDATION_STATUS` - Status constants for file processing

## API Reference

### Ship Class

```typescript
const ship = new Ship(options?: ShipOptions)
```

#### Options

```typescript
// TypeScript types available for both import styles
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
- `ship.domains` - Access domain resource
- `ship.account` - Access account resource
- `ship.on(event, handler)` - Add event listener for API observability
- `ship.off(event, handler)` - Remove event listener

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
  tags?: string[];                  // Optional array of tags for categorization
  signal?: AbortSignal;             // Cancellation
  subdomain?: string;               // Custom subdomain
  onCancel?: () => void;
  onProgress?: (progress: number) => void;
  progress?: (stats: ProgressStats) => void;
  maxConcurrency?: number;
  timeout?: number;
  stripCommonPrefix?: boolean;      // Remove common path prefix
}
```

### Domains Resource

```typescript
// Set or update a domain (with optional tags)
await ship.domains.set(domainName, deploymentId, tags?)

// Get domain details
await ship.domains.get(domainName)

// List all domains
await ship.domains.list()

// Remove domain
await ship.domains.remove(domainName)

// Trigger DNS confirmation for external domain
await ship.domains.confirm(domainName)
```

**Examples:**
```javascript
// Set domain without tags
await ship.domains.set('staging', 'dep_abc123');

// Set domain with tags
await ship.domains.set('production', 'dep_xyz789', ['prod', 'v1.0.0']);

// Confirm DNS for external domain
await ship.domains.confirm('www.example.com');
```

### Environment-Specific Examples

#### Node.js File Deployment

```javascript
// ES Modules
import Ship from '@shipstatic/ship';

// CommonJS  
const Ship = require('@shipstatic/ship');

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

```javascript
// ES Modules
import Ship from '@shipstatic/ship';

// Browser (ES Modules only)

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

## Event System

Ship SDK provides a comprehensive event system for complete observability of all API operations. The event system is lightweight, reliable, and provides detailed insights into requests, responses, and errors.

### Event Types

The SDK emits three core events:

- **`request`** - Emitted before each API request
- **`response`** - Emitted after successful API responses  
- **`error`** - Emitted when API requests fail

### Basic Event Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({ apiKey: 'ship-your-api-key' });

// Listen to all API requests
ship.on('request', (url, requestInit) => {
  console.log(`→ ${requestInit.method} ${url}`);
});

// Listen to all API responses
ship.on('response', (response, url) => {
  console.log(`← ${response.status} ${url}`);
});

// Listen to all API errors
ship.on('error', (error, url) => {
  console.error(`✗ Error at ${url}:`, error.message);
});

// Deploy with events
const result = await ship.deployments.create('./dist');
```

### Advanced Event Patterns

#### Request/Response Logging
```javascript
// Log all API traffic
ship.on('request', (url, init) => {
  console.log(`[${new Date().toISOString()}] → ${init.method} ${url}`);
  if (init.body) {
    console.log(`  Body: ${init.body instanceof FormData ? '[FormData]' : init.body}`);
  }
});

ship.on('response', (response, url) => {
  console.log(`[${new Date().toISOString()}] ← ${response.status} ${response.statusText} ${url}`);
});
```

#### Error Monitoring
```javascript
// Comprehensive error tracking
ship.on('error', (error, url) => {
  // Send to monitoring service
  analytics.track('ship_api_error', {
    url,
    error: error.message,
    type: error.constructor.name,
    timestamp: Date.now()
  });
});
```

#### Performance Monitoring
```javascript
const requestTimes = new Map();

ship.on('request', (url, init) => {
  requestTimes.set(url, Date.now());
});

ship.on('response', (response, url) => {
  const startTime = requestTimes.get(url);
  if (startTime) {
    const duration = Date.now() - startTime;
    console.log(`${url} took ${duration}ms`);
    requestTimes.delete(url);
  }
});
```

#### Custom Analytics Integration
```javascript
// Google Analytics integration
ship.on('request', (url, init) => {
  gtag('event', 'api_request', {
    'custom_url': url,
    'method': init.method
  });
});

ship.on('response', (response, url) => {
  gtag('event', 'api_response', {
    'custom_url': url,
    'status_code': response.status
  });
});
```

### Event Handler Management

```javascript
// Add event handlers
const requestHandler = (url, init) => console.log(`Request: ${url}`);
ship.on('request', requestHandler);

// Remove specific handlers
ship.off('request', requestHandler);

// Event handlers are automatically cleaned up when ship instance is garbage collected
```

### Event System Features

- **Reliable**: Handlers that throw errors are automatically removed to prevent cascading failures
- **Safe**: Response objects are safely cloned for event handlers to prevent body consumption conflicts
- **Lightweight**: Minimal overhead - only 70 lines of code
- **Type Safe**: Full TypeScript support with proper event argument typing
- **Clean**: Automatic cleanup prevents memory leaks

### TypeScript Event Types

```typescript
import Ship from '@shipstatic/ship';

const ship = new Ship({ apiKey: 'ship-your-api-key' });

// Fully typed event handlers
ship.on('request', (url: string, init: RequestInit) => {
  console.log(`Request to ${url}`);
});

ship.on('response', (response: Response, url: string) => {
  console.log(`Response from ${url}: ${response.status}`);
});

ship.on('error', (error: Error, url: string) => {
  console.error(`Error at ${url}:`, error);
});
```

### Event System Architecture

The event system is built directly into the HTTP client with:
- **Direct Integration**: Events are emitted from the core HTTP operations
- **Error Boundaries**: Failed event handlers don't crash API operations  
- **Response Cloning**: Dedicated response clones for events and parsing
- **Graceful Degradation**: Event system failures don't affect core functionality

## Unified Error Handling

The Ship SDK uses a unified error system with a single `ShipError` class:

```javascript
// ES Modules
import { ShipError } from '@shipstatic/ship';

// CommonJS
const { ShipError } = require('@shipstatic/ship');

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

### Domain Commands

```bash
ship domains            # List domains
ship domains set staging abc123  # Set domain to deployment
```

### Account Commands

```bash
ship account            # Get account details
```

### Global Options

```bash
--api-url <URL>         # API endpoint
--api-key <KEY>         # API key for authenticated deployments
--deploy-token <TOKEN>  # Deploy token for single-use deployments
--json                  # JSON output
```

## Bundle Sizes

**Optimized for production:**
- **Node.js**: 21KB (ESM), 21KB (CJS)
- **Browser**: 185KB (ESM with dependencies)
- **CLI**: 38KB (CJS)

**Key Optimizations:**
- ✅ **Unified error system** - Single `ShipError` class for all components
- ✅ **Dynamic platform configuration** - Fetches limits from API
- ✅ **Replaced axios with native fetch** - Bundle size reduction
- ✅ **Simplified configuration loading** - Removed async complexity
- ✅ **Streamlined multipart uploads** - `files[]` + JSON checksums format
- ✅ **Direct validation throwing** - Eliminated verbose ValidationResult pattern

## TypeScript Support

Full TypeScript support with exported types from shared `@shipstatic/types`:

```typescript
// TypeScript - works with both import styles
import type { 
  ShipOptions,
  ShipEvents,
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
- **Event system**: Comprehensive observability with lightweight, reliable events
- **Type safety**: Strict TypeScript with comprehensive error types
- **Dynamic configuration**: Platform limits fetched from API
- **Unified DTOs**: Shared type definitions from `@shipstatic/types`

### Codebase Organization
```
src/
├── browser/                 # Browser-specific implementations
│   ├── core/               # Browser configuration and setup
│   ├── index.ts           # Browser SDK exports
│   └── lib/               # Browser file handling
├── node/                   # Node.js-specific implementations
│   ├── cli/               # CLI command implementations
│   ├── completions/       # Shell completion scripts
│   ├── core/              # Node.js configuration and file handling
│   └── index.ts           # Node.js SDK exports
├── shared/                 # Cross-platform shared code
│   ├── api/               # HTTP client and API communication
│   ├── base-ship.ts       # Base Ship class implementation
│   ├── core/              # Configuration and constants
│   ├── events.ts          # Event system implementation
│   ├── lib/               # Utility libraries
│   ├── resources.ts       # Resource implementations
│   └── types.ts           # Shared type definitions
└── index.ts               # Main SDK exports with environment detection

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

## Features & Capabilities

Ship SDK provides comprehensive deployment functionality:

- **Deployment Resource**: Complete operations (create, list, get, remove)
- **Domain Resource**: Complete operations (set, get, list, remove)
- **Account Resource**: Account information retrieval
- **Event System**: Comprehensive observability with request, response, error events
- **Unified Error System**: Single `ShipError` class with factory methods
- **Dynamic Platform Config**: Automatic limit fetching from API
- **Simple CLI**: Deploy shortcut + explicit commands
- **Streamlined Multipart**: `files[]` array + JSON checksums format
- **Direct Validation**: Functions throw errors for immediate feedback
- **Shared DTOs**: All types from `@shipstatic/types` package
- **Tree-shakeable**: `"sideEffects": false` for optimal bundling
- **Production Ready**: Clean, reliable implementation with comprehensive test coverage
- **Native APIs**: Built on `fetch`, `crypto`, and `fs` for optimal performance
- **Modern TypeScript**: Full type safety with ESM modules

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

**Current Status:** 614 tests passing (614 total) ✅

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