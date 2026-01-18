# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

## Package Identity

**@shipstatic/ship** is the universal SDK and CLI for Shipstatic. It provides a clean `resource.action()` API that works identically in Node.js and Browser environments.

## Architecture

```
src/
├── shared/              # Cross-platform code (70% of codebase)
│   ├── api/http.ts      # HTTP client with events, timeout, auth
│   ├── base-ship.ts     # Base Ship class (auth state, init)
│   ├── resources.ts     # Resource factories (deployments, domains, etc.)
│   ├── events.ts        # Event system (request, response, error)
│   ├── types.ts         # Internal SDK types
│   ├── core/            # Configuration resolution
│   └── lib/             # Utilities (validation, junk filtering, MD5, SPA detection)
├── browser/             # Browser-specific
│   ├── index.ts         # Browser Ship class
│   ├── core/            # Browser config, body creation
│   └── lib/             # File object handling
└── node/                # Node.js-specific
    ├── index.ts         # Node Ship class
    ├── cli/             # CLI commands (Commander.js)
    ├── core/            # Node config, file discovery, body creation
    └── completions/     # Shell completions
```

## Quick Reference

```bash
pnpm test --run              # All tests
pnpm test:unit --run         # Pure functions only (~1s)
pnpm test:integration --run  # SDK/CLI with mock server
pnpm test:e2e --run          # Real API (requires SHIP_E2E_API_KEY)
pnpm build                   # Build all bundles
```

### Key Files

| File | Purpose |
|------|---------|
| `src/shared/resources.ts` | Resource factory implementations |
| `src/shared/api/http.ts` | HTTP client (all API calls) |
| `src/shared/base-ship.ts` | Base Ship class (auth, init) |
| `src/node/cli/index.ts` | CLI command definitions |
| `src/node/cli/utils.ts` | CLI formatting utilities |
| `src/node/cli/formatters.ts` | Resource-specific output formatters |
| `tests/fixtures/api-responses.ts` | Typed API response fixtures |

## Core Patterns

### Resource Factory Pattern

Resources are created via factory functions that receive context:

```typescript
interface ResourceContext {
  getApi: () => ApiHttp;      // Lazy API client access
  ensureInit: () => Promise<void>;  // Ensure config loaded
}

// Usage in Ship class
this.deployments = createDeploymentResource({
  getApi: () => this.api,
  ensureInit: () => this.ensureInitialized(),
  processInput: (input, opts) => this.processInput(input, opts),
  clientDefaults: this.options,
  hasAuth: () => this.hasAuth()
});
```

**Why this pattern:** Enables functional composition without tight coupling. The factory doesn't need the full Ship instance, just the callbacks it needs.

### HTTP Client Architecture

`ApiHttp` in `src/shared/api/http.ts`:

```typescript
// All requests go through this.request()
private async request<T>(url, options, operationName): Promise<T> {
  // 1. Inject auth headers
  // 2. Set up timeout with AbortController
  // 3. Emit 'request' event
  // 4. Make fetch call
  // 5. Handle errors (401 → ShipError.authentication, etc.)
  // 6. Emit 'response' or 'error' event
  // 7. Parse and return JSON
}
```

**Events for debugging:**
```typescript
ship.on('request', (url, init) => console.log('→', url));
ship.on('response', (response, url) => console.log('←', response.status));
ship.on('error', (error, url) => console.error('✗', error));
```

### Authentication Flow

```
1. Ship instantiated with options (apiKey, deployToken, or neither)
2. On first API call, ensureInit() runs:
   - Loads config from files (.shiprc, package.json)
   - Merges with constructor options
   - Validates configuration
3. getAuthHeaders() called on every request:
   - Returns { Authorization: 'Bearer xxx' } or {}
   - Deploy token overrides API key for single request
```

**Token precedence:** Deploy token (per-request) > API key (instance) > Cookie (browser)

### Cross-Platform File Handling

```typescript
// Node.js: paths or StaticFile[]
ship.deployments.create('./dist');
ship.deployments.create([{ path: 'index.html', content: Buffer.from('...') }]);

// Browser: File objects or StaticFile[]
ship.deployments.create(fileInput.files);
ship.deployments.create([{ path: 'index.html', content: new Blob(['...']) }]);
```

**Content type detection:**
```typescript
// In http.ts checkSPA()
if (Buffer.isBuffer(content)) { /* Node */ }
else if (content instanceof Blob) { /* Browser */ }
else if (content instanceof File) { /* Browser */ }
```

## CLI Patterns

### Output Conventions

| Type | Format | Color |
|------|--------|-------|
| Success | `message` | Green |
| Error | `🔴 message` | Red |
| Warning | `[warning] message` | Yellow |
| Info | `[info] message` | Blue |

### JSON Mode

When `--json` flag is used:
- Success: `{ "data": ... }`
- Error: `{ "error": "message" }`

### Table Output

- **3 spaces** between columns (matches ps, kubectl, docker)
- Headers are dimmed
- Property order matches API response exactly
- Internal fields filtered: `verified`, `isCreate`

### Scriptability

```bash
ship deployments list | awk '{print $1}'      # Extract first column
ship domains list | grep -E '^prod-'          # Filter by pattern
```

### Commander.js Option Merging

When both parent and subcommand define `--tag`:

```typescript
.action(async (directory, cmdOptions) => {
  const programOpts = program.opts();
  // Subcommand options take precedence
  const tagArray = cmdOptions?.tag?.length > 0 ? cmdOptions.tag : programOpts.tag;
});
```

Required configuration for option inheritance:
```typescript
// Parent command
const deployments = program.command('deployments').enablePositionalOptions();

// Subcommand
deployments.command('create').passThroughOptions().option('-t, --tag <tags...>');
```

## Testing

### Test Types

| Pattern | Description | Mock Server |
|---------|-------------|-------------|
| `*.unit.test.ts` | Pure functions, no I/O | No |
| `*.test.ts` | SDK/CLI with mocked API | Yes |
| `*.e2e.test.ts` | Real API integration | No (real API) |

### Test Directory Structure

```
tests/
├── shared/           # Shared code tests
├── browser/          # Browser-specific tests
├── node/             # Node SDK + CLI tests
├── integration/      # Cross-environment parity
├── e2e/              # Real API smoke tests
├── fixtures/         # Typed API response fixtures
├── mocks/            # Mock HTTP server
└── setup.ts          # Mock server lifecycle
```

### Mock Server

Runs on `http://localhost:3000` with typed fixtures:

```typescript
import { deployments, errors } from '../fixtures/api-responses';

// Type-safe with compile-time validation via `satisfies`
expect(result).toMatchObject(deployments.success);
```

**Important:** Tests run sequentially (`fileParallelism: false`) to share the mock server.

### When API Changes

1. Update types in `@shipstatic/types`
2. Update fixtures in `tests/fixtures/api-responses.ts`
3. TypeScript errors guide remaining updates

## Adding New Features

### New SDK Method

1. Add type to `@shipstatic/types` (resource interface)
2. Add method to `ApiHttp` in `src/shared/api/http.ts`
3. Add wrapper in resource factory (`src/shared/resources.ts`)
4. Add fixture in `tests/fixtures/api-responses.ts`
5. Add tests

### New CLI Command

1. Add command in `src/node/cli/index.ts`
2. Add formatter in `src/node/cli/formatters.ts` (if needed)
3. Add tests in `tests/node/cli/`

### New Shared Utility

1. Add to `src/shared/lib/`
2. Export from `src/shared/lib/index.ts` if public
3. Add unit tests in `tests/shared/lib/`

## SPA Auto-Detection

The SDK auto-detects Single Page Applications:

```typescript
// In api/http.ts
async checkSPA(files: StaticFile[]): Promise<boolean> {
  // 1. Find index.html (must be < 100KB)
  // 2. Extract content (handles Buffer, Blob, File)
  // 3. POST to /spa-check with file list and index content
  // 4. API analyzes for SPA patterns (React, Vue, etc.)
  // 5. Returns true/false
}
```

When SPA detected, deployment automatically includes rewrite rules for client-side routing.

## Error Types

All errors use `ShipError` from `@shipstatic/types`:

```typescript
ShipError.validation('message')    // Invalid input
ShipError.authentication('message') // 401 errors
ShipError.network('message', cause) // Fetch failures
ShipError.file('message', path)    // File operations
ShipError.api('message', status)   // API errors
ShipError.cancelled('message')     // AbortController
ShipError.config('message')        // Configuration errors
ShipError.business('message')      // General business logic
```

Check error types:
```typescript
if (error.isAuthError()) { /* re-authenticate */ }
if (error.isNetworkError()) { /* retry */ }
if (error.isValidationError()) { /* show to user */ }
```

## Bundle Sizes

- **Node.js**: 21KB (ESM), 21KB (CJS)
- **Browser**: 185KB (ESM with dependencies)
- **CLI**: 38KB (CJS)

## Design Principles

1. **Scriptability first** - CLI output works with Unix tools
2. **API consistency** - Property order matches API exactly
3. **Impossible simplicity** - Everything should "just work"
4. **No backward compatibility** - Remove unused code aggressively
5. **Native APIs** - Built on `fetch`, `crypto`, `fs` (no axios, no polyfills)
6. **Functional composition** - Resource factories over class hierarchies

## Known Gotchas

### Tests Must Run Sequentially
Mock server is shared across tests. Don't add `fileParallelism: true`.

### Deploy Token vs API Key
- **API Key**: Persistent, used for all requests
- **Deploy Token**: Single-use, consumed on successful deploy, overrides API key

### Browser File Handling
Browser uses `File` objects from `<input type="file">`. The SDK handles path extraction from `webkitRelativePath` or `name`.

### Config File Loading
Node.js loads config from (in order):
1. Constructor options
2. Environment variables (`SHIP_API_KEY`, `SHIP_API_URL`)
3. `.shiprc` in current directory
4. `package.json` `"ship"` key

## Backend Integration

The SDK maps directly to API endpoints:

| SDK Method | API Endpoint | Notes |
|------------|--------------|-------|
| `deployments.create()` | `POST /deployments` | Multipart upload |
| `deployments.list()` | `GET /deployments` | Paginated |
| `domains.set()` | `PUT /domains/:name` | Creates or updates |
| `domains.verify()` | `POST /domains/:name/verify` | Triggers async DNS check |
| `account.get()` | `GET /account` | Current user |

All responses use shared types from `@shipstatic/types`.

## Related Documentation

| Resource | Location |
|----------|----------|
| Shared types | `../types/README.md` |
| API Worker | `../../cloudflare/api/CLAUDE.md` |
| Backend overview | `../../cloudflare/CLAUDE.md` |
| Root guidelines | `../../CLAUDE.md` |

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
