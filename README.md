# @shipstatic/ship

Universal SDK and CLI for deploying static sites to ShipStatic. No account required — deploy instantly, claim later.

## Installation

```bash
# CLI (global)
npm install -g @shipstatic/ship

# SDK (project dependency)
npm install @shipstatic/ship
```

## CLI Usage

```bash
# Deploy — no account needed, site is live instantly
ship ./dist

# Deploy with labels
ship ./dist --label production --label v1.0.0

# Deploy and link to a domain in one pipe
ship ./dist -q | ship domains set www.example.com
```

Without credentials, deployments are public (3-day TTL) with a claim URL. Configure an API key for permanent deployments: `ship config`

### Composability

The `-q` flag outputs only the resource identifier — perfect for piping and scripting:

```bash
# Deploy and link domain
ship ./dist -q | ship domains set www.example.com

# Deploy and open in browser
open https://$(ship ./dist -q)

# Batch operations
ship deployments list -q | xargs -I{} ship deployments remove {} -q
```

### Deployments

```bash
ship deployments list
ship deployments upload <path>                    # Upload from file or directory
ship deployments upload <path> --label production # Upload with labels
ship deployments get <deployment>
ship deployments set <deployment> --label production
ship deployments remove <deployment>
```

### Domains

```bash
ship domains list
ship domains set www.example.com                  # Reserve domain (no deployment yet)
ship domains set www.example.com <deployment>     # Link domain to deployment
ship domains set www.example.com --label prod     # Update labels only
ship domains get www.example.com
ship domains validate www.example.com             # Check if domain is valid and available
ship domains verify www.example.com               # Trigger DNS verification
ship domains remove www.example.com
```

### Tokens

```bash
ship tokens list
ship tokens create --ttl 3600 --label ci
ship tokens remove <token>
```

### Account & Setup

```bash
ship whoami
ship config                      # Create or update ~/.shiprc
ship ping                        # Check API connectivity
```

### Shell Completion

```bash
ship completion install
ship completion uninstall
```

### Global Flags

```bash
--api-key <key>           API key for authenticated deployments
--deploy-token <token>    Deploy token for single-use deployments
--config <file>           Custom config file path
--label <label>           Add label (repeatable)
--no-path-detect          Disable automatic path optimization
--no-spa-detect           Disable automatic SPA detection
--no-color                Disable colored output
--json                    Output results in JSON format
-q, --quiet               Output only the resource identifier
--version                 Show version information
```

## SDK Usage

```javascript
import Ship from '@shipstatic/ship';

// Deploy — no credentials needed
const ship = new Ship();
const deployment = await ship.deploy('./dist');
console.log(`Live: https://${deployment.deployment}`);
console.log(`Claim: ${deployment.claim}`); // User visits to keep permanently

// With an API key — deployments are permanent
const ship = new Ship({ apiKey: 'ship-your-api-key' });
const deployment = await ship.deploy('./dist', {
  labels: ['production', 'v1.0'],
  onProgress: ({ percent }) => console.log(`${percent}%`)
});

// Manage domains (requires API key)
await ship.domains.set('www.example.com', { deployment: deployment.deployment });
await ship.domains.list();
```

## Browser Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({ apiKey: 'ship-your-api-key' });

// From file input
const files = Array.from(fileInput.files);
const deployment = await ship.deploy(files);

// From StaticFile array
const deployment = await ship.deploy([
  { path: 'index.html', content: new Blob(['<html>…</html>']) }
]);
```

## Authentication

Deploying works without credentials. For permanent deployments and account features:

```javascript
// API key (persistent access)
const ship = new Ship({
  apiKey: 'ship-...'  // 69 chars: ship- + 64 hex
});

// Deploy token (single-use)
const ship = new Ship({
  deployToken: 'token-...'  // 70 chars: token- + 64 hex
});

// Set credentials after construction
ship.setApiKey('ship-...');
ship.setDeployToken('token-...');
```

## Configuration

**Constructor options** (highest priority):
```javascript
new Ship({ apiUrl: '...', apiKey: '...' })
```

**Environment variables** (Node.js):
```bash
SHIP_API_URL=https://api.shipstatic.com
SHIP_API_KEY=ship-your-api-key
```

**Config files** (Node.js, in order of precedence):
```json
// .shiprc or package.json "ship" key
{ "apiUrl": "...", "apiKey": "..." }
```

## API Reference

### Top-level Methods

```typescript
ship.deploy(input, options?)      // Deploy (shortcut for deployments.upload)
ship.whoami()                     // Get current account (shortcut for account.get)
ship.ping()                       // Check API connectivity (returns boolean)
ship.getConfig()                  // Get platform config and plan limits
ship.on(event, handler)           // Add event listener
ship.off(event, handler)          // Remove event listener
ship.setApiKey(key)               // Set API key after construction
ship.setDeployToken(token)        // Set deploy token after construction
```

### Deployments

```typescript
ship.deployments.upload(input, options?)       // Upload new deployment
ship.deployments.list()                        // List all deployments
ship.deployments.get(deployment)               // Get deployment details
ship.deployments.set(deployment, { labels })   // Update deployment labels
ship.deployments.remove(deployment)            // Delete deployment
```

### Domains

```typescript
ship.domains.set(name, options?)  // Create/update domain (see below)
ship.domains.get(name)            // Get domain details
ship.domains.list()               // List all domains
ship.domains.remove(name)         // Delete domain
ship.domains.validate(name)       // Pre-flight: check if domain is valid and available
ship.domains.verify(name)         // Trigger async DNS verification
ship.domains.dns(name)            // Get DNS provider information
ship.domains.records(name)        // Get required DNS records
ship.domains.share(name)          // Get shareable domain hash
```

### Tokens

```typescript
ship.tokens.create({ ttl?, labels? })  // Create deploy token
ship.tokens.list()                     // List all tokens
ship.tokens.remove(token)             // Revoke token
```

### Account

```typescript
ship.account.get()  // Get current account
```

### domains.set() Behavior

`domains.set()` is a single upsert endpoint. Omitted fields are preserved on update and defaulted on create:

```typescript
// Reserve domain (no deployment yet)
ship.domains.set('www.example.com');

// Link domain to deployment
ship.domains.set('www.example.com', { deployment: 'happy-cat-abc1234.shipstatic.com' });

// Switch to a different deployment (atomic)
ship.domains.set('www.example.com', { deployment: 'other-deploy-xyz7890.shipstatic.com' });

// Update labels only (deployment preserved)
ship.domains.set('www.example.com', { labels: ['prod', 'v2'] });

// Update both
ship.domains.set('www.example.com', { deployment: 'happy-cat-abc1234.shipstatic.com', labels: ['prod'] });
```

**No unlinking:** Once a domain is linked, `{ deployment: null }` returns a 400 error. To take a site offline, deploy a maintenance page. To clean up, delete the domain.

**Domain format:** Domain names are FQDNs. The SDK accepts any format (case-insensitive, Unicode) — the API normalizes:

```typescript
ship.domains.set('WWW.Example.COM');  // → normalized to 'www.example.com'
ship.domains.set('www.münchen.de');   // → Unicode supported
```

### Deploy Options

```typescript
ship.deploy('./dist', {
  labels?: string[],         // Labels for the deployment
  onProgress?: (info) => void,  // Progress callback
  signal?: AbortSignal,      // Cancellation
  pathDetect?: boolean,      // Auto-optimize paths (default: true)
  spaDetect?: boolean,       // Auto-detect SPA (default: true)
  maxConcurrency?: number,   // Concurrent uploads (default: 4)
  timeout?: number,          // Request timeout (ms)
  via?: string,              // Client identifier (e.g. 'sdk', 'cli')
  apiKey?: string,           // Per-request API key override
  deployToken?: string,      // Per-request deploy token override
})
```

### Events

```javascript
ship.on('request', (url, init) => console.log(`→ ${url}`));
ship.on('response', (response, url) => console.log(`← ${response.status}`));
ship.on('error', (error, url) => console.error(error));

// Remove listeners
ship.off('request', handler);
```

### Error Handling

```javascript
import { isShipError } from '@shipstatic/types';

try {
  await ship.deploy('./dist');
} catch (error) {
  if (isShipError(error)) {
    if (error.isAuthError()) { /* ... */ }
    if (error.isValidationError()) { /* ... */ }
    if (error.isNetworkError()) { /* ... */ }
  }
}
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  ShipClientOptions,
  DeploymentOptions,
  ShipEvents
} from '@shipstatic/ship';

import type {
  Deployment,
  Domain,
  Account,
  StaticFile
} from '@shipstatic/types';
```

## AI Agents

This package includes a [SKILL.md](./SKILL.md) file — a portable skill definition that AI agents (Claude Code, Codex, OpenClaw, etc.) use to deploy sites with `ship` autonomously.

---

Part of the [ShipStatic](https://shipstatic.com) platform.
