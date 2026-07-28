# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

**@shipstatic/ship** — universal SDK and CLI for ShipStatic. Clean `resource.action()` API, identical in Node.js and Browser. **Maturity:** Stable; semver applies — breaking changes require a major version bump.

**Branches:** `main` (production) + `development` (integration). The publish workflow runs on both — the guarded publish step publishes only when `package.json` holds a version not yet on the registry, with the dist-tag derived from the version (`-` suffix → `beta`, else `latest`). See root `CLAUDE.md` "Branch & CI Model".

## Architecture

```
src/
├── shared/              # Cross-platform code (70% of codebase)
│   ├── api/http.ts      # HTTP client with events, timeout, auth
│   ├── base-ship.ts     # Base Ship class (auth state, lazy /limits fetch, resources)
│   ├── resources.ts     # Resource factories (deployments, domains, etc.)
│   ├── types.ts         # Internal SDK types
│   ├── core/            # constants + the shared credential zod schema
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
pnpm test --run              # unit + integration (e2e is NOT in the default run)
pnpm test:unit --run         # Pure functions only
pnpm test:integration --run  # SDK/CLI against the mock server
pnpm test:e2e --run          # REAL API — refuses to load without SHIP_E2E_API_KEY
pnpm coverage                # the suite + the ratchet — what CI runs
pnpm typecheck               # tsc over src AND tests (tsconfig.check.json)
pnpm check:package           # publint + attw over the built artifact
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
| `tests/fixtures/builders.ts` | Typed fixture builders — the only fixture source |
| `tests/mocks/handler.ts` | The mock API: one Web-standard handler, wire-cited per route |
| `tests/architecture/` | Suite-time fences (integrity, naming) |

## Core Patterns

### Ship Class Public Surface (base-ship.ts)

```typescript
// Resources — every collection the SDK reaches. `/activities` is
// deliberately not among them (see "Routes the API exposes that the SDK
// does not reach").
ship.deployments / ship.domains / ship.account / ship.tokens

// Convenience shortcuts
ship.deploy(input, options?)   // → deployments.upload()
ship.whoami()                  // → account.get()

// Top-level
ship.ping()                    // returns boolean
ship.getLimits()               // returns PlatformLimits (cached after init)
ship.setToken(token)           // any platform token, or a TokenProvider
ship.setHeaders(headers)       // global headers on every request (lowest priority)
ship.clearHeaders()
ship.on(event, handler)
ship.off(event, handler)
```

Deploy options are `signal` (the one cancellation mechanism), `pathDetect`,
`spaDetect`, plus the wire options from `DeploymentUploadOptions` (`labels`,
`via`, `password`, and the `@internal` flags). There are deliberately no
per-deploy `timeout`/`onProgress`/`onCancel`/`maxConcurrency` options —
request timeout is a client concern (`ShipClientOptions.timeout`), fetch has
no upload-progress events to honestly report, `signal` already covers
cancellation, and a deploy is one multipart POST with nothing to parallelize.
The vestigial four were removed for 2.0 (2026-07-27) after an audit found
them declared but never consumed.

### Resource Factory Pattern

Resources are factory functions that receive a `ResourceContext` (`getApi`, `ensureInit`) instead of the full Ship instance. This enables functional composition: factories only depend on the callbacks they actually need. Deployment resource additionally receives `processInput`.

### HTTP Client Architecture

`ApiHttp` in `src/shared/api/http.ts` — all API calls flow through `executeRequest`, which handles header merging, timeout, event emission, and error mapping. Two public variants: `request<T>()` returns data directly; `requestWithStatus<T>()` returns `{ data, status }` for operations where HTTP status matters (e.g. 201 vs 200 on domain upsert).

**Key patterns:**
- All path parameters use `encodeURIComponent()`
- Optional arrays: use `labels !== undefined` (not `labels?.length`) — distinguishes "not provided" from "empty array"
- `requestWithStatus()` used when HTTP status drives behavior (domain creation: 201 = `isCreate: true`)

**Transport injection (`fetch`):** `ShipClientOptions.fetch` overrides the function used for every outbound API call. Defaults to `globalThis.fetch` (captured at construction). Any `fetch`-compatible function works — typical uses include a Cloudflare service-binding `Fetcher` for Worker-to-Worker calls, tracing/retry wrappers, and test mocks. All downstream machinery (events, timeouts, `AbortSignal`, multipart bodies, `ShipError` normalisation) operates on standard `Request`/`Response`, so the injected fetcher inherits everything for free.

**Events:**
```typescript
ship.on('request', (url, init) => ...);
ship.on('response', (response, url) => ...);
ship.on('error', (error, url) => ...);
```

### Authentication Flow

The constructor is fully synchronous: the credential and the HTTP client are formed at construction time from constructor args, with `SHIP_TOKEN` / `SHIP_API_URL` filling any gaps in Node. The only deferred work is the one-shot `GET /limits` fetch that hydrates platform limits — that runs lazily on the first API call via `ensureInitialized()`.

**One credential slot.** `token` carries any platform token — `ship-` API key, `deploy-` deploy token, or an opaque pre-issued bearer such as an OAuth access token — sent verbatim as `Authorization: Bearer <value>`. The value's shape says what it is: the server classifies with the same `classifyToken` (`@shipstatic/types`) the SDK uses for boundary validation, so client and server can never disagree on dispatch. A `TokenProvider` function in the same slot supplies the token per request — minting and refresh live with the caller, the SDK just asks. `session: true` is the cookie-session identity for first-party browser apps. `token` + `session` together is a config error. **There is no credential precedence anywhere in the SDK** — one slot means multiplicity is inexpressible.

**Token resolution (Node, in priority order):**

1. Constructor argument (`new Ship({ token })`)
2. Environment variable: `SHIP_TOKEN` (plus `SHIP_API_URL` for the endpoint)

That's the entire SDK contract. `~/.shiprc` and `package.json` `"ship"` keys are **CLI-only** — see `src/node/cli/shiprc.ts`. This separation is what makes `new Ship({})` safe in embedded contexts: the SDK can't reach into the host developer's personal dotfile and silently leak credentials into anonymous public deployments. The single env var follows the industry's one-token idiom (`GITHUB_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`).

**The lifetime-dominance doctrine:** storage must not outlive the credential. A dotfile is indefinite — `.shiprc` holds durable tokens. A process environment lives as long as the process — `SHIP_TOKEN` holds whatever its provisioner keeps fresh (a CI job injecting a short-lived token per run is correct). A constructor argument or provider lives per request — it holds anything, which is where hourly OAuth bearers belong.

**The fail-closed anonymity invariant:** anonymity requires proven absence of credentials. An anonymous deploy simply carries no `Authorization` header — the API grants the public-account agent identity per request (`AuthMethod.AGENT`; claim URL + expiry on the response), and the SDK has no agent-token machinery at all. A credential that is present but expired, malformed, or rejected fails the request with a typed error — it never demotes a deploy to an anonymous PUBLIC_ACCOUNT deploy. Empty-string normalization is the invariant's boundary condition: `''` (shell expansion of an unset CI variable) is absence of intent and falls through to the next source; a configured provider yielding nothing is broken intent and throws.

Browser `Ship` has no ambient source at all — the token comes from constructor options (or, for first-party browser apps, the cookie session via `session: true`).

#### Strict-isolation contract for embedded hosts

The env-var fallback is **the** SDK contract. There is no programmatic opt-out — no `envFallback: false` flag, no `token: null` sentinel. Embedded SDK consumers (MCP, n8n, GitHub Action, library wrappers, multi-tenant integrations) are expected to manage `SHIP_TOKEN` at the process boundary:

- **Hosts that pass credentials explicitly** (e.g. MCP receives a token via its server config and forwards it to `new Ship({ token })`) get exactly what they expect — explicit args win, no surprises.
- **Hosts that need strict isolation** (e.g. a multi-tenant runner where the deployer's identity must never leak into a customer's deployment) must scrub `SHIP_TOKEN` from the worker process or run the SDK in a sub-process with a clean env. The SDK trusts whatever env it sees.

Why no opt-out option? Because every flag we add to disable env reading would itself become a footgun in the same way `configFile` resolution did — embedded consumers would forget to set it and silently leak. Making env reading non-overrideable forces the host to think about credential isolation as a process-level concern, where it actually belongs.

#### The device-flow future

The CLI's recorded future for delegated auth is the OAuth device flow. Its doctrine reading: the *refresh token* is the durable credential — ambient storage (OS keychain, `.shiprc`) is permitted; the access tokens it mints are short-lived and ride a `TokenProvider`, never a dotfile or an env var. The provider is already the public contract, so the device flow adds no SDK surface.

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

`captcha` rides the same internal tier: `web/www`'s public uploader passes the reCAPTCHA proof as a deploy option, the body creators append it as a form field, and the API grants the public-account agent identity per request. First-party only — every other anonymous deploy is the credential-less `/deployments` path, which needs no proof.

## CLI Patterns

### Output Conventions

| Type | Text format | JSON format | Quiet (`-q`) format |
|------|------------|-------------|---------------------|
| Success message | green text | `{ "success": "..." }` | — |
| Data (single) | key-value pairs | raw JSON object | key identifier only |
| Data (list) | table | raw JSON object | one identifier per line |
| Void/ping | success/error text | `{ "success": "..." }` | no output (exit code) |
| Error | `[error]` prefix, red | `{ "error": "..." }` | stderr (unchanged) |

- Text messages open lowercase (leading sentence word decapitalized; identifiers, paths, and acronyms survive verbatim); trailing periods stripped
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
- `INTERNAL_FIELDS` list (`['isCreate', 'claim']`) is filtered from table/details output — `claim` renders through the claim CTA instead, and deliberately stays in `--json` output so scripts can read it

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
'domain' without 'url'   → formatDomainVerify     // the acknowledgement, not the entity
'domain' in result       → formatDomain          // plain Domain or EnrichedDomain
'deployment' in result   → formatDeployment
'token' in result        → formatToken
'email' in result        → formatAccount
'valid' in result        → formatDomainValidate
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

```bash
pnpm test --run          # unit + integration (e2e and browser are NOT in the default run)
pnpm coverage            # the same suite, plus the ratchet — what CI runs
pnpm typecheck           # tsc over src AND tests, 0 errors
pnpm check:package       # publint + attw over the built artifact
pnpm test:browser        # capability tier — real Chromium via playwright (CI runs it)
pnpm test:e2e --run      # REAL API; refuses to load without SHIP_E2E_API_KEY
```

| Pattern | Project | Mock server |
|---------|---------|-------------|
| `*.unit.test.ts` | `unit` | No |
| `*.test.ts` | `integration` | Yes — per file, ephemeral port |
| `tests-browser/*.test.ts` | `browser` | No — real Chromium, pure browser primitives |
| `*.e2e.test.ts` | `e2e` | No (a real API) |

**`tests/**` is typechecked.** `pnpm typecheck` runs `tsconfig.check.json`
over `src` and `tests` together. This is the load-bearing one: vitest
transpiles through esbuild WITHOUT checking types, so until 2026-07-27 nothing
checked the test tree — which is what let an `apiKey` constructor option, a
`flattenDirs` deploy option, a `basePath` that never existed, a
`findCommonParent(paths, separator)` overload that never existed, and
`processFilesForNode` called with four arguments all sit there passing. The
fixtures' `satisfies` clauses were decorative until this gate existed.

### Hermeticity

`tests/setup.ts` loads for BOTH in-process projects and enforces two
invariants that used to be convention:

- **No ambient credentials** — every `SHIP_*` var is scrubbed at load, so a
  developer's exported `SHIP_TOKEN` cannot authenticate the suite's
  "anonymous" paths.
- **No outbound network** — `fetch` is wrapped and THROWS, naming the URL, for
  any host that is not loopback. `DEFAULT_API` is production, so a missing
  mock route or a forgotten `apiUrl` would otherwise reach it.

The child-process CLI tier builds its environment from an **allowlist**
(`tests/node/cli/helpers.ts`) — `PATH`, `TMPDIR`, a throwaway `HOME`,
`NO_COLOR`, `CI`, and nothing else. A blocklist only removes what someone
thought of: `FORCE_COLOR=3` (iTerm's default) used to reach the child and turn
sixteen exact-output tests red on a developer's machine while CI stayed green.
Notably `SHELL` is absent too, so shell detection is a test input rather than a
property of the machine. The same file refuses to run against a **stale
`dist/`** — those tests execute `dist/cli.cjs`, which `pnpm test` does not
build.

### The three fences

`tests/architecture/` holds suite-time invariants. Each catches a class the
others cannot:

| Fence | Catches |
|---|---|
| `test-integrity.test.ts` | A test file that reaches NO production code — the tautology class. A tautology neither raises nor lowers coverage, so no ratchet can see it. Reach is resolved TRANSITIVELY through local test-support modules (`./harness`, `../mocks/…`) but importing only fixture builders does not count — builders pull in `@shipstatic/types`, never `src/`. Its only exceptions are the two artifact tiers (`smoke.test.ts`, `package/dist-entries.test.ts`), each recorded with a reason. |
| `test-naming.test.ts` | Layout drift: a filename that describes the test instead of its subject, a mirror file with no `src/` counterpart, an aspect split not recorded in this file. |
| `coverage.thresholds` | Coverage decay. A ratchet — it only goes up. Global bar plus per-glob floors for the three files whose residual gaps are named in `vitest.config.ts` (bin block/spinner/SIGINT are smoke-proven; browser env arms are browser-tier-proven). |

### The mock server

`tests/mocks/` is a hand-maintained twin of `cloudflare/api`, in three parts:
`handler.ts` (one Web-standard `handleApiRequest(request, state)`),
`state.ts` (per-instance state from a factory), and `server.ts` (a thin
`node:http` adapter plus lifecycle). **Every route cites its wire truth** —
`// wire: routes/domains.ts:103` — so an API change is a mechanical checklist
rather than a memory exercise. `tests/e2e/smoke.e2e.test.ts` pins the same
contract points against the real API, which is what catches drift between
manual alignments.

### Testing canon

The cohesion contract. A change that breaks one of these needs a recorded
exception, not a workaround:

1. **Pure lib tests mock nothing.** `md5`, `path`, `deploy-paths`,
   `validation`, `junk` run the real thing against real inputs.
2. **SDK-level tests run a real `Ship` against the wire-truth handler.**
   Internal module mocks only with a recorded reason — today exactly one:
   `node:readline/promises` in `config.test.ts`, because stdin is the one
   collaborator a test cannot supply for real.
3. **A mock may only mock exports that exist** — the typecheck enforces it.
4. **Raw `fetch` stubbing only where transport IS the subject** — the
   `http*.test.ts` family. Everywhere else, inject the `fetch` option (a
   published contract) or talk to the mock server.
5. **Builders are the only fixture source** (`tests/fixtures/builders.ts`),
   and they take explicit timestamps — no `Date.now()` in an asserted value.
6. **Every mock route cites its `cloudflare/api` wire truth.**

The e2e harness var is deliberately named `SHIP_E2E_API_KEY` — it names a
literal API key, the CI secret name is unchanged, and it is not part of the
SDK's env contract (`SHIP_TOKEN`). Don't rename it during credential sweeps.

**Tests run in parallel.** Each file gets its OWN mock server on an ephemeral
port and its OWN state (`tests/mocks/server.ts`), so no file can observe
another's writes and no two can contend for a port. This replaced a
"never parallelize" rule whose reason — one shared server on a fixed 13579 —
no longer exists; the law changed with its reason, not despite it.

**Recorded aspect splits** — one subject, more than one mirror file. Legal
under the layout law (`<module>-<aspect>.test.ts`), listed here because the law
requires the aspect to be recorded — and since 2026-07-27 that recording is
mechanical: `tests/architecture/test-naming.test.ts` fails the suite if a split
is not named here by full basename.

| Module | Files | Why |
|---|---|---|
| `src/shared/api/http.ts` | `http`, `http-anonymous`, `http-browser`, `http-domains`, `http-events`, `http-rate-limit`, `http-timeout`, `http-tokens` | The HTTP client is the SDK's widest surface. `http.test.ts` is the transport anchor (stubbed `fetch`); the rest drive a real `Ship` against the wire-truth handler, one resource family or one cross-cutting concern each. |
| `src/shared/base-ship.ts` | `base-ship`, `base-ship-credentials`, `base-ship-lifecycle`, `base-ship-limits` | Three separable doctrines on one class: the credential slot, the init/auth lifecycle, and the one-shot `/limits` cache. |
| `src/shared/resources.ts` | `resources-account`, `resources-deployments`, `resources-domains` | One file per resource factory; a single file would be a grab bag with no reason to read any part of it. |
| `src/shared/types.ts` | `types-reexport` | Not a test of the module's own types but of the **freshness** of what it re-exports — a bundled-dependency fence. |

**Recorded feature-axis files** — no single subject module, so the mirror rule
cannot apply. The list lives in the naming fence; adding to it is a decision.
Today: `unknown-commands` (the CLI's error surface), `validation` (parse-time
credential/URL checks), `smoke` (the true-binary tier), and `e2e/smoke.e2e`.

### Commander

`commander@^14` — deliberately NOT 15: Commander 15 (2026-05) is ESM-only
and requires Node ≥22.12, incompatible with the CJS `dist/cli.cjs` bin and
the `engines >=20` consumer contract. Revisit when dropping Node 20 / going
ESM-only is decided (a consumer-contract call, like the engines pin itself).

**Two help scopes, one machinery.** The ROOT renders the hand-written front
page (`helpText()` — the kept design, byte-pinned in the smoke tier): that is
what `ship`, `ship --help`/`-h`, and `ship help` show. Subcommands render
Commander's NATIVE scoped help (`ship domains --help`,
`ship help deployments`, and `--help` beside a missing argument), which knows
each command's exact usage and options. The split is one conditional in
`configureHelp.formatHelp` — root → `helpText()`, else →
`Help.prototype.formatHelp` (the escape past our own override). Riding the
built-in `-h, --help` option and explicit `help [command]` command means no
help route ever resolves credentials or reads a config file. Short forms
`-h`/`-V` are supported (user decision 2026-07-27).
`allowExcessArguments()` is a recorded opt-out of v13+'s excess-arguments
error: unknown subcommands must reach `handleUnknownSubcommand` as excess
args to get scoped usage. Option arguments that parse (`--ttl`) throw
`InvalidArgumentError` — the docs' canonical pattern; a bare `parseInt` once
turned `--ttl abc` into `NaN` on the wire.

### The CLI's two tiers

`src/node/cli/index.ts` exports `buildProgram()` — a factory returning a
fresh Commander tree (instances are not reusable across parses). The tree
**never calls `process.exit` on the command path**: outcomes land in
`process.exitCode` or ride a thrown `CommanderError`, and the bin path ends
naturally when the event loop drains, so buffered stdout can never be
truncated on a pipe. The one recorded exception is `performDeploy`'s SIGINT
handler (`process.exit(130)`) — Ctrl+C must terminate *now* with the shell's
128+SIGINT convention, and an interrupt is precisely the case where waiting
for the loop to drain is wrong. That design is what makes the tree drivable
in-process:

- **In-process tier** (`index.test.ts`, `unknown-commands`, `validation` via
  `tests/node/cli/harness.ts`): drives `buildProgram()` directly, so V8
  coverage sees the command tree — a subprocess is invisible to it, which is
  how 917 lines once read 0% while being "tested". The harness pins a
  deterministic colour environment (`NO_COLOR` on, `FORCE_COLOR` cleared) —
  the in-process tier reads the same `process.env` the child tier once leaked.
- **Child-process smoke tier** (`smoke.test.ts`, the ONE file that spawns
  `dist/cli.cjs`): proves what only a real binary can — byte-exact help, exit
  codes, stdin piping, colour responding to the launch environment, the
  `--comp*` completion fast-path, and stdout surviving a pipe intact.

### The browser capability tier

`tests-browser/` (the analog of the backend's `tests-workerd`): a small suite
run on **real Chromium** via `pnpm test:browser` (vitest browser mode,
playwright provider). It certifies what jsdom can only approximate — native
`getENV()` detection with no test override, `webkitRelativePath` as Chromium
defines it, real `File`/`FormData` bytes through `createDeployBody`, and
spark-md5 digests (same published vectors as the Node tier, deliberately: the
API verifies checksums on R2 put, so both runtimes must agree). No coverage
coupling; separate CI step with `playwright install chromium`.

```
tests/
├── architecture/     # Fences: integrity, naming
├── browser/ node/ shared/   # Mirror axis — tests/<path>/<module>.test.ts
├── node/cli/harness.ts      # In-process CLI runner (buildProgram + capture)
├── node/cli/smoke.test.ts   # The ONE child-process file (dist/cli.cjs)
├── package/          # The BUILT artifact (dist entries)
├── e2e/              # Real API, opt-in — and the contract-drift detector
├── fixtures/builders.ts     # Typed builders — the only fixture source
├── mocks/            # handler.ts + state.ts + server.ts
├── setup.ts          # Hermeticity (both in-process projects)
└── setup-server.ts   # Mock-server lifecycle (integration only)
tests-browser/        # Capability tier — real Chromium (pnpm test:browser)
```

**When the API changes:** update `@shipstatic/types` → follow the `// wire:`
citations in `tests/mocks/handler.ts` → `pnpm typecheck` guides the rest.

## Adding New Features

**New SDK method:** `@shipstatic/types` (interface) → `api/http.ts` (HTTP call) → `resources.ts` (factory wrapper) → fixture → tests.

**New CLI command:** `cli/index.ts` (command + `withErrorHandling`) → `cli/formatters.ts` (formatter if needed) → `cli/types.ts` (`CLIResult` union if needed) → tests.

**New shared utility:** `src/shared/lib/` → export from `lib/index.ts` if public → unit tests.

## SPA Auto-Detection

On upload, the SDK POSTs `index.html` content (must be < 100KB) to `/spa-check` along with the file list. If the API detects SPA patterns (React router, Vue, etc.), the deployment gets rewrite rules for client-side routing. Disable with `spaDetect: false` (SDK) or `--no-spa-detect` (CLI).

## ship.json: the client checks syntax, the server owns the schema

`deploy()` calls `validateDeployConfig` (`shared/lib/validation.ts`) before it
builds the multipart body — the third of three request-boundary validators in
the same fast-fail block, beside `validatePassword` and `validateLabels`, all
imported from that one module. It finds the root `ship.json`, reads it on
either platform (`Buffer` in Node, `Blob` in the browser), and applies the
types-tier rule `assertShipJsonSyntax`.

**The split is deliberate and bounded.** ship.json's schema and its compiler
live on the server and evolve there, so a client that judged them would
reject configs a newer platform accepts — which is why validation was
server-only to begin with. The client therefore checks only what is true of
*every* past and future schema: the text parses as JSON (frozen by RFC 8259),
and its top level is an object. Both are monotonic; neither can produce a
false rejection. A UTF-8 BOM is stripped rather than refused, matching the
server.

What it buys is the hand-edit case — a trailing comma, a `//` comment,
single quotes, smart quotes pasted from documentation. Measured: an 11 MB
deploy with a one-character config typo fails in **964 ms having uploaded
nothing**, against 5.5 s for the same deploy's real upload. Failures carry
`ErrorType.Config`, the same type the server's own rejection uses, so the
error contract does not depend on where the mistake was caught.

Scope matches the API's `findDeploymentConfigFile`: the exact name at the
deploy root, optional leading slash. A `config/ship.json` is an ordinary
asset and is left alone.

## Error Handling

All errors use `ShipError` from `@shipstatic/types`. The class provides the full factory + type-guard API and the two HTTP-context constructors (`fromHttpResponse`, `fromFetchError`). See `@shipstatic/types/CLAUDE.md` "Error Flow" for the end-to-end lifecycle.

**`ApiHttp` is pure transport.** `src/shared/api/http.ts` owns no error-mapping logic. `executeRequest` calls the two helpers directly — `ShipError.fromHttpResponse(response, operationName)` for non-OK responses and `ShipError.fromFetchError(error, operationName)` for thrown causes (which passes existing `ShipError`s through unchanged).

**CLI error UX** (`src/node/cli/error-handling.ts`) — pure functions, fully unit-testable:
- `toShipError(err)` — normalizes any thrown value to a `ShipError` (used by the CLI's global error handler for non-fetch errors like Commander parse failures).
- `getUserMessage(err, context, options)` — maps a `ShipError` to an actionable user-facing CLI string (auth → credential hints, network → connectivity, client/4xx → trust the API message, 5xx → generic "try again").
- `formatErrorJson(message, details)` — serializes `{ "error": "...", "details": ... }` for `--json` output.

## Known Gotchas

**Deploy token vs API key** — both ride the one `token` slot; the prefix says which population a value belongs to. An API key (`ship-`) is durable and grants full account access; a deploy token (`deploy-`) is scoped to deploys, supports an optional TTL, and is revocable.

**Browser file handling** — SDK extracts path from `webkitRelativePath` or falls back to `name`.

**Credential resolution (effective end-to-end):**

| Layer | Where | Reads |
|---|---|---|
| **CLI** | `src/node/cli/shiprc.ts` | `.shiprc`, `package.json` `"ship"` (cosmiconfig) |
| **CLI** | `src/node/cli/create-client.ts` `createClient()` | merges flag → env → file via `mergeCliConfig`, hands result to `new Ship({...})` |
| **SDK (Node)** | `src/node/index.ts` constructor | `SHIP_TOKEN`, `SHIP_API_URL` (under any constructor arg) |
| **SDK (Browser)** | `src/browser/index.ts` constructor | nothing — fully explicit |

For a CLI user who has all three: `--token` flag → env → file, per value. For an embedded SDK consumer: constructor arg → env. There's no path from the SDK to the filesystem.

**CLI-only env vars** (read by the CLI but *not* by the SDK constructor):

| Var | Purpose |
|---|---|
| `SHIP_PASSWORD` | Default for `--password <password>` on `ship deploy` / `ship deployments upload`. Empty string is normalized to absence (so unset CI variables don't accidentally protect a deploy). |
| `SHIP_VIA` | Overrides the deploy `via` field (the CLI sends `'cli'` when unset). Used by integrations that **wrap the CLI as a subprocess** — the GitHub Action sets `SHIP_VIA=git`. In-process SDK consumers (e.g. the MCP server) set the same field as a programmatic `via` option on the SDK call (`ship.deployments.upload(..., { via: 'mcp' })`) — same destination, different mechanism. Distinct from the programmatic `caller` option, which is for rate-limit bucketing in multi-tenant orchestrators (see `ShipClientOptions.caller` JSDoc). |

**Every deploy names its surface; `via` is never empty by accident.** Each
client owns its own string — `cli`, `git` (Action), `mcp`, `vsc`, `web` (the
web apps) — and a direct SDK call falls back to `sdk`, applied at the single
wire boundary in `api/http.ts` so it cannot differ per platform. There is
deliberately no central registry of values: integrations outside this repo
mint their own. What the default buys is that an absent `via` on a stored
deployment means an unattributed caller (raw HTTP), never "probably the
SDK" — the reading Vercel's `source` and every self-identifying SDK client
(AWS, Stripe, OpenAI) assume.

> **Doc placement note:** `SHIP_VIA` and `caller` are intentionally *not* in the public README's CLI Reference / SDK Deploy Options. They're ShipStatic-specific operational levers (analytics origin, rate-limit bucketing) that serve first-party integration code paths and stay in internal-tier surfaces (this file + JSDoc + the integrations submodules). Keep mechanisms of the same shape — platform-tier behavior shaping — in the same tier.
>
> The `fetch` option is the exception: it's in the public README ("Custom fetch") because transport injection is a convention every comparable SDK ships (Stripe, OpenAI, Anthropic). Rule of thumb: ShipStatic-specific levers stay internal; industry-standard SDK conventions are public.

**`getLimits()` is cached** — reuses the `PlatformLimits` fetched during initialization; no extra API call.

## Backend Integration

| SDK Method | API Endpoint | Notes |
|------------|--------------|-------|
| `deployments.upload()` | `POST /deployments` | Multipart upload |
| ↳ `idempotencyKey` | header `Idempotency-Key` | Replays the original 201 within 24h instead of deploying twice. Key the ATTEMPT (run id, commit sha), never the try. |

**Deploys get their own timeout ceilings — three budgets, one per kind of work.** 30s is right for a metadata read, where anything slower is a fault rather than a payload. A deploy is bounded by the platform instead: `DEPLOYMENT.MAX_TOTAL_SIZE` is 50MB, and 50MB in 30s needs ~13 Mbit/s of sustained UPLOAD — above most residential links — so a deployment the API permits was being aborted client-side, which is exactly the failure `Idempotency-Key` repairs. `DEFAULT_DEPLOY_TIMEOUT` is 5 minutes (50MB at ~1.4 Mbit/s).

A **build or prerender** deploy is the third: it waits for work the SERVER does after the upload lands, so `DEFAULT_BUILD_DEPLOY_TIMEOUT` is **derived, not chosen** — upload allowance + `PERFORMANCE.BUILD_SERVICE_TIMEOUT` (300s). Raising that server constant must raise this one; they sit in different repos so nothing fences the pair, and the constraint is stated at both ends. `spa` does NOT qualify: it is local detection bounded by the AI tier's own 10s, and only build/prerender reach the build service.

**Only the DEFAULTS split by operation** — an explicit `timeout` option governs every request including deploys, because a caller who names a ceiling asked for a ceiling, not for one with an exception.

The correct instrument is an **idle timeout** — reset on progress, so it measures whether the connection is alive rather than whether the transfer has been long, which is the only formulation independent of payload size. It is blocked on upload-progress observation, which `fetch` cannot provide in the browser. Build it when someone wants a progress bar; the timeout falls out of that work for free.
| `deployments.list()` | `GET /deployments` | Paginated — `{limit, cursor}` options (`--limit`/`--cursor` on the CLI; text mode prints a rerun hint while `--json` carries `cursor`) |
| `deployments.get()` | `GET /deployments/:deployment` | |
| `deployments.set()` | `PATCH /deployments/:deployment` | Labels only |
| `deployments.remove()` | `DELETE /deployments/:deployment` | 202 (async) `{deployment, status:'deleting'}` — resolved, so a caller learns the transitional state without a re-read |
| `domains.set()` | `PUT /domains/:name` | Upsert — create, repoint, or label |
| `domains.list()` | `GET /domains` | Paginated — same `{limit, cursor}` contract |
| `domains.get()` | `GET /domains/:name` | |
| `domains.validate()` | `POST /domains/validate` | Pre-flight check — name rides the JSON body, not the path |
| `domains.verify()` | `POST /domains/:domain/verify` | Wire: 202 `{domain}` — the SDK returns it; the CLI composes its own copy |
| `domains.dns()` | `GET /domains/:name/dns` | DNS provider information |
| `domains.records()` | `GET /domains/:name/records` | Required DNS records |
| `domains.share()` | `GET /domains/:name/share` | Shareable setup hash |
| `domains.remove()` | `DELETE /domains/:domain` | 200 `{domain}` — resolved, not discarded |
| `tokens.create()` | `POST /tokens` | Returns 201 |
| `tokens.list()` | `GET /tokens` | Paginated — same `{limit, cursor}` contract |
| `tokens.get()` | `GET /tokens/:token` | The same row the listing carries, addressable — `ship tokens get` |
| `tokens.remove()` | `DELETE /tokens/:token` | 200 `{token}` — resolved, not discarded |
| `account.get()` | `GET /account` | |
| `ping()` | `GET /ping` | Returns boolean |
| `getLimits()` | `GET /limits` | Cached after init |
| (internal) | `POST /spa-check` | SPA detection during upload — optional auth, anonymous callers allowed |
| (internal) | `POST /upload` | Only via the `@internal` `deployEndpoint` option (`web/my`, `web/www`) |

**Routes the API exposes that the SDK does not reach.** Two classes — do not
conflate them:

*Settled (first-party or operator surfaces; the SDK is not their client):*
`/billing/*`, `/admin/*`, `/setup`, `/webhooks/*`, `/auth/*`,
`PUT /account/key`, `POST /account/claim`, `DELETE /account`,
`GET /deployments/:deployment/config`, `GET /domains/:domain/propagation`.

*Settled by decision:* **`GET /activities` stays out of the SDK** (decided
2026-07-28). It paginates like every other collection on the API side, but
the dashboard is its only client — a CLI user reads their audit trail in
`my`, not through a resource. This is a deliberate absence, not a gap: do
not add `ship.activities` without a new call.

The argument that reopens it, and why it does not: *"`ActivityListResponse`
is in `@shipstatic/types` with no `*Resource` to fetch it — a public
contract with a missing half."* It has both halves; the SDK is simply not
one of them. The API produces that type and `web/my` consumes it, which is
two consumers and exactly what earns a place in the shared package. A
`ActivityResource` interface with no implementation would be the dead
surface — added, then reverted, on 2026-07-28 for precisely this reason.
The `*Resource` interfaces describe **the SDK's** contract, not the API's;
the API's contract is its routes.

*Open product questions (awaiting a call — see `HANDOVER-SHIP-OVERHAUL.md`
flagged decisions):* `GET /labels` (a real endpoint with no SDK method —
a CLI user would plausibly want it), and `Idempotency-Key` on deploys (the
API's retry-replay contract explicitly targets "agents that retry", yet the
SDK/CLI never send the header and expose no option — today only reachable
via `setHeaders`; flagged 2026-07-27). Neither is drift, and neither should
be added without the call. (List pagination, formerly in this list, shipped
2026-07-27 as F1 and reached the last collection — tokens — on 2026-07-28;
see the Backend Integration table.)

### Domain Write Semantics

`PUT /domains/:name` is a merge-upsert: omitted fields are preserved on update, defaulted on create. Supports: reserve (omit deployment), link, atomic deployment switch, label update.

**No unlinking (by design).** `{ deployment: null }` returns 400. Reservation (forward-looking: "claiming domain, will link soon") is valid; unlinking (backward-looking: "what does this serve now?") is not. To take a site offline, deploy a maintenance page. To clean up, delete the domain.

**Why PUT not PATCH?** Domains are mutable routing records identified by natural key — PUT upsert is one endpoint for create, repoint, and label. Deployments use PATCH because they're immutable artifacts with labels as the only mutable annotation.

### Domain Normalization

The SDK is a transparent pipe — zero domain validation or normalization. It URL-encodes names in API paths (`encodeURIComponent`) and passes everything else as-is. The API owns all domain semantics: it accepts liberal input (any case, Unicode), normalizes to canonical form, validates, and returns the normalized name.

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
