# @shipstatic/ship

Universal SDK and CLI for deploying static files to Shipstatic.

## Installation

```bash
# CLI (global)
npm install -g @shipstatic/ship

# SDK (project dependency)
npm install @shipstatic/ship
```

## CLI Usage

```bash
# Deploy a directory
ship ./dist

# Deploy with tags
ship ./dist --tag production --tag v1.0.0

# Deployments
ship deployments list
ship deployments get <id>
ship deployments set <id> --tag production      # Update tags
ship deployments remove <id>

# Domains
ship domains list
ship domains set staging <deployment-id>        # Point domain to deployment
ship domains set staging --tag production       # Update domain tags
ship domains get staging
ship domains verify www.example.com
ship domains remove staging

# Tokens
ship tokens list
ship tokens create --ttl 3600 --tag ci
ship tokens remove <token>

# Account
ship whoami
```

## SDK Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({
  apiKey: 'ship-your-api-key'
});

// Deploy
const result = await ship.deployments.create('./dist', {
  onProgress: ({ percent }) => console.log(`${percent}%`)
});

console.log(`Deployed: ${result.url}`);

// Manage domains
await ship.domains.set('staging', { deployment: result.deployment });
await ship.domains.list();

// Update tags
await ship.deployments.set(result.deployment, { tags: ['production', 'v1.0'] });
await ship.domains.set('staging', { tags: ['live'] });
```

## Browser Usage

```javascript
import Ship from '@shipstatic/ship';

const ship = new Ship({ apiKey: 'ship-your-api-key' });

// From file input
const files = Array.from(fileInput.files);
const result = await ship.deployments.create(files);
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

**Config files** (Node.js):
```json
// .shiprc or package.json "ship" key
{ "apiUrl": "...", "apiKey": "..." }
```

## API Reference

### Resources

```typescript
// Deployments
ship.deployments.create(input, options?)    // Create new deployment
ship.deployments.list()                      // List all deployments
ship.deployments.get(id)                     // Get deployment details
ship.deployments.set(id, { tags })           // Update deployment tags
ship.deployments.remove(id)                  // Delete deployment

// Domains
ship.domains.set(name, { deployment?, tags? })  // Create/update domain (see below)
ship.domains.get(name)                          // Get domain details
ship.domains.list()                             // List all domains
ship.domains.remove(name)                       // Delete domain
ship.domains.verify(name)                       // Trigger DNS verification

// Tokens
ship.tokens.create({ ttl?, tags? })          // Create deploy token
ship.tokens.list()                           // List all tokens
ship.tokens.remove(token)                    // Revoke token

// Account
ship.whoami()                                // Get current account

// Connectivity
ship.ping()                                  // Check API connectivity
```

### domains.set() Behavior

```typescript
// Point domain to deployment
ship.domains.set('staging', { deployment: 'abc123' });

// Point domain to deployment with tags
ship.domains.set('staging', { deployment: 'abc123', tags: ['prod'] });

// Update tags only (domain must exist)
ship.domains.set('staging', { tags: ['prod', 'v2'] });

// Error: must provide deployment or tags
ship.domains.set('staging', {});  // throws validation error
```

### Events

```javascript
ship.on('request', (url, init) => console.log(`→ ${url}`));
ship.on('response', (response, url) => console.log(`← ${response.status}`));
ship.on('error', (error, url) => console.error(error));
```

### Error Handling

```javascript
import { ShipError } from '@shipstatic/ship';

try {
  await ship.deployments.create('./dist');
} catch (error) {
  if (error instanceof ShipError) {
    if (error.isAuthError()) { /* ... */ }
    if (error.isValidationError()) { /* ... */ }
    if (error.isNetworkError()) { /* ... */ }
  }
}
```

## Bundle Sizes

- **Node.js**: 21KB
- **Browser**: 185KB
- **CLI**: 38KB

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  ShipOptions,
  DeployOptions,
  DeploySuccessResponse,
  ProgressInfo
} from '@shipstatic/ship';
```

---

Part of the [Shipstatic](https://shipstatic.com) platform.
