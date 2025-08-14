# Ship SDK – Node.js Example

This example demonstrates how to use the Ship SDK for deploying files and folders from a Node.js environment. It showcases the modern resource-based API with automatic configuration loading and comprehensive error handling.

## Features
- **Zero configuration**: Automatic config loading from environment/files
- **Optimized bundle size**: 16KB Node.js bundle
- **Modern class-based API**: `new Ship()` with resource methods
- **Clean terminal UX:**
  - Real-time progress percentage
  - Colored error messaging
  - Clear success/failure status
- **Automatic file discovery**: Smart directory traversal and path handling

## How to Use

1. **Set up the example:**
   ```sh
   # Install dependencies (creates a symlink to the local SDK)
   pnpm install
   ```

2. **Configure the API key:**
   The SDK automatically loads configuration from (in priority order):
   - Environment variables: `SHIP_API_KEY=ship-your-key` and optionally `SHIP_API_URL`
   - Config files: `.shiprc` or `package.json` (ship property) in project directory
   - Direct constructor options: `new Ship({ apiKey: 'ship-your-key' })`
   - API keys must start with `ship-` and be 69 characters total

3. **Run the example:**
   ```sh
   # Deploy the current directory
   pnpm start
   
   # Deploy a specific directory
   pnpm start /path/to/directory
   ```

## File Overview

- `index.js` – Example usage of the Ship SDK in Node.js
- `package.json` – Dependencies and scripts configuration

## Customizing
- You can adapt the terminal output or integrate the deploy logic into your own app.
- The SDK provides a modern, class-based `Ship` API:

  ```js
  const { Ship } = require('@shipstatic/ship');
  const ship = new Ship(); // Auto-loads config from environment/files
  
  // Deploy using resource-based API
  const result = await ship.deployments.create([directory], { 
    // Path optimization is enabled by default (flattens common directories)
    // To preserve directory structure: pathDetect: false
    // SPA detection is also enabled by default (auto-generates ship.json)
    // To disable SPA detection: spaDetect: false
    onProgress: (progress) => console.log(`${progress}%`)
  });
  ```
- See comments in `index.js` for complete implementation details.

## Example Output

```
Initializing Ship client...
Ship client initialized successfully
Deploying directory: ./my-website...
Deploy progress: 100%

Deploy successful!
Your site is deployed at: https://your-deployment-id.shipstatic.dev
Deployment ID: your-deployment-id
Files deployed: 42
Status: success
```

## Implementation Details

- Automatically optimizes file paths by flattening common directories (default behavior)
- Use `pathDetect: false` option if you want to preserve directory structure
- Automatically detects SPAs and generates ship.json configuration (default behavior)
- Use `spaDetect: false` option to disable SPA detection
- Demonstrates proper async/await pattern with comprehensive error handling
- Shows real-time progress tracking with `onProgress` callback
- Implements clean error handling for both initialization and deploy errors
- Uses modern resource-based API (`ship.deployments.create()`) for consistency
- Automatic configuration loading with fallback hierarchy

---

**For advanced usage or troubleshooting, see the main Ship SDK documentation.**
