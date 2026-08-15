# Ship SDK Examples

Minimal examples demonstrating Ship SDK usage across different environments.

## ✅ Test Status
**596 tests passing** - Ship SDK is fully tested and production-ready.

## 📁 Available Examples

### [🌐 Vanilla JavaScript](./vanilla/)
Deploy files directly from the browser with vanilla JavaScript. No build system - just like including jQuery from a CDN.
```javascript
const result = await ship.deployments.upload(files);
```

### [⚛️ React](./react/)  
Deploy files from React applications.
```javascript
const result = await ship.deployments.upload(files);
```

### [⚡ Node.js](./node/)
Deploy directories from Node.js applications and scripts.
```javascript
const result = await ship.deployments.upload([directory]);
```

### [🚀 CLI](./cli/)
Deploy from the command line with simple commands.
```bash
ship ./dist
```

## 🎯 Quick Start

All examples follow the same minimal pattern:

```js
// 1. Initialize — one credential slot; the prefix says which credential it is
const ship = new Ship({ token: 'ship-your-api-key' });   // or 'deploy-your-token'

// 2. Deploy
const result = await ship.deployments.upload(input, {
  onProgress: (progress) => console.log(`Deploy progress: ${progress}%`)
});

// 3. Success
console.log(`Deployed: ${result.url}`);
```

## 📊 Example Comparison

| Example | Environment | Credential | Input Type |
|---------|-------------|------------|------------|
| Vanilla | Browser | deploy token | FileList |
| React | Browser | deploy token | FileList |
| Node.js | Server | API key | Directory paths |
| CLI | Terminal | API key | Directory paths |

---

**Choose the example that matches your environment and start deploying! 🚀**