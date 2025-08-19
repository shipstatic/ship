// Minimal Node.js deploy demo for Ship SDK
// - Demonstrates usage pattern in Node.js environment
// - Shows proper error handling and progress tracking
// - Uses the same core concepts as the browser example

// Import the Ship SDK using CommonJS require syntax
// Using the package name (@shipstatic/ship) which points to our local package via workspace
const Ship = require('@shipstatic/ship');

// Set up a simple command-line argument parser for directory to deploy
const args = process.argv.slice(2);
const directoryToDeploy = args[0] || '.';

// Status reporting functions (similar to browser UI updates)
function log(message, isError = false) {
  if (isError) {
    console.error(`\x1b[31m${message}\x1b[0m`); // Red text for errors
  } else {
    console.log(message);
  }
}

// Main deploy function
async function deployDirectory() {
  try {
    // Initialize client - configuration loaded automatically from environment or config files
    log('Initializing Ship client...');
    const ship = new Ship({
      // API key and URL are loaded automatically from:
      // - Environment variables (SHIP_API_KEY, SHIP_API)
      // - Config files (.shiprc, package.json ship property, etc.)
      // - You can also pass them explicitly: apiKey: 'your-key', apiUrl: 'https://api.shipstatic.com'
    });
    log('Ship client initialized successfully');
    
    // Validate input
    if (!directoryToDeploy) {
      log('Please provide a directory to deploy', true);
      process.exit(1);
    }
    
    // Show deploy starting
    log(`Deploying directory: ${directoryToDeploy}...`);
    
    try {
      // Deploy using the resource-based API
      // By default, Ship automatically optimizes paths and detects SPAs
      const result = await ship.deployments.create([directoryToDeploy], { 
        // pathDetect: false,  // Uncomment to preserve directory structure
        // spaDetect: false,   // Uncomment to disable SPA detection
        onProgress: (progress) => {
          process.stdout.write(`\rDeploy progress: ${Math.round(progress)}%`);
        }
      });
      
      // Success case - returns a Deployment object with URL
      log('\nDeploy successful!');
      log(`Your site is deployed at: ${result.url}`);
      log(`Deployment ID: ${result.deployment}`);
      log(`Files deployed: ${result.files}`);
      log(`Status: ${result.status}`);
      
      // Log full deployment result for reference
      console.log('\nFull deployment result:', JSON.stringify(result, null, 2));
    } catch (error) {
      // Handle deploy errors
      log('\nDeploy failed: ' + (error.message || String(error)), true);
      process.exit(1);
    }
  } catch (initError) {
    // Handle client initialization errors
    log('Failed to initialize Ship client: ' + initError.message, true);
    process.exit(1);
  }
}

// Execute the deploy function
deployDirectory().catch(err => {
  log(`Unexpected error: ${err.message || String(err)}`, true);
  process.exit(1);
});
