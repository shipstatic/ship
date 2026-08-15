import Ship from '@shipstatic/ship';
import { useRef, useState } from 'react';

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry. A browser app
// should carry a deploy token rather than an API key: it is scoped to deploys,
// revocable, and can be given a TTL. Never ship an API key to a browser — it
// grants full account access to anyone who opens devtools.
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

      setStatus(
        [
          `Deployed: ${result.url}`,
          `Files:    ${result.files}`,
          result.claim && `Claim:    ${result.claim}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
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
      <br />
      <br />
      <button type="button" onClick={handleDeploy} disabled={isDeploying}>
        {isDeploying ? 'Deploying...' : 'Deploy'}
      </button>
      <pre>{status}</pre>
    </main>
  );
}
