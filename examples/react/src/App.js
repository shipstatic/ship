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
      // deployToken: 'token-here'
    });

    setStatus('Deploying...');

    try {
      const result = await ship.deployments.create(files, {
        tags: ['production', 'v1.0.0'],
        onProgress: ({ percent }) => {
          setStatus(`Deploy progress: ${Math.round(percent)}%`);
        }
      });
      setStatus(`Deployed: ${result.url}\nTags: ${result.tags?.join(', ') || 'none'}`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div>
      <h1>Ship SDK - React Example</h1>
      <input ref={fileInputRef} type="file" webkitdirectory="true" multiple />
      <br /><br />
      <button onClick={handleDeploy}>Deploy</button>
      <br />
      <pre>{status}</pre>
    </div>
  );
}

export default App;
