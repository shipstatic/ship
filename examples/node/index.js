const Ship = require("@shipstatic/ship");

async function deploy() {
  const directoryToDeploy = process.argv[2] || ".";

  const ship = new Ship({
    apiKey: 'ship-1d11faea37a531a65ea8e8dbad6814d300a6aa5de95a47d6559b7ae287221160'
  });

  console.log("Deploying...");

  try {
    const result = await ship.deployments.create([directoryToDeploy], {
      tags: ['production', 'v1.0.0'],
      onProgress: ({ percent }) => {
        console.log(`Deploy progress: ${Math.round(percent)}%`);
      },
    });
    console.log(`Deployed: ${result.url}`);
    console.log(`Tags: ${result.tags?.join(', ') || 'none'}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

deploy();
