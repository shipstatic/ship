# Ship SDK - React Example

The most minimal React application demonstrating Ship SDK usage.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm start
```

## Usage

1. Select files or folder to deploy
2. Click "Deploy"
3. See deployment progress and URL in status display

## Code

Just 30 lines of React code showing Ship SDK integration with status logging:

```javascript
import { useRef, useState } from 'react';
import Ship from '@shipstatic/ship';

function App() {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState('');

  const handleDeploy = async () => {
    const files = fileInputRef.current?.files;
    if (!files?.length) {
      setStatus('Please select files');
      return;
    }

    const ship = new Ship({
      // token: 'your-token-here'
    });

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
  };

  return (
    <div>
      <h1>Ship SDK - React Example</h1>
      <input ref={fileInputRef} type="file" webkitdirectory multiple />
      <br /><br />
      <button onClick={handleDeploy}>Deploy</button>
      <div>{status}</div>
    </div>
  );
}
```

That's it! Minimal React code with simple status logging - no styling, no complex state management.
