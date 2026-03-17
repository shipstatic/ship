# @shipstatic/ship

Universal SDK and CLI for deploying static files to ShipStatic.

## Installation

```bash
# CLI (global)
npm install -g @shipstatic/ship

# SDK (project dependency)
npm install @shipstatic/ship
```

## CLI Usage

```bash
# Deploy a directory (shortcut)
ship ./dist

# Deploy with labels
ship ./dist --label production --label v1.0.0

# Disable automatic detection
ship ./dist --no-path-detect --no-spa-detect
```

### Deployments

```bash
ship deployments list
ship deployments upload <path>                    # Upload from file or directory
ship deployments upload <path> --label production # Upload with labels
ship deployments get <id>
ship deployments set <id> --label production      # Update labels
ship deployments remove <id>
```

### Domains

```bash
ship domains list
ship domains set staging                          # Reserve domain (no deployment yet)
ship domains set staging <deployment-id>          # Link domain to deployment
ship domains set staging --label production       # Update labels only
ship domains get staging
ship domains validate www.example.com             # Check if domain is valid and available
ship domains verify www.example.com               # Trigger DNS verification
ship domains remove staging
```

### Tokens

```bash
ship tokens list
ship tokens create --ttl 3600 --label ci
ship tokens remove <token>
```

### Account & Setup

```bash
ship whoami                      # Get current account (alias for account get)
ship account get
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
--no-path-detect          Disable automatic path optimization and flattening
--no-spa-detect           Disable automatic SPA detection and configuration
--no-color                Disable colored output
--json                    Output results in JSON format
--version                 Show version information
```

## SDK Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({
  apiKey: 'ship-your-api-key'
});

// Deploy (shortcut)
const deployment = await ship.deploy('./dist');
console.log(`Deployed: ${deployment.url}`);

// Deploy with options
const deployment = await ship.deployments.upload('./dist', {
  labels: ['production', 'v1.0'],
  onProgress: ({ percent }) => console.log(`${percent}%`)
});

// Manage domains
await ship.domains.set('staging', { deployment: deployment.id });
await ship.domains.list();

// Update labels
await ship.deployments.set(deployment.id, { labels: ['production', 'v1.0'] });
await ship.domains.set('staging', { labels: ['live'] });
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
ship.deployments.upload(input, options?)  // Upload new deployment
ship.deployments.list()                   // List all deployments
ship.deployments.get(id)                  // Get deployment details
ship.deployments.set(id, { labels })      // Update deployment labels
ship.deployments.remove(id)              // Delete deployment
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
ship.domains.set('staging');

// Link domain to deployment
ship.domains.set('staging', { deployment: 'abc123' });

// Switch to a different deployment (atomic)
ship.domains.set('staging', { deployment: 'xyz789' });

// Update labels only (deployment preserved)
ship.domains.set('staging', { labels: ['prod', 'v2'] });

// Update both
ship.domains.set('staging', { deployment: 'abc123', labels: ['prod'] });
```

**No unlinking:** Once a domain is linked, `{ deployment: null }` returns a 400 error. To take a site offline, deploy a maintenance page. To clean up, delete the domain.

**Domain format:** Domain names are FQDNs. The SDK accepts any format (case-insensitive, Unicode) — the API normalizes:

```typescript
ship.domains.set('Example.COM', { deployment: 'abc' });  // → normalized to 'example.com'
ship.domains.set('münchen.de', { deployment: 'abc' });   // → Unicode supported
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
  subdomain?: string,        // Suggested subdomain
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

---

Part of the [ShipStatic](https://shipstatic.com) platform.
