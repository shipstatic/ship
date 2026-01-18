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

# Deploy current directory
ship

# With tags
ship deployments create ./dist --tag production --tag v1.0.0

# Manage domains
ship domains list
ship domains set staging abc123
ship domains verify www.example.com

# Account info
ship account
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
await ship.domains.set('staging', result.deployment);
await ship.domains.list();
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
ship.deployments.create(input, options?)
ship.deployments.list()
ship.deployments.get(id)
ship.deployments.remove(id)

// Domains
ship.domains.set(name, deploymentId, tags?)
ship.domains.get(name)
ship.domains.list()
ship.domains.remove(name)
ship.domains.verify(name)

// Account
ship.account.get()

// Connectivity
ship.ping()
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
