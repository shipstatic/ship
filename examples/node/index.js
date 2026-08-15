import Ship from '@shipstatic/ship';

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry. Set SHIP_TOKEN
// in the environment and the SDK picks it up on its own, which is why this
// example needs no credential in its source.
const ship = new Ship({
  // token: 'ship-your-api-key',
});

const directory = process.argv[2] ?? '.';

try {
  console.log(`Deploying ${directory}...`);

  const result = await ship.deployments.upload([directory], {
    labels: ['production', 'v1.0.0'],
  });

  console.log(`Deployed: ${result.url}`);
  console.log(`Files:    ${result.files}`);
  console.log(`Labels:   ${result.labels?.join(', ') || 'none'}`);

  // Present only on an anonymous deploy — the URL that keeps the site.
  if (result.claim) {
    console.log(`Claim:    ${result.claim}`);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
