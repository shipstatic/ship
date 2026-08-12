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
drifts three ways — at one point `config.ts` opened with a 37-line account of
a `JSON.parse` divergence whose parser no longer existed. What stays in code:
the rule, the mechanism, and the non-obvious constraint — `this`-binding,
registration order, why a cast is safe. What moves here: dates, bug
archaeology, and "it used to be X" where X is gone. The rest of the platform
already works this way.

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

**Events — every failure is visible, and the event NAME says whether it ended
the call:**
```typescript
ship.on('request', (url, init) => ...);          // once per ATTEMPT
ship.on('retry', (error, url, attempt) => ...);  // that attempt failed; another is coming
ship.on('response', (response, url) => ...);     // the call succeeded
ship.on('error', (error, url) => ...);           // the call failed, terminally
```

One call emits `retry* (error | response)`, so the stream is unambiguous at
every PREFIX — a consumer never has to wait to learn what it is watching. The
failure events are emitted by `executeRequest`, not `attemptOnce`, and that
placement IS the mechanism: terminality is a property of the loop, so an
attempt cannot name its own failure. `attempt` counts from 1, which makes the
value read both ways at once — attempt N failing IS retry N.

See "Retries" for why this replaced a per-attempt `error`.

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

This regressed once (`11fc633`): the commit that gave the delete methods real
return types also widened the formatter's branch to a test on the operation
name, intercepting the acknowledgement it had just plumbed through — `--json`
emitted `{ success: "<slug> deployment removed" }`: prose in the data
channel, a bare slug where the platform names an FQDN, no `status`. Two
things hold it now, and neither is a convention: `OutputContext` no longer
carries the caller's argument at all (the field existed only to be echoed, so
a sentence composed from input is now inexpressible), and
`tests/node/cli/json-acknowledgements.test.ts` asserts the envelope for every
deletion — including that deleting by slug and by hostname produces
byte-identical output.

### What a status means

`ErrorResponse.status` is documented **"HTTP status code (API contexts)"** — it
is a fact about an exchange, not decoration on a 4xx-ish type. So the question
is never "did we make a request?", it is **"what would the wire say?"**:

- **A check that mirrors a server rule keeps the status the server would send.**
  Blocked extensions, label rules, password length, token format — the platform
  validates these on both sides from the same rules (root `CLAUDE.md`,
  "Validation Architecture"), and the whole point is that the error reads the
  same wherever it was caught. `ShipError.validation(...)` with its 400 is
  correct here. **"The same rules" means imported OR delivered**: the extension
  blocklist arrives at runtime in `PlatformLimits.blockedExtensions` rather than
  as a constant, and mirrors the server no less for it — more so, since a
  delivered rule cannot be stale.
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
its 400: unsafe filenames, path traversal, label rules, and the size/count caps
all come from the same constants the API enforces (`hasUnbuiltMarker` is checked
in `api/src/lib/validation.ts` too), and blocked extensions come from the list
the API *delivers*. One site was genuinely wrong — a failed local file read in
`md5.ts`, now `ShipError.file` with the path in `details`.

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

`announce` has **two occasions, one writer**: `formatOutput` calls it for the
answer, and `announceStep` calls it mid-command for the first beat of a
composed one (`ship <path> --domain <name>`). `announceStep` is the only export
— `announce` itself stays private, because a second exported sentence-maker is
how six grammars happened the first time. See "Composability".

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
`ship completion install` writes what it renders at that moment — an
installed completion always matches the binary that installed it, which a
copied file could never promise. Three hand-written scripts were the third,
fourth and fifth statement of the command tree until 2026-07-29 (`ship tokens
get` shipped the previous day and completed in **zero** shells;
`--limit`/`--cursor` were in none of them). `tests/node/cli/completions.test.ts`
quantifies over the whole tree; the smoke tier installs through the real
binary and runs `bash -n` / `zsh -n` / `fish --no-execute`, because a real
shell is the only thing that can say the output parses.

**And so is scoped usage.** `handleUnknownSubcommand` reads `this.name()` and
`subcommandsOf(this)` — no arguments, no closure, module scope. Until
2026-07-30 it took `(parentName, validSubcommands[])` by hand — the last
hand-written restatement of the tree, stale the same way (`ship tokens bogus`
offered three subcommands while the derived completion one module over
offered four). Fenced in `tests/node/cli/unknown-commands.test.ts`,
quantified over `buildProgram()` (the hand-written table it replaced carried
the very defect it existed to catch). Consequence for word order: the printed
list is REGISTRATION order — the same order `--help` and the completions
show. One order, three surfaces; the front page keeps its own, by design.

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

`ship config` is the only WRITER of the file `shiprc.ts` is the only READER
of. Until 2026-07-30 they held different ideas of it, in both directions: the
writer's bare `JSON.parse` inside `catch → {}` read a file the reader
rejected BY NAME as "no existing config" and wrote `{}` over it — token and
`apiUrl` gone, under a `saved to …` message, making **the recovery path the
destructive one**; and "preserve every other field" kept the very `apiKey`
the reader's rename hint promised `ship config` would fix, so **the advice
was a loop**.

Both are one rule now: **the schema is the file.** `CREDENTIAL_FIELDS` is
`.strict()` — `token` and `apiUrl` are the only fields a `.shiprc` may
legally hold. The writer rebuilds the file from
`Object.keys(CREDENTIAL_FIELDS)` rather than mutating what it read (dropping
a rejected key IS the repair the hint promises, announced rather than done
quietly), and it **refuses what it cannot parse** instead of replacing it
(`ErrorType.Config`, *the file was left unchanged*) — a file we cannot read
is a file whose contents we cannot claim to preserve.

**The FORMAT is shared outright** — `readExistingConfig` calls the reader's
own `parseShipFile`. **One parse, two policies**: the reader parses then
rejects; the writer parses then repairs what the reader rejects (it must
accept `{apiKey}` in order to fix it). The fence therefore asserts format
agreement only, per file (`tests/node/cli/config.test.ts`): reader and writer
run over the same content and their verdicts are compared — when `.shiprc`
became strict JSON in 2.0.0 that fence needed no structural change, only its
`expected` column moved on both sides at once, which is the fence working.

### Composability

`-q` outputs only the key identifier — the value you'd pipe forward. `domains set` reads deployment from stdin when piped.

```bash
ship ./dist -q | ship domains set www.example.com
ship ./dist --domain www.example.com          # the same two calls, one command
```

**Both spellings are product; neither replaces the other, and this paragraph
exists so the question stays answered.** The pipe composes *interactively* —
any two commands, wherever `-q` hands the next one the value it wants — and it
is the documented shell idiom. `--domain` exists because a pipeline is the
wrong shape for CI: a workflow `run:` block is `bash -e` **without**
`pipefail`, so a pipeline reports the LAST command's status and a failed deploy
is masked by `domains set`'s own confusion — and a CI consumer needs the
deploy's full `--json`, which `-q` deliberately discards. One process, one exit
code, one JSON.

**With `--domain`, the answer is the DOMAIN**, because the domain is what the
user asked about: "deploy this *to www.example.com*" is a question about the
destination, and `domains.set()` has always carried the answer — the `Domain`
it returns holds the freshly linked deployment and the URL. So the composed
command renders through the `domain.set` row that already exists: **no new
type, no new response shape, no new formatter, no new output row.** The only
type-level edit the whole feature needed was `DeployCommandOptions.domain`.

Four consequences, each falling out rather than being arranged:

- `-q` prints the domain name, because the quiet channel prints the row's key
  and the row is `domain.set`'s.
- `--json` transmits the `DomainSetResult`, internals stripped, byte-identical
  to `ship domains set --json`.
- A new external domain gets the same first-link DNS enrichment, because
  `performDomainSet` is literally the same function `domains set` calls.
- **`ship ./dist -q` without the flag still prints the deployment id.** The
  pipe seed is untouched, forever, with a test pinning it.

**The flag chooses which command runs, not what one command does.** `runDeploy`
reads `--domain` ONCE and picks between two `withErrorHandling` pairs —
`deployOnly` under `{upload, deployment}` and `deployAndLink(domain)` under
`{set, domain}`. Identity and behaviour are therefore chosen together, from one
reading. The alternative shapes were both considered and are worse: a result
carrying an internal `_context` override would be **the response deciding the
output**, which is the exact thing `OUTPUTS` exists to forbid (see
"`formatOutput` Router"); a static action plus a separately-resolved context
branches on one condition in two places and lets the two answers disagree.

Two beats in the text channel, one sentence-writer. `announceStep` (exported
from `formatters.ts`) writes the deployment's own sentence the moment the
upload lands — streamed like the spinner, and load-bearing rather than
decorative: if the link then fails, the id the user has already paid for is on
screen. A beat is the **sentence alone**, in the **text channel alone**: the
details block belongs to the answer, and `--json` still has exactly one exit
while `-q` still prints exactly one key. `announce` stays private — this is a
second OCCASION for it, not a second writer.

**`--domain` refuses without a credential BEFORE it reads a file.** An
anonymous account cannot own a domain, so the invocation is unsatisfiable, and
discovering that after the upload would have minted a public, expiring,
claimable deployment as the side effect of a failed *authenticated* intent —
which the fail-closed anonymity invariant forbids. It asks `resolveCliToken`,
i.e. the credential the CLI RESOLVED, so a fourth source slots in there and
never here. The error is statusless `Config`, per "What a status means": no
exchange happened, so there is no HTTP status to report, and `Authentication`
would both carry a 401 for a request never made and hand the sentence to
`getUserMessage`'s generic auth arm — losing the one thing worth saying, which
is that it is `--domain` that needs the token. The remedy itself
(`CREDENTIAL_HINT` in `error-handling.ts`) is one fact with one owner, shared
with the auth message, because the device flow will change both at once.

A link failure is **not** rolled back: a deployed-but-unlinked site is a valid
platform state, and an idempotent re-run replays the deploy and simply links
again. **"Idempotent" is a condition, not a description of the default** — it
holds when `SHIP_IDEMPOTENCY_KEY` is set, which is the CI shape the flag exists
for (the GitHub Action derives one per workflow run). A bare shell retry has no
key, so it mints a SECOND deployment: valid, unlinked, and visible in the
account. Say so when advising a retry.

**The fold rule, so the next composed command inherits it rather than
re-deriving it: on failure, `--json` stays the verbatim error envelope and
completed steps are text-only.** The machine channel never learns the
mid-command deployment id. That is not an oversight to fix later — it is the
one-JSON-exit law meeting the envelope-verbatim law, and either alternative
breaks one of them: a second document breaks the first, and a `partial` field
beside `error` breaks the second. The convergence story is idempotent replay,
not a richer error. Text is the channel that carries the progress, which is why
`announceStep` is text-only by construction.

**Recorded absences** (decisions, not gaps):

- **No SDK `domain` deploy option.** The SDK mirrors the wire 1:1
  (`resource.action()` per endpoint); composition is CLI grammar, exactly as
  DNS enrichment is CLI-only. An SDK consumer composes two typed calls.
- **No `SHIP_DOMAIN` env var.** The CLI-only env tier exists for values a
  subprocess wrapper cannot put on argv (secrets, ambient keys). A domain rides
  argv fine.
- **No domain prevalidation before the upload.** Parity with the verb it
  names: `domains set` does not prevalidate either. The API refuses at link
  time with its own message, and the idempotent replay makes the retry cheap.
  The credential preflight above is different in kind — it prevents a *wrong
  deploy*, not a wrong link.

**Deferred mechanisms, each with the condition that ends the deferral.** The
estate's stopping rule governs all four — machinery earns existence at the
SECOND holder, not the first — so these are recorded here rather than built,
and the next composition lands born-here instead of re-arguing the design.

| Deferred mechanism | Builds when | What it replaces |
|---|---|---|
| **Identity as a dispatcher contract** — `withErrorHandling` accepts `OutputContext \| (input) => OutputContext`, resolves once, hands the result to the handler | The **second** command whose identity depends on its invocation | `runDeploy`'s hand-rolled dispatch and the comment defending it |
| **Dispatcher-owned step emission** — the handler gets an `emit` capability; channels become folds (text renders steps, `--json`/`-q` ignore them), tested once at the fold | The **second** command that announces a mid-command beat | The exported `announceStep` and its per-command channel discipline |
| **A composition/plan shape** | The **second** composed command | Nothing yet — `deployAndLink` as a plain async function is the right altitude for one |
| **A command table above Commander** | A consumer that needs identity or requirements to be *enumerable* — none exists; the tree already serves completions, help, both fences, and scoped usage | Nothing — the tree IS the table today |
| **An ordered TABLE for `getUserMessage`** — (predicate, renderer) rows with a completeness tie, the `SHAPES` / `FILE_RULES` move | The **third** ordering TIE in that chain. It has two (auth-before-client, timeout-before-network), both fenced by tests that turn red on a reorder | The if/else chain and the two tie notes above it. Deliberately not built now: those tables exist to delete a SECOND statement of one fact — `SHAPES` had two chains that drifted, `FILE_RULES` one rule read three ways — and this chain has ONE reader, so a table would move code without removing a restatement |
| **Hand-rolled ambient-config validation**, retiring `zod` from `dependencies` | Someone is paying for the dependency — a consumer install size complaint, or the third field on `CREDENTIAL_FIELDS` | zod's entire runtime footprint here: three imports over TWO fields (`apiUrl`, `token`), where `z.string().url()` is a weaker restatement of the constitution's `validateApiUrl`. Not free, though: `.strict()` is what makes `.shiprc` refuse unknown keys, and `Object.keys(CREDENTIAL_FIELDS)` is what the config wizard rebuilds the file from, so the replacement owes a key list plus a parse that reports which field failed. A change to the published dependency CONTRACT belongs in its own wave, never as a rider. (The live gap that audit surfaced was separable and is fixed — see "One rule, every source" below.) |

**Considered and declined outright**, so it is not rediscovered: a cross-repo
existence fence for `web/docs`' CLI page. The rename-drift class it would catch
is already owned by the prose fence's retired-spellings list, and a true
existence check would need ship's command tree executed from another repo's CI
— disproportionate machinery for a covered risk.

### Table Output

- **3 spaces** between columns (matches ps, kubectl, docker)
- Headers are dimmed; property names can be remapped via `headerMap`
- Property order matches API response exactly
- `INTERNAL_FIELDS` list (`['isCreate', 'claim']`) is filtered from table/details output — `claim` renders through the claim CTA instead, and deliberately stays in `--json` output so scripts can read it

### `processOptions` Helper

Always call `processOptions(this)` inside action handlers — not `program.opts()`. It converts Commander's `--no-color` (which sets `color: false`) to the `noColor: true` convention used throughout.

### `performDeploy` Helper

Shared deploy logic used by both `ship <path>` shortcut and `ship deployments upload`. Handles: path existence/type validation, the deploy options (labels, password, `--no-path-detect`, `--no-spa-detect`), AbortController for Ctrl+C, and a spinner (TTY only, suppressed in `--json` and `--no-color` modes).

It takes `(client, deployPath, options)` and nothing else: every deploy flag
reaches it through Commander's own merge, so there is no per-flag plumbing and
no source to arbitrate between (see "Two flag tiers").

**The two spellings register the SAME action function.** `runDeploy` is what
`.action()` receives on both, and both take their flags from one
`withDeployOptions(cmd)`, so the flag set and the behaviour cannot drift
between them — there is nothing to keep in step. `runDeploy` then reads
`--domain` and dispatches to `deployOnly` or `deployAndLink(domain)`; see
"Composability" for why the flag picks a command rather than modifying one.

`performDomainSet` is its counterpart on the domain side: everything
`ship domains set` does once its own grammar has produced arguments. The stdin
fallback and the label merge stay in that command — they are how it reads a
request, not how it links — and what is left is shared with the `--domain` arm,
so both spellings link identically by construction.

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
same discriminants, same order, nothing tying them — and it shipped a bug:
`tokens get`/`tokens delete` printed NOTHING under `-q` (the quiet chain had
a branch for the collection, none for a single token). A row cannot
half-exist now; resolution order is a property of the list. `SHAPES` is
**exported for the suite**, and that tie is load-bearing:
`tests/node/cli/formatters.unit.test.ts` pins a hand-written case per row,
then asserts its own list deep-equals `SHAPES.map(s => s.on)` — without that
line the completeness check counted the test's own array and was a tautology
(caught in review, 2026-07-30). Asserting the mapped list also makes the two
order ties above enforced rather than trusted to this paragraph. A fence must
quantify over PRODUCTION and pin expectations by hand; both sides
hand-written is a mirror.

A shape with no row falls through to `formatDetails`, deliberately — a future
`GET /labels` shows its content on the first run rather than needing a
formatter first.

A deletion short-circuits ahead of the table **in text mode only**, composing
its sentence from the acknowledgement; in `--json` it falls through to the one
JSON exit, and in `-q` the quiet branch above the table has already printed the
key.

### DNS Enrichment on Domain Create

When `ship domains set <name> [deployment]` creates a new external domain (`isCreate: true`, name contains `.`), the CLI fetches `domains.records()` and `domains.share()` in parallel, attaching results as `_dnsRecords` and `_shareHash` on the result for the formatter to display. This is CLI-only behavior; SDK resources return plain data.

### Retries

The CLI's own 5xx message says "try again". The client now takes its own
advice before handing that sentence to a person. `executeRequest` is the loop
and `attemptOnce` is one request — the same single wrap point that already
owned headers, the timeout signal, the events and error normalization, so an
attempt is a whole request and nothing has to be undone between two.

**Retried:** anything where nothing was exchanged — `Network` (a refused
connection, a DNS failure) and `Timeout` (a deadline of ours expired) — and
500/502/503/504. Two retries by default, so three attempts, with full
jitter — `random() * min(2s, 300ms * 2^n)`. Jitter matters more than the
curve: it is what stops a platform hiccup from returning every client at once.

**The first two are read through `isNetworkError()`, the CATEGORY, and not
named individually.** "Nothing was exchanged" IS the retryability criterion,
so a future member should inherit this answer rather than wait for someone to
remember the line — and naming `Timeout` beside a guard that already contains
it would be a second owner of that membership, free to disagree with the
first. `@shipstatic/types` owns it (`ERROR_CATEGORIES.network`); what holds
the decision here is the http-timeout suite's "and is RETRIED", which turns
red the moment a deadline leaves the category.

**Not retried, each a decision rather than an omission:**

- **A maintenance 503.** A state, not a fault: its message says when to come
  back, and retrying it three times only delays that sentence reaching the
  person who needs it. Same STATUS as the retryable 503, which is exactly why
  the check reads the TYPE — and why that test is the load-bearing one.
- **429.** The platform's rate limiter has just answered; a client that
  auto-retries is arguing with it. Revisit only alongside honoring
  `Retry-After`, as its own decision.
- **`PUT` / `DELETE`.** Semantically idempotent here and excluded anyway: a
  DELETE whose response was lost answers 404 on the retry, turning a success
  into a reported failure.
- **Any other non-`GET` without an `Idempotency-Key`.** With the key a deploy
  replays its stored 201, so the repeat is safe by construction rather than by
  assumption.
- **Anything the CALLER's signal stopped.** The subtle one, and the reason the
  check reads `options.signal.aborted` rather than only the error type: a
  caller's `AbortSignal.timeout()` classifies as `Timeout`, exactly like our
  own ceiling, which this loop retries on purpose — so on the error alone the
  caller's deadline would look retryable and be silently outlived. **That
  check carries the invariant alone**; nothing else in `isRetryable` can tell
  whose clock ran out, which is what makes "does not retry past a caller's own
  deadline" the load-bearing test in `http-retry`.

**Which required teaching the composed signal to say which deadline fired.**
`createTimeoutSignal` aborted bare, so the SDK's own timeout, a caller's abort
and a caller's `AbortSignal.timeout()` all arrived as `AbortError` and all
classified as `Cancelled` — "you cancelled this" for a deadline nobody set by
hand. An abort REASON survives fetch's rejection verbatim (captured across
Node, Bun and the three engines), so each keeps its identity: ours is a
`TimeoutError` naming the ceiling, the caller's is forwarded untouched. The
same change removes the abort listener on cleanup, which was harmless when
there was one attempt and a leak that grows once there are three.

**Events stay honest, and `error` still means what it always meant.** The
first cut of this tier made `request` and `error` fire per ATTEMPT. Honest
about what happened — and it silently redefined `error`: before retries, an
error-event count equalled failed CALLS; after, a consumer saw
`error, error, response` and could not tell "failed, retrying" from "failed,
terminally" at any prefix. That is a semantic change to an event every
existing consumer already had a handler for.

So the vocabulary gained a word instead. `request` stays per attempt (a
request truly went out). A failed attempt that will be tried again emits
**`retry`**, carrying the same normalized `ShipError`, the URL, and the
attempt number. `error` is terminal and fires exactly once per failed call —
including a mid-backoff abort, which ends the call. `response` fires once, on
the attempt that worked. Nothing is hidden and nothing is ambiguous:
`retry* (error | response)`.

Corrected on the beta channel in `2.2.0-beta.7`, two prereleases after the
shape it replaces (`beta.5`, `beta.6`). The tests asserting three `error`
events were pinning that shape, and were rewritten rather than relaxed.

**Surface:** `maxRetries` on `ShipClientOptions`, `0` disables. One knob, the
name Stripe and OpenAI use, which by this file's own doc-placement rule is
what earns it public README surface. No env var and **no CLI flag** (recorded
absence — the CLI rides the default; add a flag the day someone asks).

No `tests/contract.ts` rows: retry is client POLICY, not a wire fact. The API
is not promising to fail twice.

### Ephemeral deployments (`--ttl`)

**The platform was already asking how long a deployment lives; the request may
now answer it.** The API's entitlement answered from IDENTITY (anonymous → 3
days, authenticated → forever) and the orchestrator stamped that verbatim; a
requested `ttl` overrides only the authenticated `null`. This half of the
feature is deliberately thin — when the wire owns the fact, the SDK mirrors it
1:1 and the CLI declares one flag into machinery that already knows what to do
with it.

- **SDK:** `deploy(path, { ttl })` in SECONDS, validated at the request
  boundary by `validateTtl` from `@shipstatic/types` beside `validatePassword`
  and `validateLabels`, appended as `DEPLOY_FIELDS.TTL`. A duration, never an
  instant: the server owns time.
- **CLI:** `--ttl <duration>` on `withDeployOptions`, so the flag law supplies
  both spellings, the misapplication refusal, and the completions with no
  further code.
- **One parser, two commands.** `parseTtl` accepts bare seconds or `<n><unit>`
  (`s`/`m`/`h`/`d`), and `tokens create --ttl` moved onto it — one word, one
  grammar, everywhere. The parser owns the SPELLING and nothing else;
  `validateTtl` owns the RANGE, which is what makes the refusal identical from
  the CLI, the SDK and the API. The wire only ever carries a number.
- **`ttlOf` reads the EFFECTIVE options, and that is load-bearing.**
  `tokens create` declared `--ttl` alone and correctly read `cmdOptions.ttl`
  until 2026-08-12. The moment the deploy shortcut — which IS the program —
  declared the same flag, Commander's root began consuming it and that read
  went silently undefined: every `ship tokens create --ttl 1h` would have
  minted a permanent token. One helper, one source, for both commands. See
  "Two flag tiers".

**Two preflights, both before a byte is read**, and they are the two deploy
flags that promise something past the upload:

- **No credential → statusless `Config`** carrying `CREDENTIAL_HINT`, the
  `--domain` arm's shape verbatim. An anonymous deployment already expires on
  the platform's schedule, and discovering the refusal after the upload would
  have minted a public, expiring, claimable deployment as the side effect of a
  failed authenticated intent.
- **With `--domain` → statusless `Validation`.** A domain is a commitment and
  a deadline is its opposite; the API refuses to link any deployment with a
  non-null `expires`, so the combination cannot succeed and the only question
  is whether the user pays for an upload first.

**Rendering needed nothing.** `formatValue` already humanizes `expires`
through `formatTimestamp`, so the details block shows the expiry with zero new
code. The claim CTA's *relative* phrase ("expires in 3 days") is gated on
`claim`, which a credentialed ttl deploy never carries — reusing it would have
ADDED a second duration phrase rather than sharing one.

**Recorded absences** (decisions, not gaps):

- **No `SHIP_TTL` env var.** The CLI-only env tier exists for values a
  subprocess wrapper cannot put on argv (secrets, ambient keys). A duration
  rides argv fine — the `SHIP_DOMAIN` precedent.
- **No ttl mutation.** A deployment is an immutable artifact with labels as
  its only mutable annotation. To keep something longer, redeploy; deploys are
  cheap and idempotent replay makes them cheaper. The claim flow remains the
  only writer of `expires` after create.
- **No ttl on `domains set`** — a link is not a lease.
- **Idempotent replay returns the stored 201's original `expires`.** The
  stored answer is the answer; a replayed request's ttl is not consulted.
**A CLIENT is a fixture too.** The anonymous refusal has a `tests/contract.ts`
row with a LIVE half, and getting there corrected a reading: "a runner supplies
one client" sounded structural and was not — a credential-less `Ship` is
exactly the kind of thing the context already guarantees, so it sits beside the
ids. The live half is the point, since only it can catch the API dropping the
guard, and one `if` in the orchestrator is all that holds a coherence rule the
platform designed deliberately (the claim window is pinned to the anonymous
lifetime). It costs one slot of the anonymous issuance budget per run, recorded
in the row so several e2e runs in an hour read as a budget, not a contract.

That fixture also hardened the suite: `tests/setup-e2e.ts` now scrubs
`SHIP_TOKEN`, because the SDK reads it and a developer with one exported would
have run the whole live suite as that account — and made the anonymous fixture
quietly authenticated, turning a refusal row into a pass.

**And a fence limitation worth knowing.** The docs contract asks whether a
flag NAME is taught, not whether each command teaching is present — `--ttl`
was already documented for `tokens create`, so the fence stayed green when the
deploy gained it. It is not the first catch this flag was expected to be, and
a per-command check would need the docs to name commands beside flags, which
they do not. The deploy docs were written deliberately instead.

### The bundle boundary

**What this package bundles and what it asks a consumer to install is one
line, and it is fenced in three directions** (`tests/package/bundle-boundary.test.ts`,
an artifact tier — it reads the BUILT bytes, because what a bundle requires is
a property of the bytes and not of the config that produced them):

1. `dist/cli.cjs` requires **nothing beyond node builtins**;
2. every bare specifier the SDK entries require is a declared dependency;
3. every declared dependency is reached by some entry — the direction that
   catches rot;
   plus the config half: every tsup external names a declared dependency.

`dependencies` is now the SDK's five — `zod`, `spark-md5`, `junk`,
`formdata-node`, `form-data-encoder`. The CLI's four (`commander`,
`columnify`, `yocto-spinner`, `yoctocolors`) are devDependencies bundled into
`dist/cli.cjs`, so an embedded SDK consumer — the MCP, and through it the
vscode `.vsix` — no longer installs four packages it never executes, and an
`npx @shipstatic/ship` cold-run no longer downloads them.

The list had rotted in BOTH directions before the fence existed: `tsup.config.ts`
named `cosmiconfig` and `cli-table3` as externals for two majors after both
were deleted with 2.0, and aliased a build shim for a package that no longer
existed (`build-shims/empty.cjs` STAYS — it shims node builtins for the browser
bundle). Nothing was wrong at runtime, which is exactly why it survived: a dead
external is invisible until someone reads the file.

**And the fence carries its own counterexample, which it runs every time.**
The hand drill meant to prove this one planted NOTHING, twice (2026-08-12): a
grep matched the dead external's name in a *comment* rather than the array,
and on the second try biome collapsed the array back. Both times the suite
stayed green and the fence was one step from being reported as proven. **A
hand drill is evidence that evaporates** — nobody reading a green suite later
can see it happened — so the three checks are now functions of their inputs
(specifier list, declared dependencies, externals), and a `the checks can see
a defect` block feeds each one a synthetic defect of its own class and asserts
it is NAMED: an escaped specifier, a dead external spelled `cosmiconfig` and
`cli-table3`, an unreached dependency. Each row also passes a clean input, so
a check that "caught" everything would fail too, and a fourth row proves the
extractor sees real bytes at all — `dist/cli.cjs` being empty is an assertion
here, so an extractor that always returned `[]` would satisfy the fence's
headline check and every direction under it.

Synthetic rather than planted, deliberately: a plant has to survive a
formatter, a grep and a reviewer, and this one survived none of them. This is
the transport wave's planted-impossible-input applied to a check instead of a
runtime — and it generalizes. `docs-contract`'s taught-ness matcher got the
one-line version of the same treatment (`isTaught('--flag-that-cannot-exist')`
must answer `false`), because a matcher answering `true` for everything makes
"every flag is taught" unfailable while reading exactly as it does now. The
file-rules table needs neither: its completeness tie is structural — the
test's own list is asserted deep-equal to the production table, in order — so
a second plant there would be ceremony.

**Bundling carries licence obligations, so the notices ship.**
`scripts/third-party-licenses.cjs` writes `THIRD-PARTY-LICENSES.md` at build
time, and the list is **derived from esbuild's metafile** rather than written
down — transitive dependencies included, which a hand list misses on day one
(five of the fifteen are transitive). A bundled package whose notice cannot be
found fails the build. It does not read `require.resolve('pkg/package.json')`:
a modern `exports` map does not expose it, which fails for exactly the packages
most likely to be bundled.

The spinner keeps its dynamic `import()`. Bundled, that no longer defers a
package install, but it still defers evaluating the module on the runs that
never show a spinner (`--json`, `-q`, non-TTY), which is most CI runs.

**Out of scope, recorded so it is not folded in:** replacing
`formdata-node`/`form-data-encoder` with Node ≥20's native `FormData` is an SDK
behaviour change with its own compatibility questions — a separate decision,
not a bundling detail.

### Two flag tiers, and one place each is read

**Global flags** — `--token`, `--config`, `--api-url`, `--json`, `-q/--quiet`,
`--no-color` (plus Commander's `-h`/`-V`). Identity and channel: they mean the
same thing on every command and parse anywhere. **Command-owned flags** —
everything else. `GLOBAL_FLAGS` in `index.ts` is the whole statement; the
command-owned set is its complement, so a flag joins the law by being declared
and there is no second list to keep in step.

**A flag parses only where it means something.** The deploy shortcut IS the
program, so its flags (`--domain`, `--label`, `--password`, the two `--no-…`
detections) must be declared at program level — and Commander then recognises
them in front of every other command, where nothing reads them.
`ship --domain www.x.com domains list` parsed cleanly and dropped the domain;
the user who typed it believed they had linked one. Silent-swallow is the worst
of the three possible answers. `assertFlagsApply` (the `preAction` hook, beside
the token/URL validation) now refuses before any action runs: a command-owned
flag that was actually TYPED must be declared by the command about to run. It
names the flag and — read from the tree, never restated — the commands that own
it. Statusless `Validation`, per "What a status means".

Two mechanical points, both load-bearing:

- **Presence comes from the SOURCE, not the value.** `getOptionValueSource(key)
  === 'cli'`. `--label` defaults to `[]` and `--no-path-detect` to `true`, so a
  truthiness test would refuse every subcommand always.
- **POSITION is deliberately not part of the law.** `ship --label x deployments
  upload ./dist` is honoured. Commander stores it identically to the canonical
  spelling, so telling the two apart means scanning raw argv beside the parser
  — a second parser, refused on the same grounds as a second copy of the
  command tree. The defect worth money was misapplication, and that is closed.

**One rule, every source — the API URL.** `validateApiUrl` ran only in the
`preAction` hook, which sees the FLAG and nothing else. So one value got two
verdicts by how it arrived: `ship --api-url https://api.example.com/v1` was
refused with the constitution's authored sentence, while the same value saved
into `.shiprc` or exported as `SHIP_API_URL` was accepted and produced
transport failures on every command afterwards — with nothing connecting the
symptom to the cause. Measured against the real binary, all three sources,
before the fix.

**The sources reach one verdict where they become one value**, so the check
sits in `createClient` after `mergeCliConfig`. The `preAction` check stays: it
is the flag's fast-fail and a better moment to fail. Two call sites of one
rule at two tiers is the dual-validation idiom, not a second statement — the
rule has one owner, `@shipstatic/types`.

**CLI TIER ONLY, deliberately.** The `Ship` constructor stays loose because an
embedded consumer may legitimately pass an unroutable `apiUrl` — a Cloudflare
service binding dispatches by binding identity, so `apiUrl: 'https://api'` is
correct there and is documented in the README. This is the CLI deciding what a
person may write in a config file, which is a different question.

Fenced in `create-client.unit.test.ts` rather than through the CLI harness,
for a mechanical reason worth knowing: **the harness injects
`--api-url <mock server>` into every invocation that does not carry one**, and
a flag beats both other sources by design — so no harness-driven test can ever
exercise the file or env path. That is also why the gap survived a suite with
a dedicated file for parse-time URL checks.

**And one place each flag is read.** Commander's root consumes any option the
ROOT declares, wherever it sits in argv — so a deploy flag typed *after*
`deployments upload` still lands on the program, and that subcommand's own
declaration (which exists so its `--help` and its completions are accurate)
never receives a value. Hence:

- A flag declared ONLY on its command (`--limit`, `--cursor`, `--ttl`) arrives
  in that action's own `cmdOptions`.
- A flag the program declares too arrives in the EFFECTIVE options —
  `processOptions(command)` → `optsWithGlobals()`, parent winning — which is
  what every handler already receives as `options` (`EffectiveOptions`).

Read one place per tier; never arbitrate between them. Three helpers
(`mergeLabelOption` / `mergePasswordOption` / `mergeDomainOption`) and four
call sites did that arbitration by hand until 2026-08-12, and they were not
belt-and-braces — they were the ONLY thing making `ship deployments upload
./dist --label x` work, which is why the merge cannot simply be deleted in
favour of `cmdOptions`. What survives is `labelsOf` (the `--label ''` clearing
rule) and `passwordOf` (the `SHIP_PASSWORD` tier), each reading one source.

`EffectiveOptions` is **wider than any one command's truth** — `domains set`
receives a type carrying `domain` and `password` — and that is recorded rather
than fixed. It is unreachable, not merely unset: the guard refuses such a flag
before the handler exists. Narrowing per command (`GlobalOptions &
LabelOptions` at each site) was rejected because it would be a second statement
of that command's flag set with nothing checking it against the `.option()`
calls — the restatement class this file removes everywhere else.

**The owner list in the refusal includes the SHORTCUT.** `ownersOf` walks from
the command it is given, so the program is surveyed too, and `pathOf` renders
the root from its own `registeredArguments` (`ship <path>`). Skipping it was
the first version's defect, and a self-contradicting one: `assertFlagsApply`
exempts the program *because* it owns these flags, while the survey ten lines
down could not say so — sending the reader to `ship deployments upload` when
`ship <path> --domain …` is the spelling every doc leads with.

Required Commander boilerplate is unchanged: `.enablePositionalOptions()` on
parent groups, `.passThroughOptions()` on subcommands taking a positional
followed by flags.

**The bug this law was written over.** `--no-path-detect` and `--no-spa-detect`
were declared as `noPathDetect` / `noSpaDetect` and read under those names —
but Commander stores the POSITIVE key for a `--no-x` flag, defaulted `true`. So
both flags parsed cleanly and did **nothing**, in both deploy spellings, for as
long as they have existed. The test that let it live asserted `exitCode === 0`,
which a dead flag also produces. They are fenced now through `config` — the
API sets it from a `ship.json` at the deploy ROOT and the mock derives it the
same way, so `--no-spa-detect` (the SDK appends no generated config) and
`--no-path-detect` (a nested `dist/ship.json` never reaches the root) are both
visible through a wire field rather than through a probe. Fixtures:
`tests/fixtures/spa-site`, `tests/fixtures/nested-site`.

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
| `src/shared/api/http.ts` | `http`, `http-anonymous`, `http-browser`, `http-domains`, `http-events`, `http-rate-limit`, `http-retry`, `http-timeout`, `http-tokens` | The HTTP client is the SDK's widest surface. `http.test.ts` is the transport anchor (stubbed `fetch`); the rest drive a real `Ship` against the wire-truth handler, one resource family or one cross-cutting concern each. |
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
- `getUserMessage(err, context, options)` — maps a `ShipError` to an actionable user-facing CLI string (auth → credential hints, timeout → the deadline sentence verbatim, network → connectivity, maintenance → the operator's sentence + where to watch, client/4xx → trust the API message, 5xx → generic "try again"). **Text channel only.**

  The timeout arm sits AHEAD of the network one and branches on the TYPE,
  because the two share a category — `isNetworkError()` is true for both, and
  rightly so: nothing was exchanged either way. Until 2026-08-12 there was no
  type to branch on and the network arm claimed it, so a deploy that hit its
  five-minute ceiling — the slowest, most expensive failure this CLI produces
  — told the user to check their Wi-Fi. `--json` was truthful throughout; only
  the human channel lied. The arm relays `fromFetchError`'s own sentence and
  appends nothing: "try again" belongs to the 5xx arm, which has nothing
  better to say, and it is half-false here because the client has already
  tried three times.

  The maintenance arm sits between network and client for a reason: a closed
  platform is neither the caller's fault nor a transport failure nor a server
  fault, and each neighbouring arm would mis-serve it. It relays the sentence
  and appends the status URL but **never "try again"** — that advice belongs to
  the 5xx arm, which has nothing better to say, whereas a maintenance message
  states when. See root `plan-maintenance-mode.md`.

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
| `SHIP_IDEMPOTENCY_KEY` | The SDK's `idempotencyKey` for `ship deploy` / `ship deployments upload` — a stored 201 replays instead of deploying twice (see the Backend Integration table). Empty string is normalized to absence, for the same reason `SHIP_PASSWORD` is: an unset CI variable must not collapse every deploy in a job into one replay. There is **no flag** — this is the whole CLI surface, and it exists for the integrations that wrap the CLI as a subprocess: the GitHub Action derives one key per workflow run, so re-running a job replays the original deployment rather than creating a second one. A shell user's `--idempotency-key` remains the open product call below. |
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

**`/limits` is also how the platform's extension blocklist reaches the client.**
`PlatformLimits.blockedExtensions` is the API's list (`cloudflare/api/src/lib/blocklist.ts`);
`validateFiles` and both file pipelines read it and refuse nothing the platform
did not name. The field is **optional and the absence is a contract**: an API
predating it sends none, which means "no client-side check", never "an empty
policy" — the deploy proceeds and the API refuses the file at the boundary,
which is where refusal belongs. Never restore a compiled-in copy: `@shipstatic/types`
is a devDependency **bundled into dist**, so a constant here is baked into every
published tarball and a user on an old `ship` would enforce a policy the platform
has moved on from, in both directions. Fenced by the `getLimits` row in
`tests/contract.ts` — the live half is the only thing in this repo that can see
the API drop the field.

**One rule, one sentence, two renderers — done 2026-08-12.**
`src/shared/lib/file-rules.ts` is the ordered table of (predicate, sentence)
rows over (file, limits): the `SHAPES`-table move (see "`formatOutput` Router")
applied to validation. `firstBrokenRule` is the single evaluation, and the two
renderers choose only how to DELIVER it — `validateDeployFile` throws the first
broken rule (both deploy pipelines), `validateFiles` records it (the UI tier).
Neither authors prose.

It closed a real divergence: one size rule read three ways —
`File ${path} is too large. Maximum allowed size is ${n}MB.` (the pipelines),
`File size (…) exceeds limit of …` (`validateFiles`), and
`File too large. Maximum ${n} bytes allowed` (the API) — against the
dual-validation doctrine that an error reads the same wherever it is caught. It
also made **node/browser pipeline parity structural**: both pipelines call the
same renderer, so the comment reading "matches Node validation" has nothing
left to be wrong about.

Wording follows the API where a choice existed, so the deferred promotion has
less to move, with two recorded deviations: sizes are FORMATTED rather than raw
bytes (a browser UI showing `20971520 bytes` is worse for the person reading
it, and the unit is the smaller half to reconcile), and the PATH is named (the
API has none to name; the throwing renderer has nothing but the message). The
total-size rule names the deploy — `(N files)` — rather than blaming whichever
file tipped it, matching the file-count rule beside it.

Scope held deliberately: `validateDeployPath` stays out (a rule about the
deploy PATH, not the file, and pipelines-only), as do `validateFiles`' UI
pre-checks — empty, negative, count, unbuilt marker, processing error — which
have one holder each and no drift to close.

Fenced in `tests/shared/lib/file-rules.unit.test.ts`: every sentence pinned by
a hand-written row, with the completeness TIE asserting the test's own list
deep-equals the production table in order (without that line the check counts
itself — the tautology this estate has on record). Both drilled: a reworded
sentence and a renamed row each turn it red.

**Phase B is deferred with its trigger.** Promoting the table into
`@shipstatic/types` with the API consuming it: after Phase A the sentence has
two independent holders — ship's table and the API's copies — with silent
drift, so by the constellation stopping rule it likely QUALIFIES. It is a
types+api convoy with its own blast radius, and it builds when someone is
paying for that drift. Recorded beside the other deferred mechanisms rather
than started: beginning it here would have doubled this tier for a coherence
win nobody is waiting on.

## Backend Integration

| SDK Method | API Endpoint | Notes |
|------------|--------------|-------|
| `deployments.upload()` | `POST /deployments` | Multipart upload |
| ↳ `idempotencyKey` | header `Idempotency-Key` | Replays the original 201 within 24h instead of deploying twice. Key the ATTEMPT (run id, commit sha), never the try. |
| ↳ CLI `--domain` | *(no endpoint)* | Composed CLIENT-side: this upload, then `domains.set()` with the fresh id. Two wire calls, no new route, no SDK option — see "Composability". |
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
| `getLimits()` | `GET /limits` | Cached after init. Carries the plan caps **and** `blockedExtensions` — the platform's hosting blocklist, optional (an older API sends none) |
| (internal) | `POST /spa-check` | SPA detection during upload — optional auth, anonymous callers allowed |
| (internal) | `POST /upload` | Only via the `@internal` `deployEndpoint` option (`web/my`, `web/www`) |

**Deploys get their own timeout ceilings — three budgets, one per kind of work.** 30s is right for a metadata read, where anything slower is a fault rather than a payload. A deploy is bounded by the platform instead: `DEPLOYMENT.MAX_TOTAL_SIZE` is 50MB, and 50MB in 30s needs ~13 Mbit/s of sustained UPLOAD — above most residential links — so a deployment the API permits was being aborted client-side, which is exactly the failure `Idempotency-Key` repairs. `DEFAULT_DEPLOY_TIMEOUT` is 5 minutes (50MB at ~1.4 Mbit/s).

A **build or prerender** deploy is the third: it waits for work the SERVER does after the upload lands, so `DEFAULT_DEPLOY_BUILD_TIMEOUT` is **derived, not chosen** — written in code as `DEFAULT_DEPLOY_TIMEOUT + BUILD_SERVICE_BUDGET`, so tuning either half carries. Raising that server constant must raise this one; they sit in different repos so nothing fences the pair, and the constraint is stated at both ends. `spa` does NOT qualify: it is local detection bounded by the AI tier's own 10s; only build/prerender reach the build service.

**Only the DEFAULTS split by operation** — an explicit `timeout` option governs every request including deploys: a caller who names a ceiling asked for a ceiling, not for one with an exception.

**And since retries landed, that ceiling is per ATTEMPT.** The sentence above
was written when one call meant one request, and it has to be reconciled
rather than quietly contradicted: each attempt is an honest request and
deserves the ceiling the caller named, while `maxRetries` is the lever on how
many there may be. A caller who wants a hard WALL-CLOCK deadline passes their
own `signal` (`AbortSignal.timeout(ms)`) — and that works precisely because
the loop never retries past a signal the caller supplied. See "Retries" below. The correct long-term instrument is an **idle timeout** — reset on progress, the only formulation independent of payload size — blocked on upload-progress observation, which browser `fetch` cannot provide. Build it when someone wants a progress bar; the timeout falls out of that work for free.

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

*Open product questions (awaiting a call):* `GET /labels` (a real endpoint with no SDK method —
a CLI user would plausibly want it), and an `--idempotency-key` CLI flag.
The SDK half of that second one **shipped**: `deploy()` takes
`idempotencyKey`, validates it through `validateIdempotencyKey`, and sends
the header (see the Backend Integration table). This paragraph
claimed "the SDK/CLI never send the header" until 2026-07-30, which was
true when written and stale thereafter. Neither item is drift, and neither
should be added without the call.

**The FLAG is still open; the env var is not.** `SHIP_IDEMPOTENCY_KEY`
landed 2026-08-07 (see "CLI-only env vars") because the two audiences are
different and only one of them was blocked. A subprocess-wrapping
integration has no other channel at all — it composes an argv it does not
own and cannot reach a per-call SDK option — and the GitHub Action is that
consumer, deriving a key per workflow run so a re-run replays. A shell user
already has one (`SHIP_IDEMPOTENCY_KEY=… ship ./dist`), which is why the
flag stays a product call rather than a gap: it would be a second way to
say what the tier already says, and the reason to add it is ergonomics for
humans, not reach. (List pagination, formerly in this list, shipped
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
