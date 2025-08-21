# Ship SDK - Vanilla JavaScript Example

The most minimal vanilla JavaScript application demonstrating Ship SDK usage.

## Quick Start

```bash
# Copy SDK build
npm run copy

# Start development server
npm start
```

## Usage

1. Select files or folder to deploy
2. Click "Deploy" 
3. See deployment progress and URL in status display

## Code

Just 34 lines of vanilla JavaScript showing Ship SDK integration:

```javascript
import Ship from './ship.js';

const fileInput = document.getElementById('fileInput');
const deployButton = document.getElementById('deployButton');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

const ship = new Ship({
  // deployToken: 'token-your-deploy-token-here'
});

deployButton?.addEventListener('click', async () => {
  const files = fileInput?.files;
  if (!files?.length) {
    setStatus('Please select files');
    return;
  }

  setStatus('Deploying...');

  try {
    const result = await ship.deployments.create(files, {
      onProgress: (progress) => {
        setStatus(`Deploy progress: ${Math.round(progress)}%`);
      }
    });
    setStatus(`Deployed: ${result.url}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});
```

That's it! Minimal vanilla JavaScript with simple DOM updates - no frameworks, no complex setup.
