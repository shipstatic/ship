# Ship Static SDK – Browser Example

This example demonstrates how to use the Ship Static SDK for deploying files and folders directly from the browser with vanilla JavaScript. Perfect for adding deployment functionality to existing sites alongside jQuery or other libraries - no build system required.

## Features
- **Vanilla JavaScript**: No build system, bundlers, or complex setup required
- **Universal browser support**: Works with File objects, FileList, or HTMLInputElement
- **Zero configuration**: Just load the SDK like any other library
- **Modern ES modules**: Simple `import Ship from './ship.js'` syntax
- **Clean UI/UX:**
  - Disables the deploy button during deployment
  - Real-time progress tracking
  - Comprehensive error handling
  - Auto-reset UI after deployment
- **Separation of concerns**: UI logic separate from SDK usage

## How to Use

1. **Copy the latest SDK build:**
   ```sh
   # From the ship/examples/browser directory
   pnpm run copy
   ```
   This copies the latest browser build from `../../dist/browser.js` to `./ship.js`

2. **Configure authentication:**
   You need to provide authentication credentials for deployment to work. In the browser, you must set them directly:
   - Edit `main.js` and add credentials: `new Ship({ deployToken: 'token-your-deploy-token' })`
   - For reCAPTCHA-based deployments, fetch deploy tokens from your API
   - Deploy tokens start with `token-` and are 70 characters total
   - See the React/Vue/Angular examples for reCAPTCHA integration patterns

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
  
  // Initialize with deploy token
  const ship = new Ship({ deployToken: 'token-your-deploy-token' });
  
  // Deploy using resource-based API
  const result = await ship.deployments.create(files, { 
    // Path optimization enabled by default (flattens common directories)
    // To preserve directory structure: pathDetect: false
    // SPA detection enabled by default (auto-generates ship.json)
    // To disable SPA detection: spaDetect: false
    onProgress: (progress) => console.log(`${progress}%`)
  });
  ```
- See comments in `main.js` for complete implementation details.
- Check the `web/` directory for React/Vue/Angular examples with reCAPTCHA integration

## Example UI

```
+----------------------------------+
| Ship Static SDK - Browser Deploy |
+----------------------------------+
| [ Select Folder ] [Deploy]       |
|                                  |
| Deploy progress: 42%             |
| Deploy successful!               |
| Your site is deployed at: ...    |
+----------------------------------+
```

## Integration with Existing Sites

This example is perfect for adding deployment functionality to existing vanilla JavaScript sites:

```html
<!-- Add to your existing HTML -->
<script type="module">
  import Ship from './ship.js';
  
  // Your existing jQuery/vanilla JS code
  $('#deploy-btn').click(async () => {
    const ship = new Ship({ deployToken: 'your-token' });
    const result = await ship.deployments.create(files);
    console.log('Deployed to:', result.url);
  });
</script>
```

---

**For advanced usage or troubleshooting, see the main Ship SDK documentation.**
