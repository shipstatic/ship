# Ship SDK - Node.js Example

The most minimal Node.js application demonstrating Ship SDK usage.

## Quick Start

```bash
# Install dependencies
npm install

# Deploy specific directory
npm start /path/to/directory
```

## Usage

1. Configure your API key in `index.js`
2. Run `npm start` to deploy
3. See deployment progress and URL in console output

## Code

Just 24 lines of Node.js code showing Ship SDK integration:

```javascript
const Ship = require('@shipstatic/ship');

async function deploy() {
  const directoryToDeploy = process.argv[2] || '.';
  
  const ship = new Ship({
    // apiKey: 'ship-your-key-here'
  });

  console.log('Deploying...');

  try {
    const result = await ship.deployments.create([directoryToDeploy], {
      labels: ['production', 'v1.0.0'],
      onProgress: ({ percent }) => {
        console.log(`Deploy progress: ${Math.round(percent)}%`);
      }
    });
    console.log(`Deployed: ${result.url}`);
    console.log(`Labels: ${result.labels?.join(', ') || 'none'}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

deploy();
```

That's it! Minimal Node.js code with simple console logging - no complex setup, no elaborate error handling.
