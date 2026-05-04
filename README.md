# @shipstatic/ship

CLI and SDK for [ShipStatic](https://shipstatic.com) — deploy static websites, landing pages, and prototypes instantly from the terminal or code.

## Install

```bash
npm install -g @shipstatic/ship
```

> As a project dependency: `npm install @shipstatic/ship`

## Deploy — Free, No Account Needed

```bash
ship ./dist
```

Your site is live instantly on `*.shipstatic.com`. No API key, no sign-up, no configuration.

Deployments without an API key are public and expire in 3 days. The output includes a **claim URL** — visit it to keep the site permanently.

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship();
const result = await ship.deploy('./dist');
// result.deployment → live URL (happy-cat-abc1234.shipstatic.com)
// result.claim      → visit to keep permanently
```

## All Commands — Free API Key

For permanent deployments and full control over your sites and domains, get a free API key from [my.shipstatic.com/api-key](https://my.shipstatic.com/api-key).

```bash
ship config    # paste your API key when prompted
```

```javascript
const ship = new Ship({ apiKey: 'ship-...' });
```

### Deployments

```bash
ship ./dist                                        # Deploy (shortcut)
ship ./dist --label production --label v1.0.0      # Deploy with labels
ship deployments list
ship deployments get <deployment>
ship deployments set <deployment> --label production
ship deployments remove <deployment>
```

```typescript
ship.deploy(input, options?)               // Shortcut for deployments.upload()
ship.deployments.upload(input, options?)
ship.deployments.list()
ship.deployments.get(deployment)
ship.deployments.set(deployment, { labels })
ship.deployments.remove(deployment)
```

### Domains

```bash
ship domains set www.example.com                   # Reserve domain (no deployment yet)
ship domains set www.example.com <deployment>      # Link domain to deployment
ship domains set www.example.com --label prod      # Update labels only
ship domains get www.example.com
ship domains list
ship domains validate www.example.com
ship domains verify www.example.com
ship domains records www.example.com
ship domains dns www.example.com
ship domains share www.example.com
ship domains remove www.example.com
```

```typescript
ship.domains.set(name, { deployment?, labels? })   // Upsert — create, repoint, or label
ship.domains.get(name)
ship.domains.list()
ship.domains.validate(name)
ship.domains.verify(name)
ship.domains.records(name)
ship.domains.dns(name)
ship.domains.share(name)
ship.domains.remove(name)
```

`domains.set()` is a merge-upsert — omitted fields are preserved on update, defaulted on create. Once linked, a domain cannot be unlinked (`{ deployment: null }` → 400). Switch deployments or delete the domain instead.

Domain names are normalized by the API — any case, Unicode accepted:

```typescript
ship.domains.set('WWW.Example.COM');   // → www.example.com
ship.domains.set('www.münchen.de');    // → Unicode supported
```

### Tokens

```bash
ship tokens create --ttl 3600 --label ci
ship tokens list
ship tokens remove <token>
```

```typescript
ship.tokens.create({ ttl?, labels? })
ship.tokens.list()
ship.tokens.remove(token)
```

### Account

```bash
ship whoami
ship config
ship ping
```

```typescript
ship.account.get()            // → whoami
ship.ping()                   // → boolean
ship.getLimits()              // → platform plan limits (cached)
```

## CLI Reference

### Composability

The `-q` flag outputs only the resource identifier — perfect for piping and scripting:

```bash
# Deploy and link domain in one pipe
ship ./dist -q | ship domains set www.example.com

# Deploy and open in browser
open https://$(ship ./dist -q)

# Batch remove all deployments
ship deployments list -q | xargs -I{} ship deployments remove {} -q
```

### Shell Completion

```bash
ship completion install
ship completion uninstall
```

### Global Flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key for authenticated requests |
| `--deploy-token <token>` | Deploy token for single-use deployments |
| `--api-url <url>` | API URL override (for development) |
| `--config <file>` | Custom config file path |
| `--json` | Output results in JSON format |
| `-q, --quiet` | Output only the resource identifier |
| `--no-color` | Disable colored output |
| `--help` | Display help for command |
| `--version` | Show version information |

### Deploy Flags

Available on `ship <path>` and `ship deployments upload`:

| Flag | Description |
|------|-------------|
| `--label <label>` | Add label (repeatable) |
| `--password <password>` | Password-protect this deployment (6–128 chars) |
| `--no-path-detect` | Disable automatic path optimization |
| `--no-spa-detect` | Disable automatic SPA detection |

### CLI Environment Variables

| Var | Purpose |
|---|---|
| `SHIP_API_KEY` | Default for `--api-key` |
| `SHIP_DEPLOY_TOKEN` | Default for `--deploy-token` |
| `SHIP_API_URL` | Default for `--api-url` |
| `SHIP_PASSWORD` | Default for `--password` (empty string normalized to absence) |

## SDK Reference

### Authentication

```javascript
// No credentials — deploy only, 3-day expiry
const ship = new Ship();

// API key — permanent, full access
const ship = new Ship({ apiKey: 'ship-...' });

// Deploy token — single-use, consumed on successful deploy
const ship = new Ship({ deployToken: 'token-...' });

// Set credentials after construction
ship.setApiKey('ship-...');
ship.setDeployToken('token-...');
```

### Deploy Options

```typescript
ship.deploy(input, {
  labels?: string[],
  password?: string,          // Password-protect the deployment (6–128 chars)
  onProgress?: ({ percent }) => void,
  signal?: AbortSignal,
  onCancel?: () => void,      // Called if signal aborts
  pathDetect?: boolean,       // Auto-optimize paths (default: true)
  spaDetect?: boolean,        // Auto-detect SPA (default: true)
  maxConcurrency?: number,    // Concurrent uploads (default: 4)
  timeout?: number,           // Request timeout in ms
  via?: string,               // Client identifier
  apiUrl?: string,            // Per-request API URL override
  apiKey?: string,            // Per-request API key override
  deployToken?: string,       // Per-request deploy token override
});
```

#### Password protection

Pass `password` (6–128 characters; whitespace significant) to gate the deployment behind a prompt. Visitors are asked for the password before they can view the site, including on any custom domains pointing at it. To remove protection, redeploy without a password.

```bash
ship --password 'your-passphrase' ./dist
```

```javascript
await ship.deploy('./dist', { password: 'your-passphrase' });
```

The CLI also reads `SHIP_PASSWORD` from the environment when `--password` is not given.

### Browser Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({ apiKey: 'ship-...' });

// From file input
const deployment = await ship.deploy(fileInput.files);

// From StaticFile array
const deployment = await ship.deploy([
  { path: 'index.html', content: new Blob(['<html>…</html>']) }
]);
```

### Events

```javascript
ship.on('request', (url, init) => {});
ship.on('response', (response, url) => {});
ship.on('error', (error, url) => {});
ship.off('request', handler);
```

### Error Handling

```javascript
import { isShipError, ErrorType } from '@shipstatic/types';

try {
  await ship.deploy('./dist');
} catch (error) {
  if (isShipError(error)) {
    error.isAuthError();        // semantic category
    error.isNetworkError();     // semantic category
    error.isClientError();      // semantic category (Business | Config | File | Validation)
    error.type === ErrorType.Validation;  // specific-type check
    error.status === 429;       // status check
  }
}
```

## Configuration

The **CLI** (`ship`) resolves credentials in this order:

1. CLI flags: `--api-key`, `--api-url`, `--deploy-token`
2. Environment variables: `SHIP_API_KEY`, `SHIP_API_URL`, `SHIP_DEPLOY_TOKEN`
3. Config files: `.shiprc` or `package.json` `"ship"` key (run `ship config` to create one)

The **SDK** (`new Ship(...)`) resolves credentials in this order:

1. Constructor options: `new Ship({ apiUrl, apiKey })`
2. Environment variables: `SHIP_API_KEY`, `SHIP_API_URL`, `SHIP_DEPLOY_TOKEN`

The SDK never reads `.shiprc` or `package.json` — file resolution is a CLI feature, not an SDK feature. This keeps `new Ship({})` safe to use from embedded contexts (MCP, n8n, library wrappers) without inheriting the host developer's personal credentials.

```bash
SHIP_API_KEY=ship-... ship deployments list
```

## TypeScript

```typescript
import type { ShipClientOptions, DeploymentOptions, ShipEvents } from '@shipstatic/ship';
import type { Deployment, Domain, Account, StaticFile } from '@shipstatic/types';
```

## AI Agents

This package includes a [SKILL.md](./SKILL.md) file — a portable skill definition that AI agents (Claude Code, Codex, etc.) use to deploy sites with `ship` autonomously.

---

Part of the [ShipStatic](https://shipstatic.com) platform.
