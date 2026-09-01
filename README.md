# @shipstatic/ship

CLI and SDK for [ShipStatic](https://shipstatic.com) — deploy static websites, landing pages, and prototypes instantly from the terminal or code.

## Deploy in seconds — no install, no account

```bash
npx @shipstatic/ship ./dist
```

That's it. Your site is live on `*.shipstatic.com`. No sign-up, no config, no global install. Got Node? You're ready.

The output includes a **claim URL** — visit it to keep the site permanently. Anonymous deployments are public and expire in 3 days.

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship();
const result = await ship.deploy('./dist');
// result.deployment → live URL (happy-cat-abc1234.shipstatic.com)
// result.claim      → visit to keep permanently
```

## Install (optional, for repeat use)

```bash
npm install -g @shipstatic/ship   # global CLI — drop the `npx @shipstatic/ship` prefix
```

> As a project dependency: `npm install @shipstatic/ship`
>
> Every example in this README uses the bare `ship` command. If you haven't installed it globally, prefix any of them with `npx @shipstatic/ship` (or `npx -y @shipstatic/ship` in non-interactive environments).

## All commands — free API key

For permanent deployments and full control over your sites and domains, get a free API key from [my.shipstatic.com/api-key](https://my.shipstatic.com/api-key).

```bash
ship config    # paste your API key when prompted
```

```javascript
const ship = new Ship({ token: 'ship-your-api-key' });
```

### Deployments

```bash
ship ./dist                                        # Deploy (shortcut)
ship ./dist --domain www.example.com               # Deploy and serve it there
ship ./dist --ttl 1h                               # Expires in an hour
ship ./dist --label production --label v1.0.0      # Deploy with labels
ship deployments list
ship deployments list --limit 20                   # Page size; a hint shows the next cursor
ship deployments list --cursor <cursor>            # Continue from a previous page
ship deployments get <deployment>
ship deployments set <deployment> --label production
ship deployments delete <deployment>
```

```typescript
ship.deploy(input, options?)               // Shortcut for deployments.upload()
ship.deployments.upload(input, options?)
ship.deployments.list(options?)            // { limit?, cursor? } — response carries the next cursor
ship.deployments.get(deployment)
ship.deployments.set(deployment, { labels })
ship.deployments.delete(deployment)
```

### Domains

```bash
ship domains set www.example.com                   # Reserve domain (no deployment yet)
ship domains set www.example.com <deployment>      # Link domain to deployment
ship domains set www.example.com --label prod      # Update labels only
ship domains get www.example.com
ship domains list                                  # --limit / --cursor paginate here too
ship domains validate www.example.com
ship domains verify www.example.com
ship domains records www.example.com
ship domains dns www.example.com
ship domains share www.example.com
ship domains delete www.example.com
```

```typescript
ship.domains.set(name, { deployment?, labels? })   // Upsert — create, repoint, or label
ship.domains.get(name)
ship.domains.list(options?)                 // { limit?, cursor? }
ship.domains.validate(name)
ship.domains.verify(name)
ship.domains.records(name)
ship.domains.dns(name)
ship.domains.share(name)
ship.domains.delete(name)
```

`domains.set()` is a merge-upsert — omitted fields are preserved on update, defaulted on create. Once linked, a domain cannot be unlinked (`{ deployment: null }` → 400). Switch deployments or delete the domain instead.

Domain names are normalized by the API — any case, Unicode accepted:

```typescript
ship.domains.set('WWW.Example.COM');   // → www.example.com
ship.domains.set('www.münchen.de');    // → Unicode supported
```

### Tokens

```bash
ship tokens create --ttl 30d --label ci            # Or 3600, 90s, 1h — one grammar
ship tokens list
ship tokens get <token>
ship tokens delete <token>
```

```typescript
ship.tokens.create({ ttl?, labels? })
ship.tokens.list()
ship.tokens.get(token)
ship.tokens.delete(token)
```

### Account

```bash
ship whoami
ship account get
ship config
ship ping
```

```typescript
ship.account.get()            // → whoami
ship.ping()                   // → { timestamp } (server clock; reachability is the absence of a throw)
ship.getLimits()              // → platform plan limits (cached)
```

## CLI reference

### Composability

The `-q` flag outputs only the resource identifier — perfect for piping and scripting:

`ship tokens create -q` is the one exception: it prints the token **secret**, which is shown once and never again.

```bash
# Deploy and link domain in one pipe
ship ./dist -q | ship domains set www.example.com

# Deploy and open in browser
open https://$(ship ./dist -q)

# Batch delete all deployments
ship deployments list -q | xargs -I{} ship deployments delete {} -q
```

### Ephemeral deployments

```bash
ship ./dist --ttl 1h          # gone in an hour
ship ./dist --ttl 7d          # a week-long preview
ship ./dist --ttl 3600        # bare seconds work too
```

The platform reclaims the deployment when the time is up. Seconds, or a
`<n><unit>` duration (`s`/`m`/`h`/`d`) — the same grammar `ship tokens create
--ttl` uses. Bounded at one year.

Two rules, both refused before anything uploads. It **needs a token**: an
anonymous deployment already expires on the platform's own schedule, so there
is no deployer to choose a different one. And it **cannot be combined with
`--domain`**: a domain is a commitment and a deadline is its opposite, so the
API refuses to point a domain at a deployment that expires.

To keep something longer, deploy it again — there is no way to extend a
deployment's life, and no way to shorten it after the fact.

`--domain` is the same two calls as one command:

```bash
ship ./dist --domain www.example.com
```

Both spellings are supported and neither replaces the other. The pipe composes interactively — any two commands, wherever `-q` gives you the value the next one wants. `--domain` is one process, one exit code, and one `--json`, which is what CI needs: a `run:` block is `bash -e` **without** `pipefail`, so a pipeline reports only the last command's status and a failed deploy is masked. It answers as the domain, exactly as `ship domains set` does — DNS records and setup link included on a new external domain — and it needs a token, which it checks before uploading anything.

### Shell completion

```bash
ship completion install
ship completion uninstall
```

### Global flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--token <token>` | Any ship token: API key (`ship-…`) or deploy token (`deploy-…`) |
| `--api-url <url>` | API URL override (for development) |
| `--config <file>` | Custom config file path |
| `--json` | Output results in JSON format |
| `-q, --quiet` | Output only the resource identifier |
| `--no-color` | Disable colored output |
| `-h, --help` | Display help for command |
| `-V, --version` | Show version information |

### Deploy flags

Available on `ship <path>` and `ship deployments upload`:

| Flag | Description |
|------|-------------|
| `--domain <domain>` | Serve this deployment at that domain — creates or repoints it. Needs a token |
| `--label <label>` | Add label (repeatable) |
| `--password <password>` | Password-protect this deployment (6–128 chars) |
| `--ttl <duration>` | Expire this deployment after that long — `3600`, `90s`, `30m`, `1h`, `7d`. Needs a token; cannot be combined with `--domain` |
| `--no-path-detect` | Disable automatic path optimization |
| `--no-spa-detect` | Disable automatic SPA detection |

### CLI environment variables

| Var | Purpose |
|---|---|
| `SHIP_TOKEN` | Default for `--token` |
| `SHIP_API_URL` | Default for `--api-url` |
| `SHIP_PASSWORD` | Default for `--password` (empty string normalized to absence) |

## SDK reference

### Authentication

```javascript
// No token — deploy only: lands in the public account with a claim URL, 3-day expiry
const ship = new Ship();

// API key — durable, full account
const ship = new Ship({ token: 'ship-your-api-key' });

// Deploy token — scoped to deploys, optional TTL, revocable
const ship = new Ship({ token: 'deploy-your-token' });

// OAuth access token — delegated, short-lived, sent verbatim
const ship = new Ship({ token: accessToken });

// Token provider — invoked per request; refresh lives with you
const ship = new Ship({ token: () => mintToken() });

// Cookie session — first-party browser apps
const ship = new Ship({ session: true });

// Set or rotate the token after construction
ship.setToken('ship-your-api-key');
```

### Retries

Failed requests are retried automatically: transport failures (including a
timeout) and 500/502/503/504, twice by default, with full-jitter exponential
backoff. `maxRetries` is the knob; `0` disables it.

```javascript
const ship = new Ship({ token: 'ship-your-api-key', maxRetries: 5 });
```

Deliberately never retried: a maintenance 503 (its message says when to come
back), 429 (the rate limiter has answered), `PUT`/`DELETE` (a repeat can
misreport a lost success as a failure), anything stopped by a `signal` you
supplied, and any other non-`GET` without an `Idempotency-Key` — with the key,
a deploy replays its stored result instead of creating a second one.

`timeout` is the ceiling on one ATTEMPT. For a hard overall deadline pass your
own `signal` (`AbortSignal.timeout(ms)`), which is never retried past.

### Deploy options

```typescript
ship.deploy(input, {
  labels?: string[],
  password?: string,          // Password-protect the deployment (6–128 chars)
  ttl?: number,               // Seconds until it expires (needs a token; max 1 year)
  signal?: AbortSignal,       // Abort to cancel the deploy
  pathDetect?: boolean,       // Auto-optimize paths (default: true)
  spaDetect?: boolean,        // Auto-detect SPA (default: true)
  via?: string,               // Client identifier
});
```

#### Expiring deployments

Pass `ttl` in **seconds** and the platform reclaims the deployment when the time is up — 1 second to one year. The wire carries the duration and the API stamps `expires` against its own clock, so the answer says when:

```typescript
const result = await ship.deploy('./dist', { ttl: 3600 });
// result.expires → unix seconds, one hour after result.created
```

Needs a credential — an anonymous deployment already expires on the platform's own schedule. And a deployment carrying a ttl cannot be linked to a domain: the API refuses, which is what stops a domain pointing at something that is about to be reclaimed. There is no way to extend or shorten a deployment after the fact; redeploy instead.

#### Password protection

Pass `password` (6–128 characters) to gate the deployment behind a prompt. Visitors are asked for the password before they can view the site, including on any custom domains pointing at it. To remove protection, redeploy without a password.

```bash
ship --password 'your-passphrase' ./dist
```

```javascript
await ship.deploy('./dist', { password: 'your-passphrase' });
```

The CLI also reads `SHIP_PASSWORD` from the environment when `--password` is not given.

### Browser usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({ token: 'ship-your-api-key' });

// From file input
const deployment = await ship.deploy(fileInput.files);

// From StaticFile array
const deployment = await ship.deploy([
  { path: 'index.html', content: new Blob(['<html>…</html>']) }
]);
```

### Events

```javascript
ship.on('request', (url, init) => {});          // once per attempt
ship.on('retry', (error, url, attempt) => {});  // an attempt failed, another is coming
ship.on('response', (response, url) => {});     // the call succeeded
ship.on('error', (error, url) => {});           // the call failed, terminally
ship.off('request', handler);
```

One call emits `retry* (error | response)` — every failure is announced, and
the event name says whether it ended the call. `attempt` counts from 1, so it
names both the attempt that failed and which retry is happening.

### Custom fetch

Pass `fetch` to override the transport function used for every API call. Defaults to `globalThis.fetch`. Useful for wrapping requests with tracing, retries, or request signing, and for injecting a Cloudflare service-binding `Fetcher` from a Worker so calls reach a sibling Worker in-process instead of through the public hostname.

This is also the seam for corporate proxies: Node's built-in `fetch` ignores `HTTP(S)_PROXY` environment variables, so behind a proxy inject a proxy-aware transport (e.g. [undici](https://github.com/nodejs/undici)'s `EnvHttpProxyAgent` as the dispatcher, or Node 24+'s `NODE_USE_ENV_PROXY=1`).

```typescript
import type { Fetch } from '@shipstatic/ship';

const traced: Fetch = (input, init) =>
  globalThis.fetch(input, { ...init, headers: { ...init?.headers, 'X-Trace-Id': 'abc-123' } });

const ship = new Ship({ fetch: traced });
```

```typescript
// Cloudflare Worker with a service binding to the API.
// Any parseable apiUrl works — service bindings dispatch by binding identity, not hostname.
const ship = new Ship({
  apiUrl: 'https://api',
  fetch: env.API.fetch.bind(env.API),
});
```

### Error Handling

```javascript
import { isShipError, ErrorType } from '@shipstatic/types';

try {
  await ship.deploy('./dist');
} catch (error) {
  if (isShipError(error)) {
    error.isAuthError();        // semantic category
    error.isNetworkError();     // semantic category — nothing was exchanged
    error.isClientError();      // semantic category (Business | Config | File | Validation)
    error.type === ErrorType.Validation;  // specific-type check
    error.type === ErrorType.Timeout;     // a deadline expired — inside isNetworkError()
    error.status === 429;       // status check
  }
}
```

## Configuration

The **CLI** (`ship`) resolves its token in this order:

1. CLI flag: `--token`
2. Environment variable: `SHIP_TOKEN`
3. Config file: `~/.shiprc` (run `ship config` to create one)

`--config <file>` reads any path you name instead of `~/.shiprc`, which is how per-environment
configs work (`ship --config dev.shiprc ...`). The file is strict JSON; an empty one means "no
config".

**No repository file is ever read.** A `.shiprc` or `package.json` `"ship"` key in your working
directory is ignored — cloning a repo can never change which account you deploy to, or which
host your token is sent to.

The **SDK** (`new Ship(...)`) resolves its token in this order:

1. Constructor option: `new Ship({ token })`
2. Environment variable: `SHIP_TOKEN`

`--api-url` / `SHIP_API_URL` / `apiUrl` resolve the same way for the API endpoint.

The SDK never reads `.shiprc` or `package.json` — file resolution is a CLI feature, not an SDK feature. This keeps `new Ship({})` safe to use from embedded contexts (MCP, n8n, library wrappers) without inheriting the host developer's personal credentials.

```bash
SHIP_TOKEN=ship-your-api-key ship deployments list
```

## TypeScript

```typescript
import type { ShipClientOptions, DeploymentOptions, ShipEvents } from '@shipstatic/ship';
import type { Deployment, Domain, Account, StaticFile } from '@shipstatic/types';
```

## AI agents

This package includes a [SKILL.md](./SKILL.md) file, a portable skill definition that AI agents (Claude Code, Codex, and any other skills-aware tool) use to deploy sites with `ship` autonomously.

## Also available

| Surface | Reach it |
|---------|----------|
| **[MCP](https://mcp.shipstatic.com)** | Drop `https://mcp.shipstatic.com` into any MCP client |
| **[VS Code](https://marketplace.visualstudio.com/items?itemName=shipstatic.shipstatic)** | Search "ShipStatic" in the Marketplace |
| **[Gemini CLI](https://github.com/shipstatic/plugin)** | `gemini extensions install https://github.com/shipstatic/plugin` |
| **[n8n](https://www.npmjs.com/package/n8n-nodes-shipstatic)** | Search "ShipStatic" in n8n's node panel |
| **[GitHub Action](https://github.com/shipstatic/action)** | `shipstatic/action@v2` |
| **[Agent Skill](https://www.shipstatic.com/SKILL.md)** | One file, for any skills-aware tool |

## License

MIT

