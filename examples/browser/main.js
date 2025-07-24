// Minimal browser deploy demo for Ship SDK
// - Demonstrates safe usage with zero Node.js dependencies
// - Clean UI/UX: disables button during deploy, resets UI, and handles errors
// - SDK usage and UI logic are clearly separated for clarity

import Ship from './ship.js';

const fileInput = document.getElementById('fileInput');
const deployButton = document.getElementById('deployButton');
const statusDiv = document.getElementById('status');

function setStatus(html, isError = false) {
  statusDiv.innerHTML = html;
  statusDiv.style.color = isError ? 'crimson' : '';
}

function resetUI() {
  fileInput.value = '';
  deployButton.disabled = false;
}

// Create a Ship client with progress reporting
let ship;

// Initialize the client synchronously on page load (class-based API)
try {
  ship = new Ship({
    // Note: API key should be set via environment variables or config files in production
    // For DEMO PURPOSES ONLY, you can set it here
    // apiKey: 'your-api-key-here'
  });
  console.log('Ship client initialized successfully');
} catch (err) {
  console.error('Failed to initialize Ship client:', err);
  setStatus('Failed to initialize deploy client. Please refresh the page.', true);
}

deployButton?.addEventListener('click', async () => {
  // Validate file input
  if (!fileInput?.files?.length) {
    setStatus('Please select files or a folder to deploy.', true);
    return;
  }
  
  // Update UI to show deploy in progress
  setStatus('Deploying...');
  deployButton.disabled = true;

  try {
    // Log the files being deployed for debugging
    console.log('Files to deploy:', Array.from(fileInput.files).map(f => ({
      name: f.name,
      webkitRelativePath: f.webkitRelativePath || 'N/A'
    })));
    
    // Deploy using the unified API - resource-based approach
    // Ship now automatically removes common parent directories by default
    // If you want to preserve directory structure, you can use preserveDirs: true
    const result = await ship.deployments.create(fileInput.files, { 
      // No flag needed as flattening is now the default behavior
      onProgress: (progress) => {
        setStatus(`Deploy progress: ${Math.round(progress)}%`);
      }
    });
    
    // Success case - returns a Deployment object with URL
    const url = result.url;
    setStatus(`
      <p>Deploy successful!</p>
      <p>Your site is deployed at: <a href="${url}" target="_blank">${url}</a></p>
      <p>Deployment ID: ${result.deployment}</p>
      <p>Files deployed: ${result.filesCount}</p>
      <p>Status: ${result.status}</p>
    `);
    
    // Log the full result for debugging
    console.log('Deployment result:', result);
    resetUI();
  } catch (error) {
    // Handle specific error types if needed
    console.error('Deploy error:', error);
    setStatus(`Deploy failed: ${error.message || String(error)}`, true);
    resetUI();
  }
});
