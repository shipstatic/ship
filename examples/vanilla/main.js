import Ship from './ship.js';

const fileInput = document.getElementById('fileInput');
const deployButton = document.getElementById('deployButton');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

const ship = new Ship({
  // deployToken: 'token-here'
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
      onProgress: ({ percent }) => {
        setStatus(`Deploy progress: ${Math.round(percent)}%`);
      }
    });
    setStatus(`Deployed: ${result.url}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
});
