const Ship = require("@shipstatic/ship");

async function deploy() {
  const directoryToDeploy = process.argv[2] || ".";

  const ship = new Ship({
    // apiKey: 'ship-api-key-here'
  });

  console.log("Deploying...");

  try {
    const result = await ship.deployments.create([directoryToDeploy], {
      onProgress: (progress) => {
        console.log(`Deploy progress: ${Math.round(progress)}%`);
      },
    });
    console.log(`Deployed: ${result.url}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

deploy();
