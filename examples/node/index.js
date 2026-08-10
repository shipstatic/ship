const Ship = require('@shipstatic/ship');

async function deploy() {
  const directoryToDeploy = process.argv[2] || '.';

  const ship = new Ship({
    apiKey: 'ship-YOUR_API_KEY',
  });

  console.log('Deploying...');

  try {
    const result = await ship.deployments.upload([directoryToDeploy], {
      labels: ['production', 'v1.0.0'],
      onProgress: ({ percent }) => {
        console.log(`Deploy progress: ${Math.round(percent)}%`);
      },
    });
    console.log(`Deployed: ${result.url}`);
    console.log(`Labels: ${result.labels?.join(', ') || 'none'}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

deploy();
