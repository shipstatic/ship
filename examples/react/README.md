# Ship SDK - React Example

The most minimal React application demonstrating Ship SDK usage. React 19 on
Vite.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

No account and no credential are required. The site goes live immediately, and
the status box shows a **claim URL** you can open to keep it permanently.

## Usage

1. Select a folder to deploy
2. Click **Deploy**
3. The status box shows the live URL, the file count, and the claim URL

## Code

```jsx
import Ship from '@shipstatic/ship';
import { useRef, useState } from 'react';

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry.
const ship = new Ship({
  // token: 'deploy-your-token',
});

export default function App() {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);

  const handleDeploy = async () => {
    const files = fileInputRef.current?.files;
    if (!files?.length) {
      setStatus('Please select files');
      return;
    }

    setIsDeploying(true);
    setStatus('Deploying...');

    try {
      // `FileList` is not accepted — the SDK takes `File[]`.
      const result = await ship.deployments.upload(Array.from(files), {
        labels: ['production', 'v1.0.0'],
      });
      setStatus(`Deployed: ${result.url}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <main>
      <h1>Ship SDK - React Example</h1>
      <input ref={fileInputRef} type="file" webkitdirectory="" multiple />
      <button type="button" onClick={handleDeploy} disabled={isDeploying}>
        {isDeploying ? 'Deploying...' : 'Deploy'}
      </button>
      <pre>{status}</pre>
    </main>
  );
}
```

## Notes

- **A browser gets a deploy token, never an API key.** An API key grants full
  account access to anyone who opens devtools. A [deploy token](https://docs.shipstatic.com/tokens)
  is scoped to deploys, revocable, and can carry a TTL. Both ride the same
  `token` slot — the prefix is what tells them apart.
- **`Array.from(files)` is required.** `deploy()` and `deployments.upload()`
  take `File[]`; a raw `FileList` is not an array and is rejected.
- **There is no upload-progress callback.** `fetch` cannot observe upload
  progress, so the SDK does not pretend to.
- **`webkitdirectory=""`** turns the picker into a folder picker. Drop the
  attribute to select loose files instead; both take the same path.
