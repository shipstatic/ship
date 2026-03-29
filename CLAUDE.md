# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

**@shipstatic/ship** — universal SDK and CLI for ShipStatic. Clean `resource.action()` API, identical in Node.js and Browser. **Maturity:** Release candidate; interfaces stabilizing.

## Architecture

```
src/
├── shared/              # Cross-platform code (70% of codebase)
│   ├── api/http.ts      # HTTP client with events, timeout, auth
│   ├── base-ship.ts     # Base Ship class (auth state, init, resources)
│   ├── resources.ts     # Resource factories (deployments, domains, etc.)
│   ├── types.ts         # Internal SDK types
│   ├── core/            # Configuration resolution
│   └── lib/             # Utilities (validation, junk filtering, MD5, SPA detection)
├── browser/             # Browser Ship class + file handling
└── node/                # Node Ship class + CLI (Commander.js) + config loading
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
| `src/shared/base-ship.ts` | Base Ship class (auth, init, top-level methods) |
| `src/node/cli/index.ts` | CLI command definitions, `withErrorHandling`, `performDeploy` |
| `src/node/cli/utils.ts` | Output primitives (`success`, `error`, `warn`, `info`, `formatTable`, `formatDetails`) |
| `src/node/cli/formatters.ts` | Resource-specific output formatters, `formatOutput` router |
| `src/node/cli/types.ts` | CLI option and result types (`GlobalOptions`, `CLIResult`, `EnrichedDomain`) |
| `src/node/cli/error-handling.ts` | Pure error formatting (`getUserMessage`, `toShipError`) |
| `src/node/cli/config.ts` | Interactive `ship config` wizard |
| `src/node/cli/completion.ts` | Shell completion install/uninstall |
| `tests/fixtures/api-responses.ts` | Typed API response fixtures |

## Core Patterns

### Ship Class Public Surface (base-ship.ts)

```typescript
// Resources
ship.deployments / ship.domains / ship.account / ship.tokens

// Convenience shortcuts
ship.deploy(input, options?)   // → deployments.upload()
ship.whoami()                  // → account.get()

// Top-level
ship.ping()                    // returns boolean
ship.getConfig()               // returns ConfigResponse (cached after init)
ship.setApiKey(key)
ship.setDeployToken(token)
ship.on(event, handler)
ship.off(event, handler)
```

### Resource Factory Pattern

Resources are factory functions that receive a `ResourceContext` (`getApi`, `ensureInit`) instead of the full Ship instance. This enables functional composition: factories only depend on the callbacks they actually need. Deployment resource additionally receives `processInput`, `clientDefaults`, and `hasAuth`.

### HTTP Client Architecture

`ApiHttp` in `src/shared/api/http.ts` — all API calls flow through `executeRequest`, which handles header merging, timeout, event emission, and error mapping. Two public variants: `request<T>()` returns data directly; `requestWithStatus<T>()` returns `{ data, status }` for operations where HTTP status matters (e.g. 201 vs 200 on domain upsert).

**Key patterns:**
- All path parameters use `encodeURIComponent()`
- Optional arrays: use `labels !== undefined` (not `labels?.length`) — distinguishes "not provided" from "empty array"
- `requestWithStatus()` used when HTTP status drives behavior (domain creation: 201 = `isCreate: true`)

**Events:**
```typescript
ship.on('request', (url, init) => ...);
ship.on('response', (response, url) => ...);
ship.on('error', (error, url) => ...);
```

### Authentication Flow

Init is lazy — triggered on first API call via `ensureInitialized()`, which loads config from files/env and replaces the HTTP client while preserving event listeners.

**Token precedence:** Deploy token (per-request) > API key (instance) > Cookie (browser, `useCredentials: true`)

### Cross-Platform File Input

```typescript
// Node.js: string path(s) or StaticFile[]
ship.deploy('./dist');
ship.deploy([{ path: 'index.html', content: Buffer.from('...') }]);

// Browser: FileList/File[] or StaticFile[]
ship.deploy(fileInput.files);
ship.deploy([{ path: 'index.html', content: new Blob(['...']) }]);
```

### Server-Processed Uploads (Build/Prerender)

When `build` or `prerender` options are set on `DeploymentUploadOptions`, the SDK enters a pass-through mode:

- **`filterJunk`** accepts `{ allowUnbuilt: true }` — skips the unbuilt project marker check (source files have `package.json`, `node_modules`)
- **`processFilesForBrowser`** has two modes (early return pattern in `browser-files.ts`):
  - **Deploy** (default): full validation pipeline (security, extensions, sizes, counts)
  - **Server-processed** (`build`/`prerender`): junk filtering + MD5 checksums only
- **`detectAndConfigureSPA`** skips when `build` or `prerender` is set — the build service handles SPA detection on its output
- **`createDeployBody`** appends `build=true` / `prerender=true` to the FormData

These are `@internal` flags — only used by the web app (`web/my`) via the `/upload` endpoint. CLI users build locally and deploy the output.

## CLI Patterns

### Output Conventions

| Type | Text format | JSON format | Quiet (`-q`) format |
|------|------------|-------------|---------------------|
| Success message | green text | `{ "success": "..." }` | — |
| Data (single) | key-value pairs | raw JSON object | key identifier only |
| Data (list) | table | raw JSON object | one identifier per line |
| Void/ping | success/error text | `{ "success": "..." }` | no output (exit code) |
| Error | `[error]` prefix, red | `{ "error": "..." }` | stderr (unchanged) |

- Text messages are lowercased; trailing periods stripped
- Removal operations (void result) produce a success message
- Internal fields (`isCreate`, `_dnsRecords`, `_shareHash`) are stripped from JSON output
- `[error]`/`[warning]`/`[info]` prefixes use inverse color backgrounds in TTY

### Composability

`-q` outputs only the key identifier — the value you'd pipe forward. `domains set` reads deployment from stdin when piped.

```bash
ship ./dist -q | ship domains set www.example.com
```

### Table Output

- **3 spaces** between columns (matches ps, kubectl, docker)
- Headers are dimmed; property names can be remapped via `headerMap`
- Property order matches API response exactly
- `INTERNAL_FIELDS` list (`['isCreate']`) is filtered from all output

### `processOptions` Helper

Always call `processOptions(this)` inside action handlers — not `program.opts()`. It converts Commander's `--no-color` (which sets `color: false`) to the `noColor: true` convention used throughout.

### `performDeploy` Helper

Shared deploy logic used by both `ship <path>` shortcut and `ship deployments upload`. Handles: path existence/type validation, option merging (labels, `--no-path-detect`, `--no-spa-detect`), AbortController for Ctrl+C, and a spinner (TTY only, suppressed in `--json` and `--no-color` modes).

### Command Handler Pattern

```typescript
// Handler: (client: Ship, options: GlobalOptions, ...positional args) => Promise<CLIResult>
deploymentsCmd
  .command('get <deployment>')
  .action(withErrorHandling(
    (client: Ship, _options: GlobalOptions, deployment: string) =>
      client.deployments.get(deployment),
    { operation: 'get', resourceType: 'Deployment', getResourceId: (id: string) => id }
  ));
```

The context object (`operation`, `resourceType`, `getResourceId`) enriches error messages. `getResourceId` extracts the ID from positional args.

### `formatOutput` Router

Routes by result shape (discriminated union) — order matters:

```
'deployments' in result  → formatDeploymentsList
'domains' in result      → formatDomainsList
'tokens' in result       → formatTokensList
'domain' in result       → formatDomain        // plain Domain or EnrichedDomain
'deployment' in result   → formatDeployment
'token' in result        → formatToken
'email' in result        → formatAccount
'valid' in result        → formatDomainValidate
'message' in result      → formatMessage
boolean                  → ping result
undefined                → removal success message
```

### DNS Enrichment on Domain Create

When `ship domains set <name> [deployment]` creates a new external domain (`isCreate: true`, name contains `.`), the CLI fetches `domains.records()` and `domains.share()` in parallel, attaching results as `_dnsRecords` and `_shareHash` on the result for the formatter to display. This is CLI-only behavior; SDK resources return plain data.

### Commander.js Option Merging

When both parent and subcommand define `--label`, subcommand options take precedence via `mergeLabelOption(cmdOptions, program.opts())`. Required boilerplate:
- Parent commands: `.enablePositionalOptions()`
- Subcommands with `--label`: `.passThroughOptions()`

## SDK-Local Types

`DomainSetResult = Domain & { isCreate: boolean }` — HTTP 201 vs 200 determines `isCreate`. Defined in `src/shared/types.ts`.

`EnrichedDomain extends DomainSetResult` — adds optional `_dnsRecords` and `_shareHash` for CLI display. `CLIResult` is the discriminated union of all possible command outputs. Both in `src/node/cli/types.ts`.

## Testing

| Pattern | Description | Mock Server |
|---------|-------------|-------------|
| `*.unit.test.ts` | Pure functions, no I/O | No |
| `*.test.ts` | SDK/CLI with mocked API | Yes (localhost:3000) |
| `*.e2e.test.ts` | Real API integration | No (real API) |

Tests run sequentially (`fileParallelism: false`) — mock server is shared. Don't change this.

```
tests/
├── shared/ browser/ node/ integration/ e2e/
├── fixtures/api-responses.ts   # Typed response fixtures (satisfies for compile-time validation)
├── mocks/                      # Mock HTTP server
└── setup.ts                    # Mock server lifecycle
```

**When API changes:** Update types in `@shipstatic/types` → update `tests/fixtures/api-responses.ts` → TypeScript errors guide the rest.

## Adding New Features

**New SDK method:** `@shipstatic/types` (interface) → `api/http.ts` (HTTP call) → `resources.ts` (factory wrapper) → fixture → tests.

**New CLI command:** `cli/index.ts` (command + `withErrorHandling`) → `cli/formatters.ts` (formatter if needed) → `cli/types.ts` (`CLIResult` union if needed) → tests.

**New shared utility:** `src/shared/lib/` → export from `lib/index.ts` if public → unit tests.

## SPA Auto-Detection

On upload, the SDK POSTs `index.html` content (must be < 100KB) to `/spa-check` along with the file list. If the API detects SPA patterns (React router, Vue, etc.), the deployment gets rewrite rules for client-side routing. Disable with `spaDetect: false` (SDK) or `--no-spa-detect` (CLI).

## Error Handling

All errors use `ShipError` from `@shipstatic/types`. It provides factory methods (`ShipError.authentication()`, `ShipError.validation()`, etc.) and type guards (`isShipError()`, `error.isAuthError()`, etc.).

CLI error formatting (`src/node/cli/error-handling.ts`) — pure functions, fully unit-testable:
- `toShipError(err)` — normalizes any thrown value to `ShipError`
- `getUserMessage(err, context, options)` — maps error type to actionable user message
- `formatErrorJson(message, details)` — serializes to `{ "error": "...", "details": ... }`

## TODO

- Consider adding `ship domains records <name>` CLI command — returns required DNS records for a domain. Currently only used programmatically (SDK, MCP) and baked into `domains set` output via DNS enrichment.

## Known Gotchas

**Tests must run sequentially** — mock server is shared. Never add `fileParallelism: true`.

**Deploy token vs API key** — API key is persistent; deploy token is single-use (consumed on successful deploy) and overrides the API key for that request.

**Browser file handling** — SDK extracts path from `webkitRelativePath` or falls back to `name`.

**Config file loading order** — constructor options → env vars (`SHIP_API_KEY`, `SHIP_API_URL`) → `.shiprc` → `package.json` `"ship"` key.

**`getConfig()` is cached** — reuses the `ConfigResponse` fetched during initialization; no extra API call.

## Backend Integration

| SDK Method | API Endpoint | Notes |
|------------|--------------|-------|
| `deployments.upload()` | `POST /deployments` | Multipart upload |
| `deployments.list()` | `GET /deployments` | Paginated |
| `deployments.get()` | `GET /deployments/:id` | |
| `deployments.set()` | `PATCH /deployments/:id` | Labels only |
| `deployments.remove()` | `DELETE /deployments/:id` | Returns 202 (async) |
| `domains.set()` | `PUT /domains/:name` | Upsert — create, repoint, or label |
| `domains.list()` | `GET /domains` | |
| `domains.get()` | `GET /domains/:name` | |
| `domains.validate()` | `POST /domains/:name/validate` | Pre-flight check |
| `domains.verify()` | `POST /domains/:name/verify` | Triggers async DNS check |
| `domains.dns()` | `GET /domains/:name/dns` | DNS provider information |
| `domains.records()` | `GET /domains/:name/records` | Required DNS records |
| `domains.share()` | `GET /domains/:name/share` | Shareable setup hash |
| `domains.remove()` | `DELETE /domains/:name` | |
| `tokens.create()` | `POST /tokens` | Returns 201 |
| `tokens.list()` | `GET /tokens` | |
| `tokens.remove()` | `DELETE /tokens/:token` | Returns 202 (async) |
| `account.get()` | `GET /account` | |
| `ping()` | `GET /ping` | Returns boolean |
| `getConfig()` | `GET /config` | Cached after init |
| (internal) | `POST /spa-check` | SPA detection during upload |

### Domain Write Semantics

`PUT /domains/:name` is a merge-upsert: omitted fields are preserved on update, defaulted on create. Supports: reserve (omit deployment), link, atomic deployment switch, label update.

**No unlinking (by design).** `{ deployment: null }` returns 400. Reservation (forward-looking: "claiming domain, will link soon") is valid; unlinking (backward-looking: "what does this serve now?") is not. To take a site offline, deploy a maintenance page. To clean up, delete the domain.

**Why PUT not PATCH?** Domains are mutable routing records identified by natural key — PUT upsert is one endpoint for create, repoint, and label. Deployments use PATCH because they're immutable artifacts with labels as the only mutable annotation.

### Domain Normalization

The SDK is a transparent pipe — zero domain validation or normalization. It URL-encodes names in API paths (`encodeURIComponent`) and passes everything else as-is. The API owns all domain semantics: it accepts liberal input (any case, Unicode), normalizes to canonical form, validates, and returns the normalized name.

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
