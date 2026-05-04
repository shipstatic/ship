# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

**@shipstatic/ship** — universal SDK and CLI for ShipStatic. Clean `resource.action()` API, identical in Node.js and Browser. **Maturity:** Release candidate; interfaces stabilizing.

## Architecture

```
src/
├── shared/              # Cross-platform code (70% of codebase)
│   ├── api/http.ts      # HTTP client with events, timeout, auth
│   ├── base-ship.ts     # Base Ship class (auth state, lazy /limits fetch, resources)
│   ├── resources.ts     # Resource factories (deployments, domains, etc.)
│   ├── types.ts         # Internal SDK types
│   ├── core/config.ts   # resolveConfig + mergeDeployOptions (cross-platform)
│   └── lib/             # Utilities (validation, junk filtering, MD5, SPA detection)
├── browser/             # Browser Ship class + file handling
└── node/
    ├── core/config.ts       # readEnvConfig — SHIP_* env-var resolution (no filesystem)
    ├── core/...             # node-files, deploy-body
    └── cli/
        ├── index.ts         # Commander.js command tree + withErrorHandling + performDeploy
        ├── create-client.ts # Credential precedence (flag → env → file) → Ship instance
        ├── shiprc.ts        # cosmiconfig loader for .shiprc / package.json — CLI ONLY
        ├── config.ts        # Interactive `ship config` wizard
        ├── error-handling.ts # toShipError + getUserMessage + formatErrorJson
        ├── formatters.ts    # Resource-specific output (formatOutput router)
        ├── utils.ts         # Output primitives (success/error/info, table, details)
        ├── types.ts         # CLI option + result types
        └── completion.ts    # Shell completion install/uninstall
```

The SDK proper has no filesystem dependency — the only ambient credential source is `SHIP_*` env vars. File-based config (`.shiprc`, `package.json` `"ship"` key) lives entirely in `cli/shiprc.ts`. This is what makes `new Ship({})` safe to use in embedded contexts (MCP, n8n, GitHub Action) without leaking the host's `~/.shiprc` credentials.

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
| `src/node/core/config.ts` | `readEnvConfig` — SHIP_* env-var resolution (the SDK's only ambient source) |
| `src/node/cli/index.ts` | CLI command tree, `withErrorHandling`, `performDeploy` |
| `src/node/cli/create-client.ts` | `createClient` + `mergeCliConfig` — credential precedence (flag > env > file) |
| `src/node/cli/shiprc.ts` | `loadShipFile` — cosmiconfig-based loader for `.shiprc` / `package.json` (CLI only) |
| `src/node/cli/utils.ts` | Output primitives (`success`, `error`, `warn`, `info`, `formatTable`, `formatDetails`) |
| `src/node/cli/formatters.ts` | Resource-specific output formatters, `formatOutput` router |
| `src/node/cli/types.ts` | CLI option and result types (`GlobalOptions`, `CLIResult`, `EnrichedDomain`) |
| `src/node/cli/error-handling.ts` | CLI error UX — `toShipError` (normalize), `getUserMessage` (translate), `formatErrorJson` (--json output) |
| `src/node/cli/config.ts` | Interactive `ship config` wizard (writes `~/.shiprc`) |
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
ship.getLimits()               // returns PlatformLimits (cached after init)
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

The constructor is fully synchronous: auth state and the HTTP client are formed at construction time from constructor args, with `SHIP_*` env vars filling any gaps in Node. The only deferred work is the one-shot `GET /limits` fetch that hydrates platform limits — that runs lazily on the first API call via `ensureInitialized()`.

**Credential resolution (Node, in priority order):**

1. Constructor arguments (`new Ship({ apiKey })`)
2. Environment variables: `SHIP_API_KEY`, `SHIP_DEPLOY_TOKEN`, `SHIP_API_URL`

That's the entire SDK contract. `~/.shiprc` and `package.json` `"ship"` keys are **CLI-only** — see `src/node/cli/shiprc.ts`. This separation is what makes `new Ship({})` safe in embedded contexts: the SDK can't reach into the host developer's personal dotfile and silently leak credentials into anonymous public deployments. The convention follows the OpenAI / Anthropic / Stripe pattern.

Browser `Ship` has no ambient source at all — credentials must come from constructor options (or, for first-party browser apps, an HTTP-only cookie via `useCredentials: true`).

#### Strict-isolation contract for embedded hosts

The env-var fallback is **the** SDK contract. There is no programmatic opt-out — no `envFallback: false` flag, no `apiKey: null` sentinel. Embedded SDK consumers (MCP, n8n, GitHub Action, library wrappers, multi-tenant integrations) are expected to manage `SHIP_*` env vars at the process boundary:

- **Hosts that pass credentials explicitly** (e.g. MCP receives `SHIP_API_KEY` via its server config and forwards it to `new Ship({ apiKey })`) get exactly what they expect — explicit args win, no surprises.
- **Hosts that need strict isolation** (e.g. a multi-tenant runner where the deployer's identity must never leak into a customer's deployment) must scrub `SHIP_*` from the worker process or run the SDK in a sub-process with a clean env. The SDK trusts whatever env it sees.

Why no opt-out option? Because every flag we add to disable env reading would itself become a footgun in the same way `configFile` resolution did — embedded consumers would forget to set it and silently leak. Making env reading non-overrideable forces the host to think about credential isolation as a process-level concern, where it actually belongs.

**Token precedence (per request):** Deploy token (per-call option) > API key (instance) > Cookie (browser, `useCredentials: true`)

#### Future credential providers

The current design forecloses async credential resolution (OAuth refresh, OIDC token exchange, AWS-style provider chains) because the constructor is fully synchronous. If we ever ship short-lived credentials with refresh, the additive path is a credential-provider option:

```typescript
new Ship({ apiKey: () => Promise<string> })  // hypothetical future shape
```

This doesn't break the current static-credential design — it would be opt-in for callers that need it. Static API keys remain the primary contract because that's how the product is used today.

### Cross-Platform File Input

The shared `DeployInput` type is `File[] | string | string[]`. Each platform's `deploy()` shortcut narrows to its accepted shape; non-matching inputs throw at runtime.

```typescript
// Node — string or string[] (file/directory paths; directories walked recursively)
ship.deploy('./dist');
ship.deploy(['./dist/index.html', './dist/app']);

// Browser — File[] (typically from <input type="file"> or drag-and-drop)
ship.deploy(Array.from(fileInput.files));
ship.deploy([fileFromDragDrop]);
```

`FileList` is not accepted directly — the runtime check is `Array.isArray(input) && input.every(item => item instanceof File)`. Convert with `Array.from(fileInput.files)`. Synthetic `StaticFile` objects (`{path, content, md5, size}`) are an internal pipeline shape produced by `processFilesForNode` / `processFilesForBrowser`; they are not a public input format for `deploy()`.

### Server-Processed Uploads (Build/Prerender/SPA)

When `build`, `prerender`, or `spa` options are set on `DeploymentUploadOptions`, the SDK delegates processing to the server:

- **`filterJunk`** accepts `{ allowUnbuilt: true }` — skips the unbuilt project marker check (source files have `package.json`, `node_modules`)
- **`processFilesForBrowser`** has two modes (early return pattern in `browser-files.ts`):
  - **Deploy** (default): full validation pipeline (security, extensions, sizes, counts)
  - **Server-processed** (`build`/`prerender`): junk filtering + MD5 checksums only
- **`detectAndConfigureSPA`** skips when `spa`, `build`, or `prerender` is set — the server handles SPA detection via the `/upload` endpoint
- **`createDeployBody`** appends `build=true` / `prerender=true` / `spa=true` to the FormData

These are `@internal` flags — only used by `web/my` and `web/www` via the `/upload` endpoint. External clients (SDK, CLI, integrations) never set them. They use the `/deployments` pure pipe, where clients prepare files themselves — SPA detection runs client-side via `/spa-check`, builds happen locally before upload.

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
'records' in result      → formatDomainRecords   // must precede 'domain' check
'hash' in result         → formatDomainShare     // must precede 'domain' check
'dns' in result          → formatDomainDns       // must precede 'domain' check
'domain' in result       → formatDomain          // plain Domain or EnrichedDomain
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

`DomainSetResult` is the published return shape of `domains.set()` — `Domain` plus an `isCreate` flag derived from HTTP 201 vs 200. It lives in `@shipstatic/types` (alongside `Domain`) so the resource interface return type matches the SDK's actual return value.

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

All errors use `ShipError` from `@shipstatic/types`. The class provides the full factory + type-guard API and the two HTTP-context constructors (`fromHttpResponse`, `fromFetchError`). See `@shipstatic/types/CLAUDE.md` "Error Flow" for the end-to-end lifecycle.

**`ApiHttp` is pure transport.** `src/shared/api/http.ts` owns no error-mapping logic. `executeRequest` calls the two helpers directly — `ShipError.fromHttpResponse(response, operationName)` for non-OK responses and `ShipError.fromFetchError(error, operationName)` for thrown causes (which passes existing `ShipError`s through unchanged).

**CLI error UX** (`src/node/cli/error-handling.ts`) — pure functions, fully unit-testable:
- `toShipError(err)` — normalizes any thrown value to a `ShipError` (used by the CLI's global error handler for non-fetch errors like Commander parse failures).
- `getUserMessage(err, context, options)` — maps a `ShipError` to an actionable user-facing CLI string (auth → credential hints, network → connectivity, client/4xx → trust the API message, 5xx → generic "try again").
- `formatErrorJson(message, details)` — serializes `{ "error": "...", "details": ... }` for `--json` output.

## Known Gotchas

**Tests must run sequentially** — mock server is shared. Never add `fileParallelism: true`.

**Deploy token vs API key** — API key is persistent; deploy token is single-use (consumed on successful deploy) and overrides the API key for that request.

**Browser file handling** — SDK extracts path from `webkitRelativePath` or falls back to `name`.

**Credential resolution (effective end-to-end):**

| Layer | Where | Reads |
|---|---|---|
| **CLI** | `src/node/cli/shiprc.ts` | `.shiprc`, `package.json` `"ship"` (cosmiconfig) |
| **CLI** | `src/node/cli/create-client.ts` `createClient()` | merges flag → env → file via `mergeCliConfig`, hands result to `new Ship({...})` |
| **SDK (Node)** | `src/node/index.ts` constructor | `SHIP_API_KEY`, `SHIP_DEPLOY_TOKEN`, `SHIP_API_URL` (under any constructor arg) |
| **SDK (Browser)** | `src/browser/index.ts` constructor | nothing — fully explicit |

For a CLI user who has all three: `--api-key` flag → env → file. For an embedded SDK consumer: constructor arg → env. There's no path from the SDK to the filesystem.

**CLI-only env vars** (read by the CLI but *not* by the SDK constructor):

| Var | Purpose |
|---|---|
| `SHIP_PASSWORD` | Default for `--password <password>` on `ship deploy` / `ship deployments upload`. Empty string is normalized to absence (so unset CI variables don't accidentally protect a deploy). |
| `SHIP_VIA` | Overrides the deploy `via` field (default `'cli'`). Used by integrations that wrap the CLI for origin tracking — the GitHub Action sets `SHIP_VIA=git`, the MCP server sets `SHIP_VIA=mcp`. Distinct from the programmatic `caller` option, which is for rate-limit bucketing in multi-tenant orchestrators (see `ShipClientOptions.caller` JSDoc). |

**`getLimits()` is cached** — reuses the `PlatformLimits` fetched during initialization; no extra API call.

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
| `getLimits()` | `GET /limits` | Cached after init (`/config` is a 301 alias for older CLIs) |
| (internal) | `POST /spa-check` | SPA detection during upload |

### Domain Write Semantics

`PUT /domains/:name` is a merge-upsert: omitted fields are preserved on update, defaulted on create. Supports: reserve (omit deployment), link, atomic deployment switch, label update.

**No unlinking (by design).** `{ deployment: null }` returns 400. Reservation (forward-looking: "claiming domain, will link soon") is valid; unlinking (backward-looking: "what does this serve now?") is not. To take a site offline, deploy a maintenance page. To clean up, delete the domain.

**Why PUT not PATCH?** Domains are mutable routing records identified by natural key — PUT upsert is one endpoint for create, repoint, and label. Deployments use PATCH because they're immutable artifacts with labels as the only mutable annotation.

### Domain Normalization

The SDK is a transparent pipe — zero domain validation or normalization. It URL-encodes names in API paths (`encodeURIComponent`) and passes everything else as-is. The API owns all domain semantics: it accepts liberal input (any case, Unicode), normalizes to canonical form, validates, and returns the normalized name.

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
