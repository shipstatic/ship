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

2. **Configure the API key:**
   You need to provide an API key for the deployment to work. In the browser, you must set it directly:
   - Edit `main.js` and add the API key: `new Ship({ apiKey: 'ship-your-64-char-hex-string' })`
   - Ensure your API key starts with `ship-` and is 69 characters total

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
  const ship = new Ship({ apiKey: 'ship-your-key' });
  
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
