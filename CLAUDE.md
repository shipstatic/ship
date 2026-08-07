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
        ├── bin.ts           # THE EXECUTABLE (dist/cli.cjs) — the only file with side effects
        ├── index.ts         # Commander.js command tree + withErrorHandling + performDeploy
        ├── create-client.ts # Credential precedence (flag → env → file) → Ship instance
        ├── shiprc.ts        # ~/.shiprc + --config reader (strict JSON) — CLI ONLY
        ├── config.ts        # Interactive `ship config` wizard
        ├── error-handling.ts # toShipError + getUserMessage (TEXT channel)
        ├── formatters.ts    # announce() + the render router
        ├── utils.ts         # Output primitives (success/error/info, table, details)
        ├── types.ts         # CLI option + result types
        ├── completions.ts   # Shell completion scripts, RENDERED from the tree
        └── completion.ts    # Shell completion install/uninstall
```

**`bin.ts` is the executable; `index.ts` is a library.** Importing the command
tree has no side effects, which is what lets the suite and the completion
renderer read it. The bin block sat at the bottom of `index.ts` behind
`if (process.env.NODE_ENV !== 'test')` until 2026-07-29 — production behaviour
keyed on a test variable, and a real constraint besides: anything wanting to
read the tree had to be a test or pretend to be one. A module boundary says the
same thing to every caller, without the conditional.

The SDK proper has no filesystem dependency — the only ambient credential source is `SHIP_*` env vars. File-based config (`~/.shiprc`, or a `--config` path) lives entirely in `cli/shiprc.ts`. This is what makes `new Ship({})` safe to use in embedded contexts (MCP, GitHub Action) without leaking the host's `~/.shiprc` credentials. (The n8n node is NOT an SDK consumer — zero runtime dependencies is n8n Cloud's verification requirement, so it speaks HTTP directly and its credential comes from n8n's own store.)

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
| `src/node/cli/bin.ts` | The executable — `dist/cli.cjs`. The one file that runs on import |
| `src/node/cli/index.ts` | CLI command tree, `withErrorHandling`, `performDeploy` |
| `src/node/cli/create-client.ts` | `createClient` + `mergeCliConfig` — credential precedence (flag > env > file) |
| `src/node/cli/shiprc.ts` | `loadShipFile` / `parseShipFile` — strict-JSON reader for `~/.shiprc` and `--config` (CLI only). No repository file is ever read |
| `src/node/cli/utils.ts` | Output primitives (`success`, `error`, `warn`, `info`, `formatTable`, `formatDetails`) |
| `src/node/cli/formatters.ts` | Resource-specific output formatters, `formatOutput` router |
| `src/node/cli/types.ts` | CLI option and result types (`GlobalOptions`, `CLIResult`, `EnrichedDomain`) |
| `src/node/cli/error-handling.ts` | CLI error UX — `toShipError` (normalize), `getUserMessage` (translate). Text channel only; `--json` transmits `ShipError.toResponse()` via `utils.ts` `error()` |
| `src/node/cli/config.ts` | Interactive `ship config` wizard — the only WRITER of the file `shiprc.ts` is the only reader of (writes `~/.shiprc`, or the file `--config` names) |
| `src/node/cli/completions.ts` | `renderCompletion(program, shell)` — bash/zsh/fish scripts derived from the tree |
| `src/node/cli/completion.ts` | Shell completion install/uninstall |
| `tests/fixtures/builders.ts` | Typed fixture builders — the only fixture source |
| `tests/mocks/handler.ts` | The mock API: one Web-standard handler, wire-cited per route |
| `tests/architecture/` | Suite-time fences (integrity, naming, docs contract) |

## Comments state the law; this file keeps the story

**A comment in code states the rule and, where the rule was bought with a bug,
one short pointer — "see CLAUDE.md §…". The dated war story lives only here.**

Narratives drift exactly like code does, and a story told in three places
drifts three ways. Worse, much of what accumulates describes mechanisms a later
change deletes: at one point `config.ts` opened with a 37-line account of a
`JSON.parse` divergence whose parser no longer existed, and `formatters.ts`
explained resolution-order ties that had become inexpressible.

This is a correction, not a new convention. The rest of the platform already
works this way — `cloudflare/api/src` carries 2 dated references across 90
files, `cloudflare/router/src` none across 19, and the SDK half of this package
none at all. The CLI files briefly carried 13 of the package's 18, one of them
58% comment by line. That was drift toward narration, and it is being undone.

What stays in code: the rule, the mechanism, and the non-obvious constraint —
`this`-binding, registration order, why a cast is safe, why a check is
canonical rather than textual. What moves here: dates, bug archaeology, and
"it used to be X" where X is gone.

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
ship.ping()                    // returns PingResponse ({ timestamp })
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

That's the entire SDK contract. `~/.shiprc` and the `--config` path are **CLI-only** — see `src/node/cli/shiprc.ts`. This separation is what makes `new Ship({})` safe in embedded contexts: the SDK can't reach into the host developer's personal dotfile and silently leak credentials into anonymous public deployments. The single env var follows the industry's one-token idiom (`GITHUB_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`).

**The lifetime-dominance doctrine:** storage must not outlive the credential. A dotfile is indefinite — `.shiprc` holds durable tokens. A process environment lives as long as the process — `SHIP_TOKEN` holds whatever its provisioner keeps fresh (a CI job injecting a short-lived token per run is correct). A constructor argument or provider lives per request — it holds anything, which is where hourly OAuth bearers belong.

**The fail-closed anonymity invariant:** anonymity requires proven absence of credentials. An anonymous deploy simply carries no `Authorization` header — the API grants the public-account agent identity per request (`AuthMethod.AGENT`; claim URL + expiry on the response), and the SDK has no agent-token machinery at all. A credential that is present but expired, malformed, or rejected fails the request with a typed error — it never demotes a deploy to an anonymous PUBLIC_ACCOUNT deploy. Empty-string normalization is the invariant's boundary condition: `''` (shell expansion of an unset CI variable) is absence of intent and falls through to the next source; a configured provider yielding nothing is broken intent and throws.

Browser `Ship` has no ambient source at all — the token comes from constructor options (or, for first-party browser apps, the cookie session via `session: true`).

#### Strict-isolation contract for embedded hosts

The env-var fallback is **the** SDK contract. There is no programmatic opt-out — no `envFallback: false` flag, no `token: null` sentinel. Embedded SDK consumers (MCP, GitHub Action, library wrappers, multi-tenant integrations) are expected to manage `SHIP_TOKEN` at the process boundary:

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
| Error | `[error]` prefix, red | `ErrorResponse` (see below) | stderr (unchanged) |

**Text translates, JSON transmits.** The three message envelopes above
(`success` / `warning` / `info`) have no wire counterpart, so they are
CLI-shaped `{ kind: message }`. Errors do have one, and the `--json` channel
emits it verbatim — `ShipError.toResponse()`, so `error` names the
`ErrorType`, `message` carries the wire's own sentence, `status` the HTTP
status. Text mode is the only channel that gets `getUserMessage`'s actionable
rewording ("pass --token, set SHIP_TOKEN, or run ship config").

The two must not be merged. Until 2026-07-29 `--json` emitted
`{ error: <message> }` — prose under the key the API, the SDK, and
`@shipstatic/types` all reserve for the type, which left an agent nothing to
branch on but the sentence, against this platform's own rule that clients
branch on `error` type / `status` and never on message strings. Five emitters
carried the inverted shape, not one.

Two things hold it now, and neither is prose: `error()` in `utils.ts` is
**overloaded** so that a bare string is accepted only for the text channel
(an untyped failure has no wire shape, so writing one into `--json` is a
compile error), and `tests/node/cli/json-errors.test.ts` asserts the envelope
across every producer — the global boundary, Commander's parser,
`handleUnknownSubcommand`, the `preAction` validator, and transport failure.

### Deletions answer with an acknowledgement

The same law, one channel over. A deletion is not void: the wire answers with
the resource noun carrying its canonical key, plus the resource's own state
field where the state changed (`@shipstatic/types`,
`DeploymentDeleteResponse`). It carries no `message` on purpose — *"an
acknowledgement is data, and each surface composes its own copy"* — so this is
the one shape where the API deliberately authors no prose and the CLI is
expected to write the sentence itself.

Three channels, one acknowledgement, each in its own idiom: **quiet** prints
the key, **`--json`** transmits the shape through the single JSON exit in
`formatOutput`, and **text** is the only one that composes copy.

**And the TENSE in that sentence is the response's too.** An acknowledgement
carries the resource's own state field only where the resource survived
mid-transition, so that field is how a surface knows whether to speak in the
past. `DELETE /deployments/:deployment` answers **202**, marks the row
`deleting`, and queues the cleanup; the router serves from KV with no status
gate, so the files stay public until the queue drains (~26s measured). The CLI
read the acknowledgement's key, discarded its `status`, and said "deleted"
anyway — a completed past tense over a live site, which is precisely backwards
for someone deleting a deployment BECAUSE it exposed something. `--json` was
truthful throughout; only the sentence lied. Text now says
`<host> deployment deleting — served until cleanup completes`, while a hard
delete (`{domain}`, `{token}`) still says `deleted`, because there the row is
genuinely gone.

The gate is the transitional-state MAP in `formatters.ts`
(`DELETION_IN_FLIGHT`), never the mere presence of a `status` — `Deployment`
and `Domain` both carry a status of their own (`pending`, `success`), so a
formatter keying on presence would answer "www.example.com domain pending" the
day a handler resolved an entity here. An unrecognised state reads as done.

**The identifier in that sentence is the response's, never the request's.**
The two diverge routinely — a deployment is addressable by bare slug and
answers with its hostname; a domain is accepted in any case and answers
normalized — so a sentence built from the argument names whichever form the
caller happened to type. The resource noun is the CLI's own word, and because
an acknowledgement is the resource noun carrying its key, that one `resource`
both selects the field and writes the sentence.

This regressed once, in `11fc633` ("the SDK reaches what the API offers"). The
commit gave the delete methods real return types and, in the same diff, widened
the formatter's branch from `result === undefined` to a test on the operation
name — so the branch began intercepting the acknowledgement that commit had
just plumbed through. `--json` emitted `{ success: "<slug> deployment
removed" }`: prose in the data channel, a bare slug where the platform names
an FQDN, and no `status` at all. Before that commit the CLI had been
accidentally right, because a resolved result fell through to the shape
router.

Two things hold it now, and neither is a convention: `OutputContext` no longer
carries the caller's argument at all — the field existed only to be echoed, so
it went with the echo, and a sentence composed from input is now inexpressible
— and `tests/node/cli/json-acknowledgements.test.ts` asserts the envelope for
every deletion, including that deleting one deployment by slug and by hostname
produces byte-identical output.

### What a status means

`ErrorResponse.status` is documented **"HTTP status code (API contexts)"** — it
is a fact about an exchange, not decoration on a 4xx-ish type. So the question
is never "did we make a request?", it is **"what would the wire say?"**:

- **A check that mirrors a server rule keeps the status the server would send.**
  Blocked extensions, label rules, password length, token format — the platform
  validates these on both sides from the same imported rules (root `CLAUDE.md`,
  "Validation Architecture"), and the whole point is that the error reads the
  same wherever it was caught. `ShipError.validation(...)` with its 400 is
  correct here.
- **A fault with no server rule to mirror carries no status**, and therefore one
  of the client-only types — `Network`, `Cancelled`, `File`, `Config`, which are
  exactly the statusless factories in `@shipstatic/types`. Your shell, your
  dotfile, this binary's command grammar: no API has an opinion on any of them,
  so a 400 would be an HTTP fact about an exchange that never happened. That is
  a *plausible* lie, which is worse than an obvious one — it survives review.

`completion.ts` is the worked example: an fs call that threw is `file`,
everything else there is a statement about the user's shell setup, so `config`.
CLI grammar errors go through `usageError()` in `index.ts` — `Validation` for
the type, no status.

**The SDK was audited against this rule (2026-07-29) and mostly already
complied** — an earlier note here claimed "~25 sites violate it", which was
wrong and is corrected. Almost every local throw in `src/shared/`,
`src/browser/`, and `src/node/core/` *mirrors a server rule* and rightly keeps
its 400: blocked extensions, unsafe filenames, path traversal, label rules, and
the size/count caps all come from the same imported constants the API enforces
(`hasUnbuiltMarker` is checked in `api/src/lib/validation.ts` too). One site was
genuinely wrong — a failed local file read in `md5.ts`, now `ShipError.file`
with the path in `details`.

What remains is a third category the rule deliberately does not govern:
**assertions** like "processFilesForNode can only be called in Node.js
environment" or "Invalid input for MD5 calculation". They guard states a correct
caller cannot reach, so their type and status are not a contract anyone reads,
and reclassifying them would be churn for no observable difference. Leave them.

**Local commands throw; they never report.** `completion` and `config` make no
request, so neither can use `withErrorHandling` (it builds a `Ship`, which
resolves credentials). Both take the same shape instead — the action wraps the
call and hands anything thrown to `handleError` — which is what gives a local
failure the same one writer and the same exit code as every other. Reporting
inline is not a smaller version of this; it is a different thing that looks the
same: `completion` printed `[error] …` and then exited **0** until 2026-07-29,
so `ship completion install && …` ran on after a failure. `handleError` in turn
resolves the credential only for the auth branch, so a local failure never
reads `.shiprc` to render its own message.

- Text messages open lowercase (leading sentence word decapitalized; identifiers, paths, and acronyms survive verbatim); trailing periods stripped — `plainMessage` in `utils.ts` is that typography, named once
- Deletions produce a success message **in text only** — see "Deletions answer with an acknowledgement" below

### One grammar: `<key> <noun> <verb>` — and one function

`announce(result, context)` in `formatters.ts` composes **every** sentence the
CLI makes about a mutation, from the two things it already has: what the command
IS (`OutputContext`) and what the wire ANSWERED. Nothing else is needed, and no
formatter writes a template any more:

```
<canonical key> <resource noun> <past tense, or the wire's own state>
```

The key is read from the NOUN (`result[noun]`), so `.url` is not reachable; the
word order belongs to the function, not a call site; and the state override
applies everywhere at once, so an operation that becomes asynchronous tomorrow
updates its own sentence. Five formatters each wrote their own template until
2026-07-29 and produced six grammars between them — every one of those bugs was
a formatter making a choice it did not need to make. Three of them stopped
needing `context` at all once the sentences were hoisted, which is the cleanest
evidence the split was real: a renderer does not need to know what the command
was.

**Mutations announce, reports render.** A report has no key and no verb, so it
prints its answer instead — `ping`, `validate`, `records`, `dns`, `share`.
`ACKNOWLEDGING` (`delete`, `verify`) names the mutations whose response is an
acknowledgement and therefore has no entity to render beneath the sentence.

The resulting sentences:

```
mock-deploy-001.shipstatic.com deployment uploaded
www.example.com domain created            (…updated)
tok0001 token created
www.example.com domain verification queued
www.example.com domain deleted
tok0001 token deleted
brave-otter-a1b2c3d.shipstatic.com deployment deleting — served until cleanup completes
www.example.com domain is valid
```

**The key, never the URL.** A URL is a *field* of the resource and is already
printed on its own row in the details block below, so opening with it made the
text channel disagree with `-q` and `--json`, which have always named the key.
`ship ./dist` and `domains set` opened with the URL while `verify` and `delete`
opened with the key — one resource, two identifiers, decided by which command
you happened to run.

Audited against the real binary on 2026-07-29 and found to be **six** grammars
across eleven messages: `token tok0001 created` inverted the order its own
sibling `tok0002 token deleted` used; `domain is valid` named no subject at all
though it held the normalized name; `domains share` emitted a bare URL
identical to its own `-q` output. Fenced by the `it.each` table in
`tests/node/cli/formatters.unit.test.ts` ("one grammar"), which asserts every
composed sentence *starts with* the key its fixture carries — so a new command
cannot invent a seventh form.

**Reports render, mutations announce.** A report answers a question, so it
prints its answer (`records` a table, `dns` and `share` a details block,
`validate` its verdict, `ping` the word `api reachable`); only a mutation gets
a success sentence. `share` printed a green URL under `success()` until this
audit, which is why its text and `-q` output were byte-identical.

**A verdict is not a failure.** `domains validate` on an invalid name writes
the reason to **stdout** and sets exit 1. The exit code is the machine answer —
`ship domains validate x && …` is the documented idiom — but the call
*succeeded*, and stderr under `[error]` claimed otherwise, contradicting both
the SDK (which resolves that shape without throwing) and `--json` (which has
always put the same verdict on stdout). It names no subject because
`normalized` is null when invalid: the response carries no identifier, and the
CLI does not fall back to the caller's argument.

**Shell completions are RENDERED from the tree, not shipped.**
`renderCompletion(program, shell)` emits bash/zsh/fish, and
`ship completion install` writes what it renders at that moment — so an
installed completion always matches the binary that installed it, which a
copied file could never promise. Three hand-written scripts lived in
`src/node/completions/` until 2026-07-29 and were the third, fourth and fifth
statement of the command tree: `ship tokens get` shipped the previous day and
completed in **zero** shells, `--limit`/`--cursor` were in none of them, `--ttl`
in one (unscoped), and several descriptions had drifted word for word from
Commander's. Generation also changed the arithmetic on accuracy — per-subcommand
flags are free once derived, so they are now offered where a hand-maintained
matrix never bothered. `tests/node/cli/completions.test.ts` quantifies over the
whole tree; the smoke tier installs through the real binary and runs `bash -n` /
`zsh -n` / `fish --no-execute`, because a real shell is the only thing that can
say the output parses.

**And so is scoped usage.** `handleUnknownSubcommand` — what a command GROUP
runs when none of its own subcommands matched — took `(parentName,
validSubcommands[])` by hand until 2026-07-30 and was the last hand-written
restatement of the tree, the fifth statement after the three shell scripts
generation had just deleted. It was stale in the same way and for the same
reason: `ship tokens get` shipped on 2026-07-28, the array beside it was not
updated, and `ship tokens bogus` answered `usage: ship tokens
<list|create|delete>` while the derived completion one module over offered all
four. It now reads `this.name()` and `subcommandsOf(this)` — Commander binds
`this` to the command and collects the leftover words in `this.args` — so it
takes no arguments, closes over nothing, and lives at module scope.

The fence is in `tests/node/cli/unknown-commands.test.ts`, and it too is
quantified over `buildProgram()`: the hand-written table that used to sit there
carried the very defect it existed to catch, omitting `tokens` altogether. Note
the consequence for word order — the printed list is now REGISTRATION order,
which is also what `ship domains --help` and the completions show. One order,
three surfaces. The front page keeps its own, by design.

**The front page may curate, but not forget.** `helpText()` is hand-written and
byte-pinned, so leaving a command off is legitimate — provided the omission is
recorded in `HELP_OMISSIONS` (`tests/architecture/docs-contract.test.ts`) with
its reason. It was missing `ping`, `account get` and `tokens get` when the fence
was written; two were added to the page, and `account get` is recorded, because
`ship whoami` is the same read and is the spelling the page shows.

**`-q` prints the key for every shape that has one.** `tokens get` and
`tokens delete` printed NOTHING until 2026-07-29 — the quiet router matched the
`tokens` collection and had no branch for a single token, so the one resource
whose identifier you most want to pipe was the only one emitting none, and
`ship tokens list -q | xargs -I{} ship tokens delete {} -q` (this repo's own
README idiom, one noun over) was silent. The one deliberate exception is
`tokens create -q`, which emits the **secret** rather than the id: it is shown
once and never again, so `ship tokens create -q >> .env` is why that channel
exists there. It is checked before the `token` branch, since a creation
response carries both.
- Internal fields (`isCreate`, `_dnsRecords`, `_shareHash`) are stripped from JSON output
- `[error]`/`[warning]`/`[info]` prefixes use inverse color backgrounds in TTY

### No repository file is ever read

`.shiprc` resolution is **two locations**: `~/.shiprc`, or the path `--config`
names. A project-level search — `./.shiprc`, `package.json` `"ship"`, walking
up from the cwd — sat in front of both until 2.0.0 and is gone, along with
cosmiconfig.

It was deleted rather than fixed, because its only capability WAS the
anti-pattern: a repository-controlled file supplying credentials. Two exploits
were verified against the real binary on 2026-07-30:

1. A cloned repo's `package.json` carrying `{"ship": {"apiUrl": "http://…"}}`
   received `Authorization: Bearer <the user's SHIP_TOKEN>` on a plain
   `ship deployments list` — exit 0, no warning.
2. **Worse, because it survived the first patch:** a repo's `token` outranked
   `~/.shiprc` entirely, so `ship ./dist` in a cloned repo deployed to the
   *repo owner's* account, silently.

The first was patched with a `refuseProjectApiUrl` rule (~50 lines with
symlink canonicalisation, since `/var` is a symlink on macOS and a textual
compare misread the user's own home file as a project file). That patch was
the wrong SHAPE of fix: it refused one field of a surface whose every field
was equally untrustworthy, which is why the second exploit was still there
after it. Both are properties of the surface, so the surface went.

The asymmetry that gives the game away: the wizard `chmod`s `~/.shiprc` to
0600 "like `~/.netrc`" while the reader accepted the same credential from a
tracked, world-readable `package.json`.

`--config <file>` is unaffected and is now strictly better — there is no
extension dispatch to work around, so any path is simply read.

**Format: strict JSON.** YAML acceptance was an accident of cosmiconfig's
`noExt` loader default, and it cost the `dev.shiprc` "No loader specified"
bug, a two-pass writer/reader repair, and a 15-line comment explaining
`extname` dispatch. Nothing in the product ever produced YAML — the wizard
writes JSON and the docs show JSON. An **empty file is an absent config**, not
a broken one; `touch ~/.shiprc` and any interrupted write produce one.

### One file, two commands, one idea of what it is

`ship config` is the only WRITER of the file `shiprc.ts` is the only READER of.
They held different ideas of it until 2026-07-30, in both directions, and both
were user-visible:

- The reader parses and validates against `CREDENTIAL_FIELDS`;
  the writer parsed with a bare `JSON.parse` inside a `catch → {}`. So a
  `.shiprc` the reader rejected BY NAME — `Invalid config in …` — read here as
  "no existing config", and the wizard wrote `{}` over it. Token and `apiUrl`
  gone, under a `saved to …` message. The natural response to the reader's
  error is to run `ship config`, which made **the recovery path the
  destructive one**.
- Going the other way, "preserve every other field" preserved fields that make
  the file UNLOADABLE. The reader's own rename hint reads `"apiKey" is no
  longer supported — the key is now "token". Run \`ship config\` to rewrite
  it`; doing so wrote `token` and KEPT `apiKey`, so the next command failed
  with the identical error. **The advice was a loop.**

Both are one rule now: **the schema is the file.** `CREDENTIAL_FIELDS` is
`.strict()`, so `token` and `apiUrl` are not merely the fields the wizard cares
about — they are the only fields a `.shiprc` may legally hold. The writer
rebuilds the file from `Object.keys(CREDENTIAL_FIELDS)` rather than mutating
what it read, so a key the reader would reject cannot survive a rewrite;
dropping one IS the repair the rename hint promises, and it is announced rather
than done quietly. And it **refuses what it cannot parse** instead of replacing
it, with `ErrorType.Config` and the writer's own closing clause — *the file was
left unchanged* — because a file we cannot read is a file whose contents we
cannot claim to preserve.

**The FORMAT is shared outright.** `readExistingConfig` calls the reader's own
`parseShipFile`. Getting here took two passes: the first fix repaired the
schema layer and left a bare `JSON.parse` in the writer, which moved the
divergence down one level rather than closing it — an empty file read as
absent everywhere and as broken here.

**One parse, two policies** is the whole statement: the reader parses then
validates and rejects; the writer parses then repairs what the reader rejects.
The schema layer diverges *on purpose* — the writer must accept `{apiKey}` in
order to fix it — which is why the fence asserts format agreement only, per
file, in `tests/node/cli/config.test.ts` ("one parse, two policies"): reader
and writer are run over the same content and their verdicts compared, rather
than each side being checked against a hand-written expectation of the other.
When `.shiprc` became strict JSON in 2.0.0 that fence needed no structural
change — only its `expected` column moved, on both sides at once, which is the
fence working.

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
    { operation: 'get', resource: 'deployment' }
  ));
```

`OutputContext` (`operation`, `resource`) names what the command IS. Both are
**union types**, not strings: `operation` selects behaviour (`PAST_TENSE`,
`ACKNOWLEDGING`) and `resource` names the response field carrying the
identifier, so a typo in either used to mean a command that silently announced
nothing with every test still green. `resource` is lowercase because that IS
the field name — `announce` reads `result[resource]` directly; it was
`resourceType: 'Deployment'` with a `.toLowerCase()` at the single point of
use, a capitalisation carried around only to undo.

It reaches `formatOutput` and **nothing else**. The error path took it too
until 2026-07-29 and ignored it — `getUserMessage`'s parameter was literally
`_context` — and could not have used it either: the wire message already names
the resource, which is why the CLI relays it. `withErrorHandling` additionally
re-declared the context's shape inline and rebuilt it field by field into a
copy; both are gone.

It deliberately carries **no positional argument**: the arguments are the
request, and every sentence the CLI writes about a result is composed from the
response. A `getResourceId` plumbed the caller's argument to the formatter
until 2026-07-29, where its only consumer echoed it back as the deletion
identifier — see "Deletions answer with an acknowledgement".

### `formatOutput` Router — one table, both channels

`SHAPES` in `formatters.ts` lists every response shape the CLI can receive, in
resolution order, each stated ONCE with both of the things a channel needs from
it: the key `-q` pipes forward, and the formatter text renders.

| Discriminant | `-q` emits | Text |
|---|---|---|
| `deployments` | one id per row | `formatDeploymentsList` |
| `domains` | one name per row | `formatDomainsList` |
| `tokens` | one id per row | `formatTokensList` |
| `records` | `<type> <name> <value>` per row | `formatDomainRecords` |
| `hash` | the setup URL | `formatDomainShare` |
| `dns` | the provider name, if resolved | `formatDomainDns` |
| `domain` | the name | `formatDomain` (plain `Domain` or `EnrichedDomain`) |
| `deployment` | the id | `formatDeployment` |
| `secret` | the SECRET — shown once, never again | `formatToken` |
| `token` | the id | `formatToken` |
| `email` | the address | `formatAccount` |
| `valid` | the normalized name, or nothing | `formatDomainValidate` |

Plus `(operation: 'ping')`, answered before the table — text says
`api reachable`, `--json` transmits `{ timestamp }`, `-q` says nothing.

**Order is load-bearing** in two places, and both are ties rather than
preferences: `Domain` carries a `deployment` field, so `domain` must precede
`deployment`; a token creation carries both `token` and `secret`, so `secret`
must precede `token`.

**The two channels were two independent `if/else` chains until 2026-07-30** —
twelve branches and eleven, same discriminants, same order, nothing tying them.
That is not a hypothetical hazard; it is a bug this CLI shipped. `tokens get`
and `tokens delete` printed NOTHING under `-q` until 2026-07-29, because the
quiet chain had a branch for the `tokens` COLLECTION and none for a single
token while the text chain had both — so the one resource whose identifier you
most want to pipe was the only one emitting none. A row cannot half-exist, and
resolution order is now a property of the list rather than something two chains
have to keep agreeing on.

`SHAPES` is **exported for the suite**, and that tie is load-bearing rather than
cosmetic. `tests/node/cli/formatters.unit.test.ts` pins a hand-written case per
row — the values `-q` must emit — and then asserts its own list deep-equals
`SHAPES.map(s => s.on)`. Without that last line the completeness check counted
the test's own array and was a tautology: a thirteenth row added to `SHAPES`
left the suite green while that shape was asserted by nothing, which is the
precise scenario the check claimed to prevent (caught in review, 2026-07-30).
Asserting the mapped list rather than a length also makes the two order ties
above enforced rather than trusted to this paragraph. A fence must quantify over
PRODUCTION and pin expectations by hand; both sides hand-written is a mirror.

A shape with no row falls through to `formatDetails`, deliberately — a future
`GET /labels` shows its content on the first run rather than needing a
formatter first.

A deletion short-circuits ahead of the table **in text mode only**, composing
its sentence from the acknowledgement; in `--json` it falls through to the one
JSON exit, and in `-q` the quiet branch above the table has already printed the
key.

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

### The four fences

`tests/architecture/` holds suite-time invariants. Each catches a class the
others cannot:

| Fence | Catches |
|---|---|
| `test-integrity.test.ts` | A test file that reaches NO production code — the tautology class. A tautology neither raises nor lowers coverage, so no ratchet can see it. Reach is resolved TRANSITIVELY through local test-support modules (`./harness`, `../mocks/…`) but importing only fixture builders does not count — builders pull in `@shipstatic/types`, never `src/`. Its only exceptions are the two artifact tiers (`smoke.test.ts`, `package/dist-entries.test.ts`), each recorded with a reason. |
| `test-naming.test.ts` | Layout drift: a filename that describes the test instead of its subject, a mirror file with no `src/` counterpart, an aspect split not recorded in this file. |
| `docs-contract.test.ts` | Drift between the PUBLISHED docs and this code — a command or flag the docs teach that does not exist, a command that exists and no doc teaches, an SDK member or response key the docs name that `@shipstatic/types` dropped. Also the curated front page: a command missing from `helpText()` must be recorded in `HELP_OMISSIONS` with a reason. |
| `coverage.thresholds` | Coverage decay. A ratchet — it only goes up. Global bar plus per-glob floors for the three files whose residual gaps are named in `vitest.config.ts` (bin block/spinner/SIGINT are smoke-proven; browser env arms are browser-tier-proven). |

**`SKILL.md` is API surface, not prose.** `package.json` publishes it beside
`README.md`, and for an agent it IS the API surface — the file read before a
command is typed. The 2026-07-29 `remove` → `delete` rename swept every source
file, every test and README, and missed it: `2.0.0-beta.8` shipped teaching
three commands with no alias to soften the landing, plus `"total": N` on list
responses, a field types had deliberately removed. Both drifts sat outside all
five fences of that wave, because every one of them fenced code.

The fence reads the docs named in `files`, so **shipping a new markdown file is
what puts it under contract** — there is no list to update. Its one deliberate
omission is `helpText()`: a hand-curated front page (see "Two help scopes")
byte-pinned by the smoke tier, where leaving a command out is a design choice.
Reference documentation makes no such claim.

### The mock server

`tests/mocks/` is a hand-maintained twin of `cloudflare/api`, in three parts:
`handler.ts` (one Web-standard `handleApiRequest(request, state)`),
`state.ts` (per-instance state from a factory), and `server.ts` (a thin
`node:http` adapter plus lifecycle).

Three mechanisms keep it honest, and they cover different halves:

| | Holds | Runs |
|---|---|---|
| `satisfies` on every body | the response SHAPES | `pnpm typecheck` |
| `tests/contract.ts` | the BEHAVIOUR — status, typed error, guard order | CI (mock half) + opt-in (live half) |
| `// wire:` citations | where to look when one of the above fails | a reader |

**The contract table is the one that closed the real gap.** Shapes were tied to
the published types on 2026-07-29, but behaviour was tied to nothing: a route
flipping 202 to 200 leaves every citation reading exactly as before, and ~1000
tests green. The e2e suite was nominally the detector — its header even claimed
it "asserts the same contract points the mock encodes" — but nothing checked
that claim, so they were two hand-maintained lists with no tie. Now the points
live once in `tests/contract.ts` and two runners consume them:
`tests/contract.test.ts` (mock, in CI) and the `wire contract` block of
`tests/e2e/smoke.e2e.test.ts` (real API, opt-in). Both observe through
PUBLISHED surface only — a success's status off the `response` event, a
failure's off the `ShipError` — which is what lets one table drive both.

**What each half can say**, stated because the difference matters: the mock
half proves the mock encodes the table; only the live half can prove the table
matches `cloudflare/api`. So CI catches a mock that drifts from the table, and
a live run catches a table that drifts from the API. **Run `pnpm test:e2e`
before a release, and after any API change.**

Rows the e2e tier must not run carry their reason as a string instead of
`live: true` (`NO_DOMAINS`, `NO_TOKENS`), so the coverage gap is stated in the
table rather than inferred. That gap always existed; it was simply invisible.

**To have CI catch API drift too**, add `SHIP_E2E_API_KEY` and
`SHIP_E2E_API_URL` as repository secrets and a job that runs `pnpm test:e2e`
when they are set. It should NOT gate `publish`: the dev API is deployed by
hand and may legitimately lag this repo, so a red contract run means "these two
disagree", not "this release is wrong". Deliberately not wired today — inert
config rots.

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
6. **Every mock route cites its `cloudflare/api` wire truth**, `satisfies` its
   published response type, and has its status / typed error / guard order
   stated in `tests/contract.ts` — a citation says where to look, the type
   holds the shape, the table holds the behaviour.

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
  stdout surviving a pipe intact, and the completion round trip — install
  through the real binary, then `bash -n` / `zsh -n` / `fish --no-execute` over
  what it wrote, because a real shell is the only thing that can say the
  rendered script parses.

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
├── contract.ts       # The wire facts ship depends on — stated ONCE
├── contract.test.ts  # …run against the MOCK (CI). Its twin is in e2e/
├── architecture/     # Fences: integrity, naming, docs contract
├── browser/ node/ shared/   # Mirror axis — tests/<path>/<module>.test.ts
├── node/cli/completions.test.ts  # The rendered shell scripts (mirror of completions.ts)
├── node/cli/harness.ts      # In-process CLI runner (buildProgram + capture)
├── node/cli/smoke.test.ts   # The ONE child-process file (dist/cli.cjs)
├── package/          # The BUILT artifact (dist entries)
├── e2e/              # Real API, opt-in — runs the SAME contract table
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
- `getUserMessage(err, context, options)` — maps a `ShipError` to an actionable user-facing CLI string (auth → credential hints, network → connectivity, client/4xx → trust the API message, 5xx → generic "try again"). **Text channel only.**

There is deliberately no JSON formatter in this module. `--json` serialization
is `ShipError.toResponse()`, emitted by `error()` in `utils.ts` — a second
serializer is exactly how the `--json` envelope drifted from the wire's in the
first place. See "Output Conventions" above.

## Known Gotchas

**Deploy token vs API key** — both ride the one `token` slot; the prefix says which population a value belongs to. An API key (`ship-`) is durable and grants full account access; a deploy token (`deploy-`) is scoped to deploys, supports an optional TTL, and is revocable.

**Browser file handling** — SDK extracts path from `webkitRelativePath` or falls back to `name`.

**Credential resolution (effective end-to-end):**

| Layer | Where | Reads |
|---|---|---|
| **CLI** | `src/node/cli/shiprc.ts` | `~/.shiprc`, or the `--config` path (strict JSON) |
| **CLI** | `src/node/cli/create-client.ts` `createClient()` | merges flag → env → file via `mergeCliConfig`, hands result to `new Ship({...})` |
| **SDK (Node)** | `src/node/index.ts` constructor | `SHIP_TOKEN`, `SHIP_API_URL` (under any constructor arg) |
| **SDK (Browser)** | `src/browser/index.ts` constructor | nothing — fully explicit |

For a CLI user who has all three: `--token` flag → env → file, per value. For an embedded SDK consumer: constructor arg → env. There's no path from the SDK to the filesystem.

**CLI-only env vars** (read by the CLI but *not* by the SDK constructor):

| Var | Purpose |
|---|---|
| `SHIP_PASSWORD` | Default for `--password <password>` on `ship deploy` / `ship deployments upload`. Empty string is normalized to absence (so unset CI variables don't accidentally protect a deploy). |
| `SHIP_VIA` | Overrides the deploy `via` field (the CLI sends `'cli'` when unset). Used by integrations that **wrap the CLI as a subprocess** — the GitHub Action sets `SHIP_VIA=git`. In-process SDK consumers (e.g. the MCP server) set the same field as a programmatic `via` option on the SDK call (`ship.deployments.upload(..., { via: 'mcp' })`) — same destination, different mechanism. Distinct from the programmatic `caller` option, which is for rate-limit bucketing in multi-tenant orchestrators (see `ShipClientOptions.caller` JSDoc). |

**Every deploy names its surface; `via` is never empty by accident.** The
registry is `DeploymentVia` in `@shipstatic/types` — closed on purpose. Each
client owns its member (`cli`, `git` for the Action, `mcp`, `vsc`, `web` for
the web apps, `n8n`, `gpt`), and a direct SDK call falls back to `sdk`,
applied at the single wire boundary in `api/http.ts` so it cannot differ per
platform. A closed enum is what makes a surface's attribution the COMPILER's
business: the vscode extension's `via: 'vsc'` stopped being a lockstep anyone
had to remember the day the types pin landed there, and a typo'd value cannot
silently store as `NULL` — `normalizeVia` drops what the vocabulary does not
name, and the request option refuses it at compile time. Adding a
distribution surface is a types PR, which is exactly the ceremony a new
surface deserves. What the `sdk` default buys is that an absent `via` on a
stored deployment means an unattributed caller (raw HTTP), never "probably
the SDK" — the reading Vercel's `source` and every self-identifying SDK
client (AWS, Stripe, OpenAI) assume.

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

A **build or prerender** deploy is the third: it waits for work the SERVER does after the upload lands, so `DEFAULT_DEPLOY_BUILD_TIMEOUT` is **derived, not chosen** — written in code as `DEFAULT_DEPLOY_TIMEOUT + BUILD_SERVICE_BUDGET`, so the name and the value compose the same way (`DEPLOY` plus `BUILD`; the deploy budget plus the build budget) and tuning either half carries. Raising that server constant must raise this one; they sit in different repos so nothing fences the pair, and the constraint is stated at both ends. `spa` does NOT qualify: it is local detection bounded by the AI tier's own 10s, and only build/prerender reach the build service.

**Only the DEFAULTS split by operation** — an explicit `timeout` option governs every request including deploys, because a caller who names a ceiling asked for a ceiling, not for one with an exception.

The correct instrument is an **idle timeout** — reset on progress, so it measures whether the connection is alive rather than whether the transfer has been long, which is the only formulation independent of payload size. It is blocked on upload-progress observation, which `fetch` cannot provide in the browser. Build it when someone wants a progress bar; the timeout falls out of that work for free.
| `deployments.list()` | `GET /deployments` | Paginated — `{limit, cursor}` options (`--limit`/`--cursor` on the CLI; text mode prints a rerun hint while `--json` carries `cursor`) |
| `deployments.get()` | `GET /deployments/:deployment` | |
| `deployments.set()` | `PATCH /deployments/:deployment` | Labels only |
| `deployments.delete()` | `DELETE /deployments/:deployment` | 202 (async) `{deployment, status:'deleting'}` — resolved, so a caller learns the transitional state without a re-read |
| `domains.set()` | `PUT /domains/:name` | Upsert — create, repoint, or label |
| `domains.list()` | `GET /domains` | Paginated — same `{limit, cursor}` contract |
| `domains.get()` | `GET /domains/:name` | |
| `domains.validate()` | `POST /domains/validate` | Pre-flight check — name rides the JSON body, not the path |
| `domains.verify()` | `POST /domains/:domain/verify` | Wire: 202 `{domain}` — the SDK returns it; the CLI composes its own copy |
| `domains.dns()` | `GET /domains/:name/dns` | DNS provider information |
| `domains.records()` | `GET /domains/:name/records` | Required DNS records |
| `domains.share()` | `GET /domains/:name/share` | Shareable setup hash |
| `domains.delete()` | `DELETE /domains/:domain` | 200 `{domain}` — resolved, not discarded |
| `tokens.create()` | `POST /tokens` | Returns 201 |
| `tokens.list()` | `GET /tokens` | Paginated — same `{limit, cursor}` contract |
| `tokens.get()` | `GET /tokens/:token` | The same row the listing carries, addressable — `ship tokens get` |
| `tokens.delete()` | `DELETE /tokens/:token` | 200 `{token}` — resolved, not discarded |
| `account.get()` | `GET /account` | |
| `ping()` | `GET /ping` | Resolves `PingResponse` (`{timestamp}`) — reachability is the absence of a throw, so there is no boolean to read |
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
a CLI user would plausibly want it), and an `--idempotency-key` CLI flag.
The SDK half of that second one **shipped**: `deploy()` takes
`idempotencyKey`, validates it through `validateIdempotencyKey`, and sends
the header (see the Backend Integration table). Only the CLI has no way to
name one, so a shell-driven retry — which is exactly the "agents that retry"
case the API's contract targets — still cannot reach it. This paragraph
claimed "the SDK/CLI never send the header" until 2026-07-30, which was
true when written and stale thereafter. Neither item is drift, and neither
should be added without the call. (List pagination, formerly in this list, shipped
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
