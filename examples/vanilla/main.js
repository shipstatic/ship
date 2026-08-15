import Ship from './ship.js';

const fileInput = document.getElementById('fileInput');
const deployButton = document.getElementById('deployButton');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry. A browser app
// should carry a deploy token rather than an API key: it is scoped to deploys,
// revocable, and can be given a TTL. Never ship an API key to a browser — it
// grants full account access to anyone who opens devtools.
const ship = new Ship({
  // token: 'deploy-your-token',
});

deployButton?.addEventListener('click', async () => {
  const files = fileInput?.files;
  if (!files?.length) {
    setStatus('Please select files');
    return;
  }

  deployButton.disabled = true;
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
        // Present only on an anonymous deploy — the URL that keeps the site.
        result.claim && `Claim:    ${result.claim}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    deployButton.disabled = false;
  }
});
