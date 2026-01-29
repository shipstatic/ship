# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

## Package Identity

**@shipstatic/ship** is the universal SDK and CLI for Shipstatic. It provides a clean `resource.action()` API that works identically in Node.js and Browser environments.

**Maturity:** Release candidate. Interfaces are stabilizing; changes should be deliberate and well-considered.

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
// Centralized endpoint definitions
const ENDPOINTS = {
  DEPLOYMENTS: '/deployments',
  DOMAINS: '/domains',
  TOKENS: '/tokens',
  ACCOUNT: '/account',
  CONFIG: '/config',
  PING: '/ping',
  SPA_CHECK: '/spa-check'
} as const;

// Core request method - all API calls flow through here
private async executeRequest<T>(url, options, operationName): Promise<RequestResult<T>> {
  // 1. Merge headers (auth injection)
  // 2. Create timeout signal with cleanup
  // 3. Emit 'request' event
  // 4. Make fetch call
  // 5. Handle response errors (401 → ShipError.authentication, etc.)
  // 6. Emit 'response' or 'error' event
  // 7. Parse and return { data, status }
}

// Simple request - returns data only
private async request<T>(...): Promise<T> {
  const { data } = await this.executeRequest<T>(...);
  return data;
}

// Request with status - for operations that need HTTP status (e.g., 201 vs 200)
private async requestWithStatus<T>(...): Promise<RequestResult<T>> {
  return this.executeRequest<T>(...);
}
```

**Key patterns:**
- All path parameters use `encodeURIComponent()` for safety
- Optional arrays use `tags !== undefined` (not `tags?.length`) to distinguish "not provided" from "empty"
- `requestWithStatus()` used when HTTP status matters (e.g., domain creation returns 201)

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
- Internal fields filtered: `isCreate`

### Scriptability

```bash
ship deployments list | awk '{print $1}'      # Extract first column
ship domains list | grep -E '^prod-'          # Filter by pattern
```

### Command Handler Pattern

All CLI commands use `withErrorHandling()` wrapper with consistent typing:

```typescript
// Handler signature: (client: Ship, ...args) => Promise<Result>
deploymentsCmd
  .command('get <deployment>')
  .action(withErrorHandling(
    (client: Ship, deployment: string) => client.deployments.get(deployment),
    { operation: 'get', resourceType: 'Deployment', getResourceId: (id: string) => id }
  ));
```

**Key conventions:**
- All handlers have explicit `client: Ship` type annotation
- Context object provides error message enrichment
- `getResourceId` extracts ID from args for error messages

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
// Parent command - enablePositionalOptions() required for all parent commands
const deployments = program.command('deployments').enablePositionalOptions();

// Subcommand - passThroughOptions() for commands with --tag
deployments.command('create').passThroughOptions().option('--tag <tag>', 'Tag', collect, []);
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

## Error Handling

All errors use `ShipError` from `@shipstatic/types`. See `../types/CLAUDE.md` for the full API including factory methods and type checking.

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
| `deployments.get()` | `GET /deployments/:id` | Single deployment |
| `deployments.set()` | `PATCH /deployments/:id` | Update tags only |
| `deployments.remove()` | `DELETE /deployments/:id` | Permanent deletion |
| `domains.set()` | Smart routing (see below) | Creates, updates, or tags-only |
| `domains.list()` | `GET /domains` | All domains |
| `domains.get()` | `GET /domains/:name` | Single domain |
| `domains.verify()` | `POST /domains/:name/verify` | Triggers async DNS check |
| `domains.remove()` | `DELETE /domains/:name` | Permanent deletion |
| `tokens.create()` | `POST /tokens` | New deploy token |
| `tokens.list()` | `GET /tokens` | All tokens |
| `tokens.remove()` | `DELETE /tokens/:token` | Revoke token |
| `whoami()` | `GET /account` | Current user |

### domains.set() Smart Routing

The `domains.set()` method routes to different API endpoints based on arguments:

```typescript
// With deployment → PUT (creates or updates domain)
ship.domains.set('staging', { deployment: 'abc123' });
// → PUT /domains/staging { deployment: 'abc123' }

// With deployment and tags → PUT
ship.domains.set('staging', { deployment: 'abc123', tags: ['prod'] });
// → PUT /domains/staging { deployment: 'abc123', tags: ['prod'] }

// Tags only → PATCH (update existing domain's tags)
ship.domains.set('staging', { tags: ['prod', 'v2'] });
// → PATCH /domains/staging { tags: ['prod', 'v2'] }

// No options → PUT (create/reserve domain without linking)
ship.domains.set('staging');
// → PUT /domains/staging {}
```

**Rationale:** Deployments are immutable (can only update tags), but domains can be created without a deployment (reservation) and re-pointed later.

### Domain Format and Normalization

**Domain names are FQDNs** (Fully Qualified Domain Names). The SDK passes domain names directly to the API without transformation:

```typescript
// SDK accepts any format - API normalizes
ship.domains.set('Example.COM', { deployment: 'abc123' });
// → API normalizes to 'example.com' (lowercase)
// → Returns { domain: 'example.com', ... }

// Unicode domains supported (API handles normalization)
ship.domains.set('münchen.de', { deployment: 'abc123' });
// → API normalizes as needed
// → Returns { domain: 'münchen.de', ... }
```

**SDK responsibilities:**
- ✅ URL-encode domain names in API paths (`encodeURIComponent`)
- ✅ Pass domain names as-is to the API
- ✅ Return API responses without modification

**API responsibilities (Postel's Law):**
- ✅ Accept liberal input (various cases, Unicode, etc.)
- ✅ Normalize to canonical form (lowercase, etc.)
- ✅ Validate format and reject invalid domains
- ✅ Return normalized domain in responses

**Key principle:** The SDK has **zero** domain validation or normalization logic. It's a transparent pipe between user input and the API. The API owns all domain semantics.

All responses use shared types from `@shipstatic/types`.

## Related Documentation

| Resource | Location |
|----------|----------|
| Shared types | `../types/CLAUDE.md` |
| API Worker | `../../cloudflare/api/CLAUDE.md` |
| Backend overview | `../../cloudflare/CLAUDE.md` |
| Root guidelines | `../../CLAUDE.md` |

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
