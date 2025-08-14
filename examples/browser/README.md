# Shipstatic SDK – Browser Example

This example demonstrates how to use the Shipstatic SDK for deploying files and folders directly from the browser, with zero Node.js dependencies. It showcases the modern resource-based API with clean error handling and progress tracking.

## Features
- **Universal browser support**: Works with File objects, FileList, or HTMLInputElement
- **Bundle size optimized**: 422KB browser bundle
- **Modern class-based API**: `new Ship()` with resource methods
- **Clean UI/UX:**
  - Disables the deploy button during deployment
  - Real-time progress tracking
  - Comprehensive error handling
  - Auto-reset UI after deployment
- **Separation of concerns**: UI logic separate from SDK usage

## How to Use

1. **Rebuild the SDK (after making SDK changes):**
   ```sh
   cd ../../
   pnpm build
   cd examples/browser
   pnpm run copy
   ```

2. **Configure authentication:**
   You need to provide authentication credentials for the deployment to work. In the browser, you must set them directly:
   - Edit `main.js` and add credentials: `new Ship({ apiKey: 'ship-your-64-char-hex-string' })` or `new Ship({ deployToken: 'token-your-64-char-hex-string' })`
   - API keys start with `ship-` and are 69 characters total
   - Deploy tokens start with `token-` and are 70 characters total

3. **Start a local server:**
   ```sh
   pnpm start
   # or use your preferred static server:
   # python3 -m http.server
   ```

4. **Open `index.html` in your browser.**

## File Overview

- `index.html` – Minimal HTML UI for file selection and deployment
- `main.js` – Example usage of the Ship SDK in the browser
- `ship.js` – The browser bundle of the Ship SDK (copied from SDK build output)

## Customizing
- You can adapt the UI or integrate the deploy logic into your own app.
- The SDK provides a modern, class-based `Ship` API:

  ```js
  import Ship from './ship.js';
  // Authenticated deployments
  const ship = new Ship({ apiKey: 'ship-your-key' });
  // OR single-use deployments  
  const ship = new Ship({ deployToken: 'token-your-token' });
  
  // Deploy using resource-based API
  const result = await ship.deployments.create(files, { 
    // Common parent directories are removed by default
    // To preserve directory structure: preserveDirs: true
    onProgress: (progress) => console.log(`${progress}%`)
  });
  ```
- See comments in `main.js` for complete implementation details.

## Example UI

```
+-------------------------------+
| Shipstatic SDK - Browser Deploy |
+-------------------------------+
| [ Select Folder ] [Deploy]    |
|                               |
| Deploy progress: 42%          |
| Deploy successful!            |
| Your site is deployed at: ... |
+-------------------------------+
```

---

**For advanced usage or troubleshooting, see the main Shipstatic SDK documentation.**
