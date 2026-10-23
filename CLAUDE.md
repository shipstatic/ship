# CLAUDE.md

Claude Code instructions for the **Ship SDK & CLI** package.

**@shipstatic/ship** is the universal SDK and CLI for ShipStatic: a
`resource.action()` API, identical in Node.js and the browser.
**Maturity:** stable; semver applies, so a breaking change needs a major
version. **The pre-launch exception:** until the platform has external
consumers, a change to a published type rides a minor under the same
exception `@shipstatic/types` records beside its additive-evolution law, and
the release notes name it.

**Releasing.** Work on `development`. Bump `version` in `package.json` and
push: a prerelease (`-` suffix) publishes to `beta` (from either branch, normally `development`), a
stable version to `latest` from `main`. A version already on the registry is a
no-op. A version relying on new API behaviour merges to `main` only once that
API is on production. Keep `ci.yml`'s filename: it is half of the npm
trusted-publisher registration.

## Architecture

```
src/
├── shared/              # Cross-platform code (most of the package)
│   ├── api/http.ts      # The transport: headers, retries, timeout, events
│   ├── base-ship.ts     # Base Ship class (credential slot, resources, top-level calls)
│   ├── resources.ts     # Resource factories: every endpoint, stated once
│   ├── types.ts         # Internal SDK types
│   ├── core/            # constants, credential schema, deploy body, request planner, file pipeline
│   └── lib/             # Utilities (validation, junk filtering, MD5)
├── browser/             # Browser Ship class + the `webkitRelativePath` read
└── node/
    ├── core/config.ts       # readEnvConfig: SHIP_* env-var resolution (no filesystem)
    ├── core/node-files.ts   # the filesystem walk (the pipeline itself is shared)
    └── cli/
        ├── bin.ts           # THE EXECUTABLE (dist/cli.cjs), the only file with side effects
        ├── index.ts         # Commander.js command tree + withErrorHandling + performDeploy
        ├── create-client.ts # Credential precedence (flag → env → file) → Ship instance
        ├── shiprc.ts        # ~/.shiprc + --config reader (strict JSON), CLI ONLY
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
renderer read it.

**The SDK has no filesystem dependency.** Its only ambient credential source
is `SHIP_*` env vars. File config (`~/.shiprc`, or a `--config` path) lives
entirely in `cli/shiprc.ts`, which is what makes `new Ship({})` safe in
embedded hosts (MCP, the GitHub Action): it never reads the host's
`~/.shiprc`. The n8n node is not an SDK consumer: n8n Cloud verification
requires zero runtime dependencies, so it speaks HTTP directly.

## Quick Reference

```bash
pnpm test --run              # unit + integration (e2e and browser are NOT in the default run)
pnpm test:unit --run         # pure functions only
pnpm test:integration --run  # SDK/CLI against the mock server
pnpm test:browser            # capability tier: real Chromium via playwright (CI runs it)
pnpm test:e2e --run          # REAL API; refuses to load without SHIP_E2E_API_KEY
pnpm coverage                # the suite + the ratchet: what CI runs
pnpm typecheck               # tsc over src, tests and tests-browser (tsconfig.check.json)
pnpm check:package           # publint + attw over the built artifact
pnpm build                   # all bundles
```

### Key Files

The tree above names the main `src/` files. Beside them:

| File | Purpose |
|------|---------|
| `src/node/cli/shiprc.ts` | `loadShipFile` / `parseShipFile`: the strict-JSON reader for `~/.shiprc` and `--config` (CLI only). No repository file is ever read |
| `src/node/cli/utils.ts` | Output primitives (`success`, `error`, `warn`, `info`, `formatTable`, `formatDetails`) |
| `tests/fixtures/builders.ts` | Typed fixture builders, the only fixture source |
| `tests/mocks/handler.ts` | The mock API: one Web-standard handler, wire-cited per route |
| `tests/contract.ts` | The wire facts the SDK depends on, stated once, run against the mock and the real API |
| `tests/architecture/` | Suite-time fences (integrity, naming, docs contract, SDK/CLI parity) |

## Comments state the rule; history lives in git

**A comment in code states the rule, the mechanism and the non-obvious
constraint** (`this`-binding, registration order, why a cast is safe), and
where useful it points at a section here. This file states rules and their
reasons in the present tense too. Dates, bug archaeology and "it used to be X"
belong in commit messages, where `git log` and `git blame` keep them beside the
change.

## Core Patterns

### Ship Class Public Surface (base-ship.ts)

```typescript
// Resources: every collection the SDK reaches. `/activities` is deliberately
// not among them (see "Routes the API exposes that the SDK does not reach").
ship.deployments / ship.domains / ship.account / ship.tokens

// Convenience shortcuts
ship.deploy(input, options?)   // → deployments.upload()
ship.whoami()                  // → account.get()

// Top-level
ship.ping()                    // returns PingResponse ({ timestamp })
ship.getLimits()               // returns PlatformLimits (asks the server every time)
ship.setToken(token)           // any platform token, or a TokenProvider
ship.setHeaders(headers)       // global headers on every request (lowest priority)
ship.clearHeaders()
ship.on(event, handler)
ship.off(event, handler)
```

Deploy options are `signal` (the one cancellation mechanism), `pathDetect`,
and the wire options from `DeploymentUploadOptions` (`labels`, `via`,
`password`, `ttl`, `spaDetect`, `idempotencyKey`, and the `@internal` flags).
**Refused per-deploy options:**

- `timeout`: a request ceiling is a client concern (`ShipClientOptions.timeout`).
- `onProgress`: fetch has no upload-progress events to report honestly.
- `onCancel`: `signal` already covers cancellation.
- `maxConcurrency`: a deploy's requests go one after another (a declaration,
  then a fill per batch), so there is nothing to parallelize.

### One layer: the resources ARE the endpoints

**`resources.ts` states WHICH request; `api/http.ts` carries it.** A resource
method is its endpoint (path, verb, body, response type) and hands that to a
narrow `Transport` (`request`, `requestWithStatus`, plus the deploy's
carriage). Nothing above that line knows the base URL, the credential, the
retry policy or the event vocabulary; nothing below knows what a domain is.
`ApiHttp` has no endpoint table and no API vocabulary.

**Resource vocabulary never moves into the transport.** The public grouping is
the `*Resource` interfaces' business, and those live in `@shipstatic/types`.

- **`request` takes a PATH, not a URL.** The base is the transport's, so no
  call site assembles `${apiUrl}${API_PATHS.X}` by hand.
- **The deploy's carriage is the transport's** (`Transport['deploy']`): the
  endpoint (a client option may redirect it to `/upload`) and the two
  ceilings. The NUMBERS are the transport's; the CHOICE between them is the
  resource's, because only it knows that `build`/`prerender` wait on server
  work after the upload lands and `spa` does not.

### Resource Factory Pattern

Resources are factory functions that receive a `ResourceContext` (`getApi`, a
thunk resolving the `Transport`) instead of the whole Ship instance, so a
factory depends only on what it uses. The deployment resource also receives
`processInput`.

### HTTP Client Architecture

Every request flows through `executeRequest` in `src/shared/api/http.ts`,
which owns header merging, the timeout, retries, events and error mapping.
`request<T>()` returns data; `requestWithStatus<T>()` returns `{ data, status }`
for the one operation where the status IS the answer (domain upsert: 201 means
`isCreate: true`).

- **Every path parameter is `encodeURIComponent()`-ed.** The SDK does not
  validate identifiers, so this is the whole client-side defence against a
  hostile name forging a sub-route. `resources-paths.test.ts` quantifies over
  every resource method that takes one, because one method forgetting it is
  the whole defect class.
- **Optional arrays:** test `labels !== undefined`, never `labels?.length`, so
  "not provided" and "empty" stay distinct.
- **Internal request options are `ShipRequestInit`**, whose `headers` is
  narrowed to a plain record (see "Retries").

**Transport injection (`fetch`).** `ShipClientOptions.fetch` replaces the
function used for every outbound call (default: `globalThis.fetch`, captured
at construction). Any `fetch`-compatible function works: a service-binding
`Fetcher`, a tracing wrapper, a test mock. Everything downstream works on
standard `Request`/`Response`, so an injected fetcher inherits it all.

**Events: every failure is visible, and the event NAME says whether it ended
the call.**

```typescript
ship.on('request', (url, init) => ...);          // once per ATTEMPT
ship.on('retry', (error, url, attempt) => ...);  // that attempt failed; another is coming
ship.on('response', (response, url) => ...);     // the call succeeded
ship.on('error', (error, url) => ...);           // the call failed, terminally
```

One call emits `retry* (error | response)`, so the stream is unambiguous at
every prefix. `error` fires exactly once per failed call (a mid-backoff abort
included) and `response` once, on the attempt that worked. The failure events
are emitted by `executeRequest`, not `attemptOnce`: terminality is a property
of the loop, so an attempt cannot name its own failure. `attempt` counts from
1, so attempt N failing IS retry N.

### Authentication Flow

The constructor is synchronous: the credential and the HTTP client are formed
from constructor args, with `SHIP_TOKEN` / `SHIP_API_URL` filling gaps in
Node. Nothing is deferred and nothing is held.

**One credential slot.** `token` carries any platform token (`ship-` API key,
`deploy-` deploy token, `oauth-` OAuth access token), sent verbatim as
`Authorization: Bearer <value>`. The server classifies with the same
`classifyToken` (`@shipstatic/types`) the SDK uses for boundary validation, so
a new token population needs no SDK change. A bearer with no known prefix
still rides the slot; the server refuses it. A `TokenProvider` function in
the same slot supplies the token per request: minting and refresh live with
the caller. `session: true` is the cookie-session identity for first-party
browser apps; `token` + `session` together is a config error. **There is no
credential precedence anywhere in the SDK**: one slot makes multiplicity
inexpressible.

**Token resolution (Node, in order):** the constructor argument, then
`SHIP_TOKEN` (plus `SHIP_API_URL`). That is the whole SDK contract.
`~/.shiprc` and `--config` are CLI-only, so the SDK cannot leak a developer's
dotfile credential into an anonymous public deploy. The single env var
follows the one-token idiom (`GITHUB_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`).
Browser `Ship` has no ambient source at all.

**Lifetime dominance: storage must not outlive the credential.** A dotfile is
indefinite, so `.shiprc` holds durable tokens. An env var lives as long as the
process, so `SHIP_TOKEN` holds what its provisioner keeps fresh (a short-lived
token per CI run is correct). A constructor argument or provider lives per
request, which is where hourly OAuth bearers belong.

**Fail-closed anonymity: anonymity requires proven absence of credentials.**
An anonymous deploy carries no `Authorization` header; the API grants the
agent identity per request (`AuthMethod.AGENT`, a claim URL and an expiry on
the response), and the SDK has no agent-token machinery. A credential that is
present but expired, malformed or rejected fails the request with a typed
error; it never demotes a deploy to an anonymous public one. `''` (an unset CI
variable expanded by the shell) is absence and falls through to the next
source; a configured provider yielding nothing is broken intent and throws.

#### Strict-isolation contract for embedded hosts

The env-var fallback is **the** SDK contract, with no programmatic opt-out (no
`envFallback: false`, no `token: null` sentinel).

- **Hosts that pass credentials explicitly** (the MCP forwarding its configured
  token to `new Ship({ token })`) get what they expect: explicit args win.
- **Hosts that need strict isolation** (a multi-tenant runner where the
  deployer's identity must never reach a customer's deployment) scrub
  `SHIP_TOKEN` from the process, or run the SDK in a sub-process with a clean
  env. The SDK trusts the env it sees.

An opt-out flag is refused: embedded consumers would forget to set it and leak
silently. Credential isolation is a process-level concern, and a
non-overridable env read keeps it there.

#### The device-flow future

The CLI's recorded future for delegated auth is the OAuth device flow. The
refresh token is the durable credential (OS keychain or `.shiprc` are
permitted); the access tokens it mints are short-lived and ride a
`TokenProvider`, never a dotfile or an env var. The provider is already the
public contract, so the device flow adds no SDK surface, and its spelling joins
`CREDENTIAL_HINT`.

### Cross-Platform File Input

`DeployInput` is `File[] | string | string[]`. Each platform's `deploy()`
narrows to its shape; anything else throws at runtime.

```typescript
// Node: file/directory paths; directories walked recursively
ship.deploy('./dist');
ship.deploy(['./dist/index.html', './dist/app']);

// Browser: File[] (from <input type="file"> or drag-and-drop)
ship.deploy(Array.from(fileInput.files));
```

`FileList` is not accepted directly (the check is `Array.isArray(input) &&
input.every(item => item instanceof File)`); convert with `Array.from`.
`StaticFile` (`{path, content, md5, size}`) is an internal pipeline shape, not
a public input. In the browser the SDK takes a file's path from
`webkitRelativePath`, falling back to `name`.

### One deploy pipeline, two collectors

**Only the FINDING is platform-shaped.** Node walks a filesystem; a browser is
handed `File` objects. Everything after (optimize the paths, drop the junk,
refuse what the deploy rules refuse, checksum what survives) is one sequence
in `shared/core/deploy-files.ts`; `node-files.ts` and `browser-files.ts` are
only collectors.

**The seam is `DeploySource`: a path, a size and a `read()`.** `size` sits
beside `read()`, filled in Node from the `statSync` the walk already makes, so
every deploy rule is judged before the first read: a refused deploy opens no
file, because no rule reads more than a path and a size. The pipeline's tests
use synthetic sources, needing no disk and no browser.

Two asymmetries are by design:

- **Only Node pre-checks `UNBUILT_PROJECT_MARKERS` on input directories.** A
  Node user can type a repository root, where the walk would enumerate
  `node_modules`; refusing before the walk is the cheapest moment. The junk
  filter would refuse the same mistake one step later.
- **Only browser callers set `build`/`prerender`** (see "Server-Processed
  Uploads"). The mode is read from the shared options; who sets it is the
  asymmetry.

**What the junk filter does and does not do.** It filters a site's junk and
judges nothing: a project's files (`node_modules`, `package.json`) are kept,
even under pnpm's `node_modules/.pnpm/`, so the `project` rule refuses them by
name. A `..` segment is dot-prefixed, so it is filtered rather than refused.

### A deploy larger than one request

**A deploy is declared, then filled; a deploy that fits one request is the
case where the declaration carries everything.** `deployments.upload` always
builds the manifest (`deployManifest`: every file by path, size and MD5) and
the declaration's fields (`deployFields`, in one fixed order), and asks the
planner (`shared/core/deploy-plan.ts`) how to send them:

- **Everything fits:** one request carrying every file, answered 201.
- **It does not:** a bare declaration (the manifest, the options, the root
  `ship.json`, which the API compiles at the declaration, and the root
  `index.html`) answered 202 pending, then one
  `POST /deployments/:deployment/files` per batch. The first 201 or 200 is
  the deployment; a 202 after the last batch is refused, since the client
  cannot resolve it.

**The planner counts; it never measures.** Each part is its bytes, plus its
name as the body carries it, plus `PART_OVERHEAD`, and one more
`PART_OVERHEAD` closes the body. Text values count line breaks as CRLF and
filenames count their escaped quote, CR and LF (the HTML standard's multipart
rules), so the count is a ceiling on what any runtime's `FormData` emits, and
a 413 on a planned request means the arithmetic is wrong. `bodyBytes` is the
one count; `deploy-plan.test.ts` holds it against a real `FormData` on Node and
Chromium, and two rows hold the value and name counts EXACTLY by the runtime's
own byte difference between two bodies. **The recorded break:** a CLI older
than 3.7 sending a request between 64 and 100 MiB meets a 413 whose sentence
names the update.

**Abort does nothing, by design.** Ctrl+C or a caller's signal stops the
sending, and the platform's sweep reclaims the pending deployment after its
window; until then it holds one slot of the plan's cap. No
`DELETE` is sent: the CLI exits before cleanup could run, a deploy token
cannot delete, and a `DELETE` after a lost final response would delete a site
that had just gone live. A fill answering 404 ("This upload was cancelled or
timed out. Deploy again.") ends the deploy, and the SDK never redeclares on its
own.

### Server-Processed Uploads (Build/Prerender)

With `build` or `prerender` set on `DeploymentUploadOptions`, the server
builds:

- **`processDeployFiles` carries a project's source as given.** Which files a
  project holds is decided before the SDK sees them, by `@shipstatic/drop`'s
  `projectSource`, so this path takes nothing away: no junk filter (a build
  reads `.npmrc` and `.vitepress/`), no empty-file skip (an empty module a
  build imports is source), and none of the deploy rules, which describe a
  build's OUTPUT. It still checksums. `filterJunk` judges a site's files only,
  so it takes no option.
- **A build or prerender never splits.** The planner refuses a project over
  one request before a byte is sent (`BUILD_TOO_LARGE`), reading the flags from
  the declaration's own fields, so what it plans is what is sent.
- **`deployFields`** appends `build=true` / `prerender=true`.

These are `@internal` flags, set only by the platform's own browser apps
through `/upload`. Node has no such caller (and its unbuilt-marker precheck
would refuse a project folder anyway). External clients deploy through
`/deployments`, which builds nothing. `captcha` is the same tier: a
first-party uploader's proof, appended as a form field. Every other anonymous
deploy is the credential-less `/deployments` path, which needs no proof.

## CLI Patterns

### Output Conventions

| Type | Text format | JSON format | Quiet (`-q`) format |
|------|------------|-------------|---------------------|
| Success message | green text | `{ "success": "..." }` | none |
| Data (single) | key-value pairs | raw JSON object | key identifier only |
| Data (list) | table | raw JSON object | one identifier per line |
| Void/ping | success/error text | `{ "success": "..." }` | no output (exit code) |
| Error | `[error]` prefix, red | `ErrorResponse` (see below) | stderr (unchanged) |

**Text translates, JSON transmits.** The three message envelopes (`success`,
`warning`, `info`) have no wire counterpart, so they are CLI-shaped
`{ kind: message }`. Errors do, and `--json` emits it verbatim:
`ShipError.toResponse()`, so `error` names the `ErrorType`, `message` carries
the wire's sentence and `status` the HTTP status. Clients branch on `error`
and `status`, never on the sentence. Only text mode gets `getUserMessage`'s
actionable rewording ("pass --token, set SHIP_TOKEN, or run ship config").

Two things hold it: `error()` in `utils.ts` is **overloaded** so a bare string
is accepted only for the text channel (an untyped failure has no wire shape,
so writing one into `--json` is a compile error), and
`tests/node/cli/json-errors.test.ts` asserts the envelope across every
producer (the global boundary, Commander's parser, `handleUnknownSubcommand`,
the `preAction` validator, transport failure).

- Text messages open lowercase (identifiers, paths and acronyms survive) and
  lose their final period: `plainMessage` in `utils.ts` is that typography.
- Internal fields (`isCreate`, `_dnsRecords`, `_shareUrl`) are stripped from
  JSON output.
- `[error]`/`[warning]`/`[info]` prefixes use inverse colour in a TTY.

### Deletions answer with an acknowledgement

A deletion is not void: the wire answers with the resource noun carrying its
canonical key, plus the resource's own state field where the state changed
(`DeploymentDeleteResponse` in `@shipstatic/types`). It carries no `message`
on purpose (an acknowledgement is data, and each surface composes its own
copy), so the CLI writes the sentence. **Quiet** prints the key, **`--json`**
transmits the shape through the one JSON exit in `formatOutput`, and **text**
alone composes copy.

**The tense is the response's.** `DELETE /deployments/:deployment` answers 202
with `status: 'deleting'`, and the files stay served until the platform's
cleanup finishes, so text says
`<host> deployment deleting — served until cleanup completes`. A hard delete
(`{domain}`, `{token}`) says `deleted`, because the row is gone. The gate is the
transitional-state MAP in `formatters.ts` (`IN_FLIGHT`), never the presence of
a `status`: `Deployment` and `Domain` carry statuses of their own, so keying on
presence would print "www.example.com domain pending". An unrecognised state
reads as done.

**The identifier is the response's, never the request's.** A deployment is
addressable by bare slug and answers with its hostname; a domain is accepted in
any case and answers normalized. `OutputContext` carries no caller argument, so
a sentence composed from input is inexpressible, and
`tests/node/cli/json-acknowledgements.test.ts` asserts every deletion's
envelope, including byte-identical output for deleting by slug and by hostname.

### What a status means

`ErrorResponse.status` is documented as "HTTP status code (API contexts)": a
fact about an exchange. So the question is **"what would the wire say?"**:

- **A check that mirrors a server rule keeps the status the server would
  send.** Blocked extensions, label rules, password length, token format and
  the size and count caps are validated on both sides from the same rules, so
  the error reads the same wherever it is caught: `ShipError.validation(...)`
  with its 400. "The same rules" means imported OR delivered: the extension
  blocklist arrives in `PlatformLimits.blockedExtensions` and mirrors the
  server no less for it.
- **A fault with no server rule to mirror carries no status**, and so one of
  the client-only types: `Network`, `Cancelled`, `File`, `Config`, the
  statusless factories in `@shipstatic/types`. Your shell, your dotfile and
  this binary's grammar have no API opinion, so a 400 there would be a
  plausible lie, which survives review better than an obvious one.

`completion.ts` is the worked example: an fs call that threw is `file`,
everything else there is about the user's shell setup, so `config`. CLI
grammar errors go through `usageError()` in `index.ts`: `Validation`, no
status. A failed local file read in `md5.ts` is `ShipError.file` with the path
in `details`.

**Assertions are a third category, and the rule does not govern them.**
"processFilesForNode can only be called in Node.js environment" guards a state
a correct caller cannot reach, so its type and status are no contract. Leave
them.

**Local commands throw; they never report.** `completion` and `config` make no
request, so neither uses `withErrorHandling` (it builds a `Ship`). Each action
wraps its call and hands anything thrown to `handleError`, which gives a local
failure the same writer and the same non-zero exit as every other.
`handleError` resolves the credential only for the auth branch, so a local
failure never reads `.shiprc` to render its message.

### One grammar: `<key> <noun> <verb>`, and one function

`announce(result, context)` in `formatters.ts` composes **every** sentence the
CLI makes about a mutation, from what the command IS (`OutputContext`) and
what the wire ANSWERED:

```
<canonical key> <resource noun> <past tense, or the wire's own state>
```

The key is read from the NOUN (`result[noun]`), so `.url` is unreachable; word
order belongs to the function; the state override applies everywhere, so an
operation that becomes asynchronous updates its own sentence. No formatter
writes a template. `ACKNOWLEDGING` (`delete`, `verify`) names the mutations
whose response is an acknowledgement, with no entity to render beneath the
sentence.

`announce` has **two occasions, one writer**: `formatOutput` calls it for the
answer, and `announceStep` calls it mid-command for the first beat of a
composed one (`ship <path> --domain <name>`). `announceStep` is the only
export; `announce` stays private, because a second exported sentence-maker is
how grammars multiply.

```
mock-deploy-001.shipstatic.com deployment uploaded
www.example.com domain created            (…updated)
tok0001 token created
www.example.com domain verification queued
www.example.com domain deleted
brave-otter-a1b2c3d.shipstatic.com deployment deleting — served until cleanup completes
www.example.com domain is valid
```

**The key, never the URL.** A URL is a field of the resource, printed on its
own row in the details block, so opening with it would make text disagree with
`-q` and `--json`. The `it.each` table in
`tests/node/cli/formatters.unit.test.ts` ("one grammar") asserts every composed
sentence starts with its fixture's key.

**Reports render, mutations announce.** A report answers a question, so it
prints its answer (`records` a table, `dns` and `share` a details block,
`validate` its verdict, `ping` the words `api reachable`); only a mutation gets
a success sentence.

**A verdict is not a failure.** `domains validate` on an invalid name writes
the reason to **stdout** and sets exit 1. The exit code is the machine answer
(`ship domains validate x && …`), but the call succeeded, as the SDK and
`--json` agree. It names no subject, because `normalized` is null when invalid
and the CLI never falls back to the caller's argument.

**Shell completions are RENDERED from the tree, not shipped.**
`renderCompletion(program, shell)` emits bash/zsh/fish, and
`ship completion install` writes what it renders then, so an installed
completion always matches its binary. `tests/node/cli/completions.test.ts`
quantifies over the whole tree; the smoke tier installs through the real
binary and runs `bash -n` / `zsh -n` / `fish --no-execute`, since only a real
shell can say the output parses.

**The last hand-written copy of the command tree is gone: scoped usage is
derived too.** `handleUnknownSubcommand` reads `this.name()` and
`subcommandsOf(this)`: no arguments, no closure. `tests/node/cli/unknown-commands.test.ts`
quantifies over `buildProgram()`. The printed list is REGISTRATION order, the
same as `--help` and the completions; the front page keeps its own.

**The front page may curate, but not forget.** `helpText()` is hand-written
and byte-pinned, so leaving a command off is legitimate, provided the omission
is recorded in `HELP_OMISSIONS` (`tests/architecture/docs-contract.test.ts`)
with its reason (`account get` is recorded: `ship whoami` is the same read and
the spelling the page shows).

**`-q` prints the key for every shape that has one.** The one exception is
`tokens create -q`, which emits the **secret**: it is shown once and never
again, so `ship tokens create -q >> .env` is why that channel exists there. It
is checked before the `token` branch, since a creation response carries both.

### No repository file is ever read

`.shiprc` resolution is **two locations**: `~/.shiprc`, or the path `--config`
names. There is no project-level search (`./.shiprc`, `package.json` `"ship"`,
walking up from the cwd), and none may be added: its only capability is a
repository-controlled file supplying credentials or an API URL, so a cloned
repo could redirect the user's token or deploy to the repo owner's account.
Every field of such a surface is equally untrustworthy, so the refusal is of
the surface, never of one field. `--config <file>` reads any path as given.

**Format: strict JSON.** The wizard writes JSON and the docs show JSON; YAML is
not accepted. An **empty file is an absent config**, not a broken one (`touch
~/.shiprc` and an interrupted write both produce one). The wizard `chmod`s
`~/.shiprc` to 0600.

### One file, two commands, one idea of what it is

`ship config` is the only WRITER of the file `shiprc.ts` is the only READER
of, and **the schema is the file.** `CREDENTIAL_FIELDS` is `.strict()`: `token`
and `apiUrl` are the only fields a `.shiprc` may hold.

- **The writer rebuilds** the file from `Object.keys(CREDENTIAL_FIELDS)`
  rather than mutating what it read, so dropping a rejected key (an old
  `apiKey`) IS the repair the reader's hint promises, announced rather than
  silent.
- **The writer refuses what it cannot parse** (`ErrorType.Config`, the file
  left unchanged): a file it cannot read is a file whose contents it cannot
  claim to preserve.
- **The FORMAT is shared outright.** `readExistingConfig` calls the reader's
  own `parseShipFile`. One parse, two policies: the reader rejects, the writer
  repairs what the reader rejects. `tests/node/cli/config.test.ts` runs both
  over the same content and compares their verdicts per file.

### Composability

`-q` outputs only the key identifier, the value to pipe forward.
`domains set` reads the deployment from stdin when piped.

```bash
ship ./dist -q | ship domains set www.example.com
ship ./dist --domain www.example.com          # the same two calls, one command
```

**Both spellings are product; neither replaces the other.** The pipe composes
interactively and is the documented shell idiom. `--domain` exists because a
pipeline is the wrong shape for CI: a workflow `run:` block is `bash -e`
**without** `pipefail`, so a failed deploy is masked by the last command's
status, and a CI consumer needs the deploy's full `--json`, which `-q`
discards. One process, one exit code, one JSON.

**With `--domain`, the answer is the DOMAIN**, because the destination is what
the user asked about, and the `Domain` that `domains.set()` returns already
holds the linked deployment and the URL. So the composed command renders
through the existing `domain.set` row: no new type, response shape, formatter
or output row.

- `-q` prints the domain name; `--json` transmits the `DomainSetResult`,
  byte-identical to `ship domains set --json`.
- A new external domain gets the same first-link DNS enrichment, because
  `performDomainSet` is the function `domains set` calls.
- **`ship ./dist -q` without the flag prints the deployment id, forever**, with
  a test pinning it.

**The flag chooses which command runs, not what one command does.** `runDeploy`
reads `--domain` ONCE and picks between two `withErrorHandling` pairs:
`deployOnly` under `{upload, deployment}` and `deployAndLink(domain)` under
`{set, domain}`, so identity and behaviour come from one reading. Refused
alternatives: a result carrying an internal `_context` override (the response
deciding the output, which `OUTPUTS` exists to forbid), and a static action
with a separately resolved context (one condition branched in two places).

**Two beats in text, one sentence-writer.** `announceStep` writes the
deployment's sentence the moment the upload lands, so if the link then fails
the id is on screen. A beat is the sentence alone, in the text channel alone:
`--json` keeps one exit and `-q` one key.

**`--domain` refuses without a credential BEFORE it reads a file.** An
anonymous account cannot own a domain, and finding out after the upload would
mint a public, expiring deployment as the side effect of a failed
authenticated intent, which fail-closed anonymity forbids. It asks
`resolveCliToken` (the credential the CLI resolved), so a fourth credential
source slots in there and never here, and the error is
statusless `Config`: no exchange happened, and `Authentication` would carry a
401 for a request never made and lose the point that `--domain` needs the
token. The remedy, `CREDENTIAL_HINT` in `error-handling.ts`, is one fact shared
with the auth message.

**A link failure is not rolled back**: a deployed-but-unlinked site is a valid
state. **"Idempotent" is a condition**: a re-run replays the deploy only when
`SHIP_IDEMPOTENCY_KEY` is set (the GitHub Action derives one per workflow
run). A bare shell retry mints a SECOND deployment, valid and unlinked. Say so
when advising a retry.

**The fold rule: on failure, `--json` stays the verbatim error envelope, and
completed steps are text-only.** The machine channel never learns the
mid-command deployment id. A second JSON document would break the one-exit
law; a `partial` field beside `error` would break the verbatim-envelope law.
The recovery is idempotent replay, not a richer error.

**Recorded absences** (decisions, not gaps):

- **No SDK `domain` deploy option.** The SDK mirrors the wire one method per
  endpoint; composition is CLI grammar, like DNS enrichment. An SDK consumer
  composes two typed calls.
- **No `SHIP_DOMAIN` env var.** The CLI-only env tier is for values a
  subprocess wrapper cannot put on argv (secrets, ambient keys).
- **No domain prevalidation before the upload**, matching `domains set`. The
  API refuses at link time, and replay makes the retry cheap. The credential
  preflight differs in kind: it prevents a wrong deploy, not a wrong link.

**Machinery not built until a second holder exists** (the condition that
builds each):

- **Identity as a dispatcher contract** (`withErrorHandling` taking
  `OutputContext | (input) => OutputContext`): a second command whose identity
  depends on its invocation.
- **Dispatcher-owned step emission** (an `emit` capability; channels as
  folds): a second command with a mid-command beat.
- **A composition/plan shape:** a second composed command.
- **A command table above Commander:** a consumer needing identity or
  requirements to be enumerable; the tree already serves every reader.
- **An ordered table for `getUserMessage`:** a third ordering tie (two exist,
  auth before client and timeout before network, fenced in
  `error-handling.unit.test.ts`); with one reader a table removes nothing.
- **Hand-rolled ambient-config validation, retiring `zod`:** someone paying
  for the dependency (an install-size complaint) or a third field on
  `CREDENTIAL_FIELDS`. `z.string().url()` is already a weaker restatement of
  the constitution's `validateApiUrl`. The replacement owes `.strict()`'s unknown-key refusal
  and the key list the wizard rebuilds from, and a change to the published
  dependency contract ships on its own, never as a rider.

**Refused:** a cross-repo existence fence for the docs site's CLI page. The
rename class it would catch is covered by the platform's prose fence, and a
true existence check would run this command tree from another repo's CI.

### Table Output

- **3 spaces** between columns (like ps, kubectl, docker).
- Trailing spaces are trimmed from rows, because columnify pads every cell.
  NUL bytes are not scrubbed: columnify emits none.
- Headers are dimmed; property names can be remapped via `headerMap`.
- Property order matches the API response.
- `INTERNAL_FIELDS` (`['isCreate', 'claim']`) is filtered from table and
  details output. `claim` renders through the claim CTA instead, and stays in
  `--json` so scripts can read it.

### `processOptions` Helper

Always call `processOptions(this)` inside action handlers, never
`program.opts()`. It converts Commander's `--no-color` (`color: false`) to the
`noColor: true` convention used throughout.

### `performDeploy` Helper

Shared deploy logic for `ship <path>` and `ship deployments upload`: path
existence and type checks, the deploy options, an AbortController for Ctrl+C,
and a spinner (TTY only, suppressed under `--json` and `--no-color`). It takes
`(client, deployPath, options)` and nothing else; every deploy flag reaches it
through Commander's own merge.

**The two spellings register the SAME action function.** `runDeploy` is what
`.action()` receives on both, and both take their flags from one
`withDeployOptions(cmd)`, so flags and behaviour cannot drift between them.
`performDomainSet` is the domain-side counterpart: everything
`ship domains set` does once its grammar has produced arguments. The stdin
fallback and the label merge stay in that command, because they are how it
reads a request, so both spellings link identically.

The spinner keeps its dynamic `import()`: bundled, it no longer defers an
install, but it still skips evaluating the module on runs that never show it
(`--json`, `-q`, non-TTY), which is most CI runs.

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
**union types**: `operation` selects behaviour (`PAST_TENSE`, `ACKNOWLEDGING`)
and `resource` names the response field carrying the identifier, so a typo is
a compile error rather than a command that silently announces nothing.
`resource` is lowercase because it IS the field name (`announce` reads
`result[resource]`).

It reaches `formatOutput` and **nothing else**: the error path relays the
wire's message, which already names the resource. It carries **no positional
argument**: the arguments are the request, and every sentence is composed from
the response.

### `formatOutput` Router: one table, both channels

`SHAPES` in `formatters.ts` lists every response shape the CLI can receive, in
resolution order, each stated ONCE with what both channels need: the key `-q`
pipes forward, and the formatter text renders.

| Discriminant | `-q` emits | Text |
|---|---|---|
| `deployments` | one id per row | `formatDeploymentsList` |
| `domains` | one name per row | `formatDomainsList` |
| `tokens` | one id per row | `formatTokensList` |
| `records` | `<type> <name> <value>` per row | `formatDomainRecords` |
| `hash` | the setup URL | `formatDomainShare` |
| `dns` | the provider name, if resolved | `formatDomainDns` |
| `domain` | the name | `formatDomain` (plain or `EnrichedDomain`), with the standing's next step per `DOMAIN_NEXT_STEP` |
| `domain` (verify) | the name | `formatDomainVerify`: where to read the verdict, and the link step when nothing is linked. Not the standing's step |
| `deployment` | the id | `formatDeployment` |
| `secret` | the SECRET, shown once | `formatToken` |
| `token` | the id | `formatToken` |
| `email` | the address | `formatAccount` |
| `valid` | the normalized name, or nothing | `formatDomainValidate` |

Plus `(operation: 'ping')`, answered before the table: text says
`api reachable`, `--json` transmits `{ timestamp }`, `-q` says nothing.

**Order is load-bearing in two places, both ties:** `Domain` carries a
`deployment` field, so `domain` precedes `deployment`; a token creation carries
`token` and `secret`, so `secret` precedes `token`.

`SHAPES` is **exported for the suite**: `tests/node/cli/formatters.unit.test.ts`
pins a hand-written case per row, then asserts its own list deep-equals
`SHAPES.map(s => s.on)`, which also enforces both ties. **A fence quantifies
over PRODUCTION and pins expectations by hand**; both sides hand-written is a
mirror.

A shape with no row falls through to `formatDetails`, so a new response shape
shows its content on the first run. A deletion short-circuits ahead of the
table **in text mode only**; in `--json` it falls through to the one JSON exit,
and `-q`'s quiet branch has already printed the key.

### One step per standing

`Domain.status` is the domain's STANDING (`live`, `unlinked`, `unverified`,
`paused`), the one derived word saying what it needs from its owner; the DNS
fact sits beside it as `verification`. The CLI reads that word and derives
nothing. `DOMAIN_NEXT_STEP` in `formatters.ts` is a
`Record<DomainStatusType, (domain) => string | null>`, so a fifth standing
fails to compile at the one place that prints a step. `live` prints nothing.
`ship domains list` shows a `status` column; the deployments list does not,
because a listed deployment is nearly always `success`.

**`ship domains verify` does NOT print the standing**, by design. Its read
lands after the check is QUEUED and before it runs, so the standing is
`unverified` by construction, and printing that step would tell someone who
just configured DNS to configure DNS. It says only what a pending verdict
cannot change: whether anything will be served when it passes. Hence
`_deployment` on `EnrichedDomainVerify`, and the future-tense sentence ("once
it verifies, point it at a deployment").

**`INSTANT_FIELDS` is an allowlist, and its drift is silent.** `formatValue` in
`utils.ts` renders a unix-seconds field as a date only for listed key names,
since `links`, `files` and `size` are plain numbers on the same objects. A new
instant field in `@shipstatic/types` renders as `1785000000` with nothing
failing, so add it to `INSTANT_FIELDS` in the same change. (One holder is no
owner, so the list is not promoted into types.)

### DNS Enrichment on Domain Create

When `ship domains set <name> [deployment]` creates a new external domain
(`isCreate: true`, a name containing `.`), the CLI fetches `domains.records()`
and `domains.share()` in parallel and attaches `_dnsRecords` and `_shareUrl`
for the formatter. The share URL arrives finished from the API
(`DomainShareResponse.url`); the CLI never assembles one. CLI-only: SDK
resources return plain data.

### Retries

`executeRequest` is the loop and `attemptOnce` one request, the same wrap
point that owns headers, the timeout signal, events and error normalization,
so an attempt is a whole request and nothing is undone between two.

**Retried:** anything where nothing was exchanged (`Network`, `Timeout`) and
500/502/503/504. Two retries by default (three attempts), with full jitter,
`random() * min(2s, 300ms * 2^n)`; jitter is what stops a platform hiccup
returning every client at once. The first two are read through
`isNetworkError()`, the CATEGORY (`ERROR_CATEGORIES.network` in
`@shipstatic/types`), so a future member inherits the answer; the http-timeout
suite's "and is RETRIED" holds it.

**Not retried, each a decision:**

- **A maintenance 503.** A state, not a fault: its message says when to come
  back. Same status as a retryable 503, so the check reads the TYPE, and that
  test is the load-bearing one.
- **429.** The rate limiter has just answered. Revisit only together with
  honouring `Retry-After`.
- **`PUT` / `DELETE`.** A DELETE whose response was lost answers 404 on retry,
  turning a success into a reported failure.
- **Any other request its resource did not mark `idempotent`.** The deployment
  resource marks every fill (the API answers a repeat from the deployment) and
  a declaration carrying an `Idempotency-Key`. Everything else is sent once.
- **Anything the CALLER's signal stopped.** A caller's `AbortSignal.timeout()`
  classifies as `Timeout`, like the client's own ceiling, so the check reads
  `options.signal.aborted`. **That check alone carries the invariant**, and
  "does not retry past a caller's own deadline" in `http-retry.test.ts` is the
  load-bearing test.

**The composed signal says which deadline fired.** An abort REASON survives
fetch's rejection verbatim (Node, Bun and the three browser engines), so
`createTimeoutSignal` aborts with a `TimeoutError` naming the ceiling, and a
caller's reason is forwarded untouched. The abort listener is removed on
cleanup, since a leak grows with each attempt.

**The resource says what may be repeated; the transport never infers it.**
`ShipRequestInit.idempotent` is set by the resource that composed the request.
The transport's rule is one line, "GET, HEAD, or idempotent", reading no header
and matching no path, so a header nobody meant as a mark cannot make a request
retryable. The field is stripped before `fetch` sees the init. Fenced in
`http-retry.test.ts` ("the idempotent request option").

**Surface:** `maxRetries` on `ShipClientOptions`, `0` disables (the name Stripe
and OpenAI use, so it is public README surface). No env var and **no CLI flag**
(the CLI rides the default; add a flag when someone asks). No
`tests/contract.ts` rows: retry is client policy, not a wire fact.

### Ephemeral deployments (`--ttl`)

**The API decides a deployment's lifetime from identity (anonymous: 3 days;
authenticated: forever), and a requested `ttl` overrides only the
authenticated `null`.** The wire owns the fact, so the SDK mirrors it and the
CLI declares one flag.

- **SDK:** `deploy(path, { ttl })` in SECONDS, validated by `validateTtl` from
  `@shipstatic/types` beside `validatePassword` and `validateLabels`, appended
  as `DEPLOY_FIELDS.TTL`. A duration, never an instant: the server owns time.
- **CLI:** `--ttl <duration>` on `withDeployOptions`, so the flag law supplies
  both spellings, the misapplication refusal and the completions.
- **One parser, two commands.** `parseTtl` accepts bare seconds or `<n><unit>`
  (`s`/`m`/`h`/`d`) for deploys and `tokens create --ttl`. It owns the
  SPELLING; `validateTtl` owns the RANGE, so the refusal is identical from the
  CLI, the SDK and the API. The wire carries a number.
- **`ttlOf` reads the EFFECTIVE options.** The deploy shortcut IS the program
  and declares `--ttl`, so Commander's root consumes it wherever it is typed; a
  read of `cmdOptions.ttl` in `tokens create` would go silently undefined and
  mint a permanent token. See "Two flag tiers".

**Two preflights, both before a byte is read:**

- **No credential → statusless `Config`** carrying `CREDENTIAL_HINT`, the
  `--domain` arm's shape. An anonymous deployment already expires on the
  platform's schedule.
- **With `--domain` → statusless `Validation`.** The API refuses to link a
  deployment with a non-null `expires`, so the combination cannot succeed.

**Rendering needs nothing new**: `formatValue` humanizes `expires` through
`formatTimestamp`. The claim CTA's relative phrase is gated on `claim`, which a
credentialed ttl deploy never carries, and reusing it for `--ttl` would add a
second duration phrase rather than share one.

**Recorded absences:**

- **No `SHIP_TTL` env var.** A duration rides argv (the `SHIP_DOMAIN` precedent).
- **No ttl mutation.** A deployment is immutable with labels as its only
  mutable annotation; redeploy to keep something longer. The claim flow is the
  only writer of `expires` after create.
- **No ttl on `domains set`**: a link is not a lease.
- **A replay answers the deployment the key names, as it stands**, with the
  `expires` its commit stamped; the replayed request's ttl is not consulted.

### The bundle boundary

**What this package bundles and what it asks a consumer to install is one
line, fenced in three directions** by `tests/package/bundle-boundary.test.ts`,
an artifact tier that reads the BUILT bytes:

1. `dist/cli.cjs` requires nothing beyond Node builtins;
2. every bare specifier the SDK entries require is a declared dependency;
3. every declared dependency is reached by some entry (the direction that
   catches rot); plus every tsup external names a declared dependency.

`dependencies` is the SDK's three: `zod`, `spark-md5`, `junk`. The CLI's four
(`commander`, `columnify`, `yocto-spinner`, `yoctocolors`) are devDependencies
bundled into `dist/cli.cjs`, so an embedded SDK consumer installs nothing it
never executes. `build-shims/empty.cjs` shims Node builtins for the browser
bundle.

**A check is a function of its inputs, and it runs its own counterexamples.**
A hand drill is evidence that evaporates, so the three checks take their
inputs (specifier list, declared dependencies, externals) as arguments, and a
`the checks can see a defect` block feeds each a synthetic defect of its class
and asserts it is NAMED, plus a clean input, plus a row proving the extractor
sees real bytes. `docs-contract`'s matcher gets the one-line version:
`isTaught('--flag-that-cannot-exist')` must answer `false`. The deploy-rules
tables need no planted defect: their completeness ties are structural (the
test's own lists are asserted equal to the production tables in
`@shipstatic/types`, in order), so a plant there would be ceremony.

**Bundling carries licence obligations, so the notices ship.**
`scripts/third-party-licenses.cjs` writes `THIRD-PARTY-LICENSES.md` at build
time from esbuild's metafile (transitive dependencies included), and fails the
build for a bundled package whose notice it cannot find. It never reads
`require.resolve('pkg/package.json')`, which a modern `exports` map hides.

**One metafile per `(entry, format)`.** tsup names its metafile per format and
runs the three configs concurrently into one `outDir`, so shared names collide
and a surviving metafile can describe the wrong bundle. `tsup.config.ts` writes
one per entry and format via an `esbuildPlugins` hook into `build-meta/`,
outside `dist` (build telemetry, not product).
`tests/package/licence-coverage.test.ts` asserts every bundle the package
SHIPS (read from `package.json`'s `exports` and `bin`) is described by a
metafile, and the script makes the same check during the build: a missing
metafile names its bundle (`dist/index.cjs`), a corrupt one exits 1 with a
message instead of a stack, and a fourth entry is covered the day it ships.

**One deploy body, native `FormData`.** `shared/core/deploy-body.ts`'s
`createDeployBody` returns a bare `FormData`; `fetch` sets the boundary and
`Content-Type`. Node ≥ 20 has global `FormData`, `File` and a
multipart-encoding `fetch`, and Node 22 and Bun both keep
`filename="assets/nested/index.html"` intact, which is the contract: the
deploy PATH rides `File.name`. Tests read fields (`via`, the captcha proof)
back off the real `FormData` handed to `fetch`, never assert `append` calls.

### Two flag tiers, and one place each is read

**Global flags** (`--token`, `--config`, `--api-url`, `--json`, `-q/--quiet`,
`--no-color`, plus Commander's `-h`/`-V`) mean the same thing on every command
and parse anywhere. **Command-owned flags** are everything else. `GLOBAL_FLAGS`
in `index.ts` is the whole statement; the command-owned set is its complement,
so there is no second list.

**A flag parses only where it means something.** The deploy shortcut IS the
program, so its flags (`--domain`, `--label`, `--password`, `--ttl`, the two
`--no-…` detections) are declared at program level, where Commander would
accept them in front of any command that ignores them
(`ship --domain www.x.com domains list`). `assertFlagsApply` (the `preAction`
hook) refuses before any action runs: a command-owned flag that was TYPED must
be declared by the command about to run. It names the flag and, read from the
tree, the commands that own it (`ownersOf` surveys the program too, and
`pathOf` renders it as `ship <path>`). Statusless `Validation`.

- **Presence comes from the SOURCE, not the value**:
  `getOptionValueSource(key) === 'cli'`. `--label` defaults to `[]` and
  `--no-path-detect` to `true`, so a truthiness test would refuse everything.
- **POSITION is deliberately not part of the law.** `ship --label x
  deployments upload ./dist` is honoured; telling the spellings apart would
  need a second parser over raw argv, refused like a second copy of the tree.

**One rule, every source: the API URL.** `validateApiUrl` runs where the
sources become one value, in `createClient` after `mergeCliConfig`, so a bad
URL from a flag, `.shiprc` or `SHIP_API_URL` gets the same verdict. The
`preAction` check stays as the flag's fast-fail; two call sites of one rule
(owned by `@shipstatic/types`) is dual validation, not a restatement. **CLI
tier only**: the `Ship` constructor stays loose, because an embedded consumer
on a service binding may pass an unroutable `apiUrl: 'https://api'` (in the
README).

**The harness injects `--api-url <mock server>` into every invocation that
lacks one**, and a flag beats the other sources, so no harness-driven test can
reach the file or env path. Those paths are fenced in
`create-client.unit.test.ts`.

**One place each flag is read.** Commander's root consumes any option the ROOT
declares, wherever it sits in argv, so a subcommand's own declaration of the
same flag (kept for its `--help` and completions) never receives a value.

- A flag declared ONLY on its command (`--limit`, `--cursor`) arrives in that
  action's `cmdOptions`.
- A flag the program declares too arrives in the EFFECTIVE options
  (`processOptions(command)` → `optsWithGlobals()`, parent winning), which
  every handler receives as `options` (`EffectiveOptions`).

Read one place per tier; never arbitrate between them. `labelsOf` (the
`--label ''` clearing rule) and `passwordOf` (the `SHIP_PASSWORD` tier) each
read one source. `EffectiveOptions` is **wider than any one command's truth**
(`domains set` receives a type carrying `domain`), and that stays: the guard
makes such a flag unreachable, and narrowing per command would restate each
flag set with nothing checking it against the `.option()` calls.

**`--no-x` flags are read under their POSITIVE key**, defaulted `true`
(Commander stores `pathDetect`, not `noPathDetect`). A test asserting only
`exitCode === 0` cannot see a dead flag, so both detections are fenced through
a wire field: the API sets `config` from a `ship.json` at the deploy ROOT and
the mock derives it the same way, so `--no-spa-detect` (no `spa=true`, no
config) and `--no-path-detect` (a nested `dist/ship.json` never reaches the
root) are visible. Fixtures: `tests/fixtures/spa-site`,
`tests/fixtures/nested-site`.

Required Commander boilerplate: `.enablePositionalOptions()` on parent groups,
`.passThroughOptions()` on subcommands taking a positional followed by flags.

## SDK-Local Types

`DomainSetResult` is the published return shape of `domains.set()`: `Domain`
plus `isCreate` (201 vs 200). It lives in `@shipstatic/types` beside `Domain`,
so the resource interface matches the SDK's return value.

In `src/node/cli/types.ts`: `EnrichedDomain extends DomainSetResult` adds
optional `_dnsRecords` and `_shareUrl` for display. `EnrichedDomainVerify
extends DomainVerifyResponse` adds `_deployment`, the linked deployment read
once after the verify was queued (null when nothing is linked, absent when that
read failed); it carries the LINK fact, not the `status` (see "One step per
standing"). `CLIResult` is the union of all command outputs.

## Testing

| Pattern | Project | Mock server |
|---------|---------|-------------|
| `*.unit.test.ts` | `unit` | No |
| `*.test.ts` | `integration` | Yes, per file, ephemeral port |
| `tests-browser/*.test.ts` | `browser` | No: real Chromium, pure browser primitives |
| `*.e2e.test.ts` | `e2e` | No (a real API) |

**Every test tier is typechecked.** `pnpm typecheck` runs
`tsconfig.check.json` over `src`, `tests` and `tests-browser` together: vitest
transpiles through esbuild without checking types, and `e2e` and `browser` are
outside `pnpm test`, so typecheck is the only local gate reaching them. The
include list is "all of them", the only shape that cannot leave a tier where
deleting a module is silent.

### Hermeticity

`tests/setup.ts` loads for both in-process projects and enforces:

- **No ambient credentials**: every `SHIP_*` var is scrubbed at load, so an
  exported `SHIP_TOKEN` cannot authenticate the suite's anonymous paths.
- **No outbound network**: `fetch` is wrapped and THROWS, naming the URL, for
  any non-loopback host. `DEFAULT_API` is production, so a missing mock route
  would otherwise reach it.

The child-process CLI tier builds its environment from an **allowlist**
(`tests/node/cli/helpers.ts`): `PATH`, `TMPDIR`, a throwaway `HOME`,
`NO_COLOR`, `CI`, nothing else. A blocklist removes only what someone thought
of (`FORCE_COLOR=3` from a terminal turns exact-output tests red). `SHELL` is
absent too, so shell detection is a test input. The same file refuses to run
against a **stale `dist/`**, since those tests execute `dist/cli.cjs` and
`pnpm test` does not build. `tests/setup-e2e.ts` scrubs `SHIP_TOKEN` as well,
or the live suite would run as the developer's account and turn the anonymous
refusal row into a pass.

### The fences

`tests/architecture/` holds suite-time invariants, each catching a class the
others cannot:

| Fence | Catches |
|---|---|
| `test-integrity.test.ts` | A test file reaching NO production code (the tautology class, invisible to coverage). Reach resolves transitively through local test-support modules; importing only fixture builders does not count. Exceptions: the two artifact tiers (`smoke.test.ts`, `package/dist-entries.test.ts`), each with a reason |
| `test-naming.test.ts` | Layout drift: a filename describing the test instead of its subject, a mirror file with no `src/` counterpart, an aspect split not recorded in this file |
| `docs-contract.test.ts` | Drift between the PUBLISHED docs and the code: a taught command or flag that does not exist, an existing command no doc teaches, an SDK member or response key `@shipstatic/types` dropped. Also `HELP_OMISSIONS` |
| `sdk-cli-parity.test.ts` | An SDK resource method with no CLI output row, or a CLI row with no SDK method, both enumerated from production (`CLI_OMISSIONS` records deliberate gaps) |
| `coverage.thresholds` | Coverage decay. A ratchet that only goes up, with per-file floors named in `vitest.config.ts` for code only the smoke or browser tier reaches |

**A published doc is API surface.** `package.json` publishes `README.md`, and
for an agent that file IS the interface. The fence reads the docs named in
`files`, so shipping a new markdown file puts it under contract. Its one
omission is `helpText()`, byte-pinned by the smoke tier. **The docs contract
asks whether a flag NAME is taught, not whether each command's use is**: a
flag already documented on one command stays green when another gains it, so
document such additions deliberately.

**This package ships no skill.** ShipStatic's one agent skill,
`publish-online`, lives in the coding-agent plugin (`shipstatic/plugin`) and
is served at www.shipstatic.com/SKILL.md; two skills under one name would
leave an agent unable to tell which is ShipStatic's.

### The mock server

`tests/mocks/` is a hand-maintained twin of the API: `handler.ts` (one
Web-standard `handleApiRequest(request, state)`), `state.ts` (per-instance
state from a factory), `server.ts` (a thin `node:http` adapter).

| | Holds | Runs |
|---|---|---|
| `satisfies` on every body | the response SHAPES | `pnpm typecheck` |
| `tests/contract.ts` | the BEHAVIOUR: status, typed error, guard order | CI (mock half) + opt-in (live half) |
| `// wire:` citations | where in the API to look when one of the above fails | a reader |

**The contract points live once, in `tests/contract.ts`, and two runners
consume them**: `tests/contract.test.ts` (mock, in CI) and the
`wire contract` block of `tests/e2e/smoke.e2e.test.ts` (real API, opt-in).
Both observe through published surface only (a success's status off the
`response` event, a failure's off the `ShipError`). The mock half proves the
mock encodes the table; only the live half proves the table matches the API.
**Run `pnpm test:e2e` before a release, and after any API change.** Rows the
e2e tier must not run carry their reason as a string instead of `live: true`
(`NO_DOMAINS`, `NO_TOKENS`). **A client is a fixture too**: a credential-less
`Ship` sits beside the ids, so the anonymous ttl refusal has a live half.

**`.github/workflows/e2e.yml` runs `pnpm test:e2e` daily**, plus
`workflow_dispatch`. It is live once two repository secrets are set:
`SHIP_E2E_API_KEY` (an API key for a non-production API) and
`SHIP_E2E_API_URL` (that API's URL). Both are required, because without the
URL the harness defaults to production. An unconfigured run emits a
`::notice` and passes.

- **It does not gate `publish`.** The non-production API may lag this repo, so
  red means "these two disagree", not "this release is wrong". It is its own
  workflow, never a `needs:`, and never in `ci.yml`.
- **Its failure notice runs in its own job under `permissions: {}`**: the e2e
  job holds an API credential, and the alerts webhook never sits beside one.
- **A burst of hand dispatches can turn the anonymous-ttl row's `Forbidden`
  into a `RateLimit`**, since each run spends anonymous budget and the limiter
  runs before the refusal. That row's comment in `tests/contract.ts` carries
  the signature.

**When the API changes:** update `@shipstatic/types` → follow the `// wire:`
citations in `tests/mocks/handler.ts` → `pnpm typecheck` guides the rest.

### Testing canon

A change that breaks one of these needs a recorded exception, not a
workaround:

1. **Pure lib tests mock nothing.** `md5`, `path`, `deploy-paths`,
   `validation`, `junk` run the real thing on real inputs.
2. **SDK-level tests run a real `Ship` against the wire-truth handler.** An
   internal module mock needs a recorded reason; today there is one,
   `node:readline/promises` in `config.test.ts`, since stdin cannot be
   supplied for real.
3. **A mock may only mock exports that exist** (the typecheck enforces it).
4. **Raw `fetch` stubbing only where transport IS the subject** (the
   `http*.test.ts` family). Elsewhere, inject the `fetch` option or use the
   mock server.
5. **Builders are the only fixture source** (`tests/fixtures/builders.ts`),
   with explicit timestamps: no `Date.now()` in an asserted value.
6. **Every mock route cites its API wire truth**, `satisfies` its published
   response type, and has its status, typed error and guard order in
   `tests/contract.ts`.

The e2e harness var is deliberately `SHIP_E2E_API_KEY`: it names a literal API
key, matches the CI secret, and is not part of the SDK's env contract
(`SHIP_TOKEN`). Do not rename it in credential sweeps.

**Tests run in parallel.** Each file gets its own mock server on an ephemeral
port and its own state (`tests/mocks/server.ts`), so no file sees another's
writes or contends for a port.

**Recorded aspect splits**: one subject, more than one mirror file, legal under
the layout law (`<module>-<aspect>.test.ts`). `tests/architecture/test-naming.test.ts`
fails the suite if a split is not named here by full basename.

| Module | Files | Why |
|---|---|---|
| `src/shared/api/http.ts` | `http`, `http-anonymous`, `http-events`, `http-rate-limit`, `http-retry`, `http-timeout` | The transport's cross-cutting concerns, one file each. `http.test.ts` is the anchor (stubbed `fetch`); the rest drive a real `Ship` against the wire-truth handler |
| `src/shared/base-ship.ts` | `base-ship`, `base-ship-credentials`, `base-ship-lifecycle`, `base-ship-limits` | Three doctrines on one class: the credential slot, the lifecycle, and `getLimits`, which asks the server every time |
| `src/shared/resources.ts` | `resources-account`, `resources-deployments`, `resources-domains`, `resources-paths`, `resources-tokens` | One file per resource factory, plus `resources-paths`: the URL each builds, which a routing mock server would forgive, so it needs a stubbed `fetch` and a string comparison |
| `src/shared/types.ts` | `types-reexport` | The **freshness** of what the module re-exports: a bundled-dependency fence |

**Recorded feature-axis files**: no single subject module, so the mirror rule
cannot apply. The list lives in the naming fence (`FEATURE_AXIS`), and adding
to it is a decision: `unknown-commands` (the CLI's error surface), `validation`
(parse-time credential and URL checks), `smoke` (the true-binary tier), and
`e2e/smoke.e2e`.

### Commander

**`commander@^14`, deliberately not 15.** Commander 15 is ESM-only and needs
Node ≥ 22.12, incompatible with the CJS `dist/cli.cjs` bin and the
`engines >=20.19.0` consumer contract. Revisit when dropping Node 20 or going
ESM-only is decided. An ESM-only package reached by `require()` is the hazard
the pin avoids; `dist/index.cjs` already requires one (`junk`), which is why
20.19.0 (where `require(esm)` landed) is the floor.

**Two help scopes, one machinery.** The ROOT renders the hand-written front
page (`helpText()`, byte-pinned in the smoke tier): `ship`, `ship --help`/`-h`
and `ship help`. Subcommands render Commander's NATIVE scoped help
(`ship domains --help`, `ship help deployments`, `--help` beside a missing
argument). The split is one conditional in `configureHelp.formatHelp`: root →
`helpText()`, else → `Help.prototype.formatHelp`. Riding the built-in
`-h, --help` and `help [command]` means no help route resolves credentials or
reads a config file. `-h`/`-V` are supported.

`allowExcessArguments()` is a recorded opt-out of the excess-arguments error:
unknown subcommands must reach `handleUnknownSubcommand` as excess args to get
scoped usage. Option arguments that parse (`--ttl`) throw
`InvalidArgumentError`, never a bare `parseInt` that sends `NaN`.

### The CLI's two tiers

`src/node/cli/index.ts` exports `buildProgram()`, a factory returning a fresh
Commander tree (instances are not reusable across parses). **The tree never
calls `process.exit` on the command path**: outcomes land in
`process.exitCode` or ride a thrown `CommanderError`, and the bin ends when
the event loop drains, so buffered stdout is never truncated on a pipe. The
one exception is `performDeploy`'s SIGINT handler (`process.exit(130)`):
Ctrl+C must end now, with the shell's 128+SIGINT convention.

- **In-process tier** (`index.test.ts`, `unknown-commands`, `validation`, via
  `tests/node/cli/harness.ts`): drives `buildProgram()` directly, so V8
  coverage sees the command tree (a subprocess is invisible to it). The
  harness pins the colour environment (`NO_COLOR` on, `FORCE_COLOR` cleared).
- **Child-process smoke tier** (`smoke.test.ts`, the ONE file that spawns
  `dist/cli.cjs`): byte-exact help, exit codes, stdin piping, colour from the
  launch environment, stdout surviving a pipe, and the completion round trip
  through a real shell.

### The browser capability tier

`tests-browser/` runs on **real Chromium** via `pnpm test:browser` (vitest
browser mode, playwright provider), certifying what jsdom only approximates:
native `getENV()` detection, `webkitRelativePath` as Chromium defines it, real
`File`/`FormData` bytes through `createDeployBody`, spark-md5 digests (the same
published vectors as the Node tier, since the platform checks every stored file
against the manifest's digests), and the planner's count against Chromium's
`FormData` encoder (`deploy-plan.test.ts`). No coverage coupling; a separate CI
step with `playwright install chromium`.

```
tests/
├── contract.ts       # The wire facts ship depends on, stated ONCE
├── contract.test.ts  # …run against the MOCK (CI). Its twin is in e2e/
├── architecture/     # Fences: integrity, naming, docs contract, SDK/CLI parity
├── browser/ node/ shared/   # Mirror axis: tests/<path>/<module>.test.ts
├── node/cli/harness.ts      # In-process CLI runner (buildProgram + capture)
├── node/cli/smoke.test.ts   # The ONE child-process file (dist/cli.cjs)
├── package/          # The BUILT artifact (dist entries, bundle boundary, licences)
├── e2e/              # Real API, opt-in: runs the SAME contract table
├── fixtures/         # builders.ts (the only fixture source) + site folders
├── mocks/            # handler.ts + state.ts + server.ts
├── setup.ts          # Hermeticity (both in-process projects)
├── setup-e2e.ts      # e2e harness (scrubs SHIP_TOKEN)
└── setup-server.ts   # Mock-server lifecycle (integration only)
tests-browser/        # Capability tier: real Chromium (pnpm test:browser)
```

## Adding New Features

- **New SDK method:** `@shipstatic/types` (interface) → `resources.ts` (path,
  verb, body, response type) → fixture → tests.
- **New CLI command:** `cli/index.ts` (command + `withErrorHandling`) →
  `cli/formatters.ts` (a `SHAPES` row or formatter if needed) → `cli/types.ts`
  (`CLIResult` union if needed) → tests.
- **New shared utility:** `src/shared/lib/` → export from `lib/index.ts` if
  public → unit tests.

## The single-page question

A deploy asks it by sending `spa=true` (`DEPLOY_FIELDS.SPA`): the platform then
writes the routing config itself when the root `index.html` is an empty
application shell and the deploy ships no `ship.json`. Absence asks nothing.
This SDK asks by default: `spaDetect` is `true` unless set `false`
(`--no-spa-detect`), and `false` sends nothing. The option and the field are
two names for two layers; neither is renamed. A `ship.json` the deploy carries
always wins. The SDK writes no routing config of its own, so it relies on an
API that knows the field.

It costs no request: a split deploy's bare declaration carries the root
`ship.json` and the root `index.html` whether or not it asks
(`deploy-plan.ts`), and the API refuses a declaration that leaves the
`ship.json` behind, or asks the question and leaves the `index.html` behind.
`/spa-check` answers the same question for clients older than the field; this
SDK does not call it.

Three `tests/contract.ts` rows hold the wire: an app deployed with no option
sends `spa=true` and comes back configured, the opt-out sends nothing and
leaves it unconfigured, and a split declaration carries `index.html`.
`pnpm test:e2e` proves them against a real API.

## ship.json: the client checks syntax, the server owns the schema

`deploy()` calls `validateDeployConfig` (`shared/lib/validation.ts`) before it
builds the body, beside `validatePassword` and `validateLabels`. It finds the
root `ship.json`, reads it on either platform (`Buffer` in Node, `Blob` in the
browser), and applies `assertShipJsonSyntax` from `@shipstatic/types`.

**The split is deliberate.** The schema and its compiler live on the server,
so a client judging them would reject configs a newer platform accepts. The
client checks only what is true of every past and future schema: the text
parses as JSON (RFC 8259) and its top level is an object. A UTF-8 BOM is
stripped, as on the server. That catches the hand-edit case (a trailing comma,
a `//` comment, smart quotes) before any upload, with `ErrorType.Config`, the
type the server's own rejection uses. Scope: the exact name at the deploy root
(paths arrive canonical); a `config/ship.json` is an ordinary asset.

## Error Handling

All errors use `ShipError` from `@shipstatic/types` (factories, type guards,
`fromHttpResponse`, `fromFetchError`); its "Error Flow" section has the
lifecycle. `ApiHttp` owns no error mapping: `executeRequest` calls
`ShipError.fromHttpResponse(response, operationName)` for non-OK responses and
`ShipError.fromFetchError(error, operationName)` for thrown causes (an existing
`ShipError` passes through).

**CLI error UX** (`src/node/cli/error-handling.ts`), pure functions:

- `toShipError(err)` normalizes any thrown value (Commander parse failures
  included).
- `getUserMessage(err, options)` maps a `ShipError` to an actionable string:
  auth → credential hints, timeout → the deadline sentence verbatim, network →
  connectivity, maintenance → the operator's sentence and where to watch,
  client/4xx → the API message, 5xx → "try again". **Text channel only.**

**The timeout arm sits AHEAD of the network arm and branches on the TYPE**: the
two share a category (`isNetworkError()`), and a deploy that hit its ceiling
must not be told to check its Wi-Fi. It appends nothing, since the client has
already tried three times. **The maintenance arm sits between network and
client**: a closed platform is neither the caller's fault, a transport failure
nor a server fault. It relays the sentence and the status URL and **never says
"try again"**, because the message states when.

There is no JSON formatter in this module: `--json` is `ShipError.toResponse()`
through `error()` in `utils.ts`, and a second serializer would drift from the
wire (see "Output Conventions").

## Credentials and environment

**Deploy token vs API key.** Both ride the one `token` slot; the prefix says
which. An API key (`ship-`) is durable and grants full account access; a
deploy token (`deploy-`) is scoped to deploys, may carry a TTL, and is
revocable.

**Credential resolution, end to end:**

| Layer | Where | Reads |
|---|---|---|
| **CLI** | `src/node/cli/shiprc.ts` | `~/.shiprc`, or the `--config` path (strict JSON) |
| **CLI** | `create-client.ts` `createClient()` | flag → env → file via `mergeCliConfig`, then `new Ship({...})` |
| **CLI** | `create-client.ts` `resolveCliToken()` | the same chain for the token alone: the auth branch of the error handler, and the `--domain` / `--ttl` preflights |
| **SDK (Node)** | `src/node/index.ts` constructor | `SHIP_TOKEN`, `SHIP_API_URL` (under any constructor arg) |
| **SDK (Browser)** | `src/browser/index.ts` constructor | nothing: fully explicit |

A CLI user with all three gets flag → env → file, per value; an embedded SDK
consumer gets constructor arg → env. There is no path from the SDK to the
filesystem.

**`resolveCliToken` is a second function, not a shared helper with a posture
flag**, because the two differ in exactly what the flag would parameterize: a
broken config file is SWALLOWED there (it runs inside the error handler, where
an unreadable config must not mask the failure being reported), and the merged
API URL is not judged there (that would raise a second error while rendering
the first). Today every caller runs after `createClient` has read the same
file, so the `catch {}` is unreachable; it stays, because the property belongs
to the call site, and a caller moved ahead of `createClient` would make the
hazard live.

**CLI-only env vars** (read by the CLI, not by the SDK constructor):

| Var | Purpose |
|---|---|
| `SHIP_PASSWORD` | Default for `--password` on `ship deploy` / `ship deployments upload`. `''` is absence, so an unset CI variable never protects a deploy |
| `SHIP_IDEMPOTENCY_KEY` | The SDK's `idempotencyKey` for both deploy spellings: a re-run is answered with the live deployment the key already made. `''` is absence, so an unset CI variable never collapses every deploy in a job into one replay. No flag |
| `SHIP_VIA` | Overrides the deploy `via` field (the CLI sends `cli` when unset) |

- **`SHIP_IDEMPOTENCY_KEY` is for subprocess wrappers**, which compose an argv
  they do not own and cannot reach an SDK option. The GitHub Action derives one
  key per workflow run, so a re-run is answered with the first run's
  deployment. A shell user has the env var too, which is why a
  `--idempotency-key` flag is a product call (ergonomics, not reach), not a gap.
- **`SHIP_VIA` is for integrations wrapping a first-party executable**: the
  GitHub Action sets `git` on the CLI, and the stdio MCP bin reads the same slot
  with `mcp` as its default. Its owner is `SHIP_VIA_ENV` in `@shipstatic/types`
  (beside, not inside, `SHIP_ENV`: the SDK never reads it), and both
  executables read through the constant. In-process consumers pass the `via`
  option instead. Distinct from the programmatic `caller` option (see the
  `ShipClientOptions.caller` JSDoc).

**Every deploy names its surface; `via` is never empty by accident.** The
registry is `DeploymentVia` in `@shipstatic/types`, closed on purpose: each
client owns its member, and a direct SDK call falls back to `sdk`, applied at
the single wire boundary in `api/http.ts`. A closed enum makes attribution the
compiler's business: a typo'd value fails to compile, and `normalizeVia` drops
what the vocabulary does not name. Adding a surface is a types change. What a
request naming nothing is recorded as is the API's call.

**README placement.** `SHIP_VIA` and `caller` stay out of the README's CLI
Reference and SDK Deploy Options: they are ShipStatic-specific levers for
first-party integrations, documented here and in JSDoc. The `fetch` option is
in the README ("Custom fetch"), because every comparable SDK ships it.
ShipStatic-specific levers stay out of the README; industry conventions go in.

**`getLimits()` asks the server every time.** Limits are the account's policy
and may change at any moment (a plan move, a grant), so the client never holds
them. `getLimits()` issues `GET /limits` on every call; a deploy reads them
once, at its start, and hands them to `processInput` (size, count and blocklist
checks). Nothing else requests them. Holding them is refused: a client can live
as long as a browser tab, so a memo would judge today's upload by the morning's
limits and starve the caller's own cache of fresh data. `base-ship-limits.test.ts`
fences it by request COUNTS and by a server that changes its answer between
calls.

**`/limits` carries the platform's extension blocklist.**
`PlatformLimits.blockedExtensions` is the API's list; `validateFiles` and both
file pipelines refuse nothing it does not name. The field is **optional, and
absence is a contract**: an API without it means "no client-side check", never
"an empty policy", and the API refuses at its boundary. **Never restore a
compiled-in copy**: `@shipstatic/types` is bundled into `dist`, so a constant
would pin every published tarball to an old policy, in both directions. The
`getLimits` row in `tests/contract.ts` is the only thing here that can see the
API drop the field (its live half).

### The deploy rules

**The rules are the platform's, and this package renders them.** Every rule a
deployment's files are held to is one table in `@shipstatic/types` ("Deploy
rules"): `FILE_RULES` per file (name, extension, project, path, file size,
running total) and `SET_RULES` for the whole (it has files, each path once, no
more than the plan allows, and an `index.html` at its root). The API judges by
the same table, so a refusal reads the same wherever it is made. This package
authors no sentence of its own:

- **The throwing renderer** is `deployRefusal`, which the shared pipeline
  (`core/deploy-files.ts`) calls over every file's path and size before reading
  one: `ShipError.validation`, the API's own type and status.
- **The collecting renderer** is `validateFiles`, read by drop: each file's
  first broken rule, then the set rules under `(N files)`. Its own check is
  about a `File` rather than a deployment (a processing error), and an empty
  file is excluded with a warning, as the pipelines skip it.

**Every sentence is complete on its own**, names its file once (set rules name
none), and ends a limit's sentence with the way forward the API delivered
(`PlatformLimits.suggestions`), so every surface shows it as is and this
package never learns what a plan is.

**The home page.** A deploy with no `index.html` at the top is refused before
the first request, and the sentence names the step that fits the files: the
folder to publish when the site sits one folder down, the page to rename when
there are pages but none at the top, or a small `index.html` to add. An empty
`index.html` is refused as EMPTY ("The index.html at the top of your site is
empty."), because both renderers hand the set rules the files as sent and the
table decides what is published (`isPublishedFile`: an empty file never is).
`tests/contract.ts` holds the refusal as a validation error made with no
request (`deployments.upload (no index.html)`).

## Backend Integration

| SDK Method | API Endpoint | Notes |
|------------|--------------|-------|
| `deployments.upload()` | `POST /deployments` | The declaration: manifest, options (`spa=true` unless `spaDetect` is `false`), root `ship.json` and `index.html`, other files. 201 live when it carries every file, else 202 pending |
| ↳ each further batch | `POST /deployments/:deployment/files` | After a 202, one fill per batch: 202 pending, 201 live, 200 already live. Files only |
| ↳ `idempotencyKey` | header `Idempotency-Key` (declaration only) | Answers the earliest live deployment the key made in the account within 24h, as it stands. An anonymous key is ignored. Key the ATTEMPT (run id, commit sha), never the try |
| ↳ CLI `--domain` | *(no endpoint)* | Composed client-side: this upload, then `domains.set()` (see "Composability") |
| `deployments.list()` | `GET /deployments` | Paginated `{limit, cursor}` (`--limit`/`--cursor`; text prints a rerun hint, `--json` carries `cursor`) |
| `deployments.get()` | `GET /deployments/:deployment` | |
| `deployments.set()` | `PATCH /deployments/:deployment` | Labels only |
| `deployments.delete()` | `DELETE /deployments/:deployment` | 202 `{deployment, status:'deleting'}`, resolved; a repeat answers the same object |
| `domains.set()` | `PUT /domains/:name` | Upsert: create, repoint, or label |
| `domains.list()` | `GET /domains` | Paginated, same contract |
| `domains.get()` | `GET /domains/:name` | |
| `domains.validate()` | `POST /domains/validate` | Pre-flight; the name rides the JSON body |
| `domains.verify()` | `POST /domains/:domain/verify` | 202 `{domain}`; the CLI composes its own copy and reads the domain once more for the link step |
| `domains.dns()` | `GET /domains/:name/dns` | DNS provider information |
| `domains.records()` | `GET /domains/:name/records` | Required DNS records |
| `domains.share()` | `GET /domains/:name/share` | Shareable setup hash |
| `domains.delete()` | `DELETE /domains/:domain` | 200 `{domain}`, resolved |
| `tokens.create()` | `POST /tokens` | 201 |
| `tokens.list()` | `GET /tokens` | Paginated, same contract |
| `tokens.get()` | `GET /tokens/:token` | The listing's row, addressable |
| `tokens.delete()` | `DELETE /tokens/:token` | 200 `{token}`, resolved |
| `account.get()` | `GET /account` | Resolves `Account` (names its `account`). The SDK sends no `X-Account`: a key, deploy token or OAuth grant is its account, and a session-mode browser host names it through its own `fetch` |
| `ping()` | `GET /ping` | `PingResponse` (`{timestamp}`); reachability is the absence of a throw |
| `getLimits()` | `GET /limits` | Every call. Plan caps **and** the optional `blockedExtensions` |
| (internal) | `POST /upload` | Only via the `@internal` `deployEndpoint` option, for the platform's own web apps |

**Three timeout budgets, one per kind of work.** 30s for a metadata read,
where slower is a fault. A deploy request carries at most
`DEPLOY_REQUEST_CONSTRAINTS.MAX_BYTES` (64 MiB) and gets
`DEFAULT_DEPLOY_TIMEOUT`, 5 minutes: at `UPLOAD_FLOOR_BITS_PER_SECOND`
(2.5 Mbit/s) the largest request transfers in about 215 s, leaving about 85 s
for the server's work; `http-timeout.test.ts` holds the sum. A **build or
prerender** deploy waits on server work after the upload, so
`DEFAULT_DEPLOY_BUILD_TIMEOUT` is derived, `DEFAULT_DEPLOY_TIMEOUT +
BUILD_SERVICE_BUDGET`, the budget read from `BUILD_TIME_LIMIT_SECONDS` in
`@shipstatic/types`, the same owner the API reads. `spa` does not qualify.

**Only the DEFAULTS split by operation**: an explicit `timeout` option governs
every request, deploys included. **The ceiling is per ATTEMPT**: each attempt
is an honest request, and `maxRetries` bounds how many. A caller wanting a
wall-clock deadline passes its own `signal` (`AbortSignal.timeout(ms)`), which
works because the loop never retries past a caller's signal. The long-term
instrument is an **idle timeout** (reset on progress, independent of payload
size); it needs upload-progress observation, which browser `fetch` lacks, so it
is built together with a progress bar.

### Routes the API exposes that the SDK does not reach

- **First-party and operator routes are not the SDK's to reach**; the SDK is
  the client of the public API only.
- **`GET /activities` stays out of the SDK.** The dashboard is its only
  client; a CLI user reads their audit trail in the console. Do not add
  `ship.activities` without a new decision. `ActivityListResponse` lives in
  `@shipstatic/types` because the API produces it and the console consumes it;
  the SDK is not one of its halves. **The `*Resource` interfaces describe the
  SDK's contract, not the API's**, so an `ActivityResource` with no
  implementation would be dead surface.
- **Open product calls, not drift:** `GET /labels` (an endpoint with no SDK
  method) and a `--idempotency-key` CLI flag (the SDK option and the env var
  exist). Neither is added without the call.

### Domain Write Semantics

`PUT /domains/:name` is a merge-upsert: omitted fields are preserved on
update, defaulted on create. It covers reserve (omit deployment), link, an
atomic deployment switch, and label update.

**No unlinking, by design.** `{ deployment: null }` returns 400. Reservation
(forward-looking) is valid; unlinking (backward-looking) is not. To take a
site offline, deploy a maintenance page; to clean up, delete the domain.

**PUT, not PATCH**, because a domain is a mutable routing record identified by
a natural key, so one upsert covers create, repoint and label. Deployments use
PATCH: they are immutable artifacts with labels as the only mutable
annotation.

### Domain Normalization

The SDK is a transparent pipe: no domain validation or normalization. It
URL-encodes names in paths (`encodeURIComponent`) and passes everything else
as is. The API owns domain semantics: it accepts liberal input (any case,
Unicode), normalizes, validates, and returns the normalized name.

---

*This file provides Claude Code guidance. User-facing documentation lives in README.md.*
