# Ship SDK - Node.js Example

The most minimal Node.js application demonstrating Ship SDK usage.

## Quick Start

```bash
# Install dependencies
pnpm install

# Deploy a directory (defaults to the current one)
pnpm start /path/to/directory
```

No account and no credential are required. The site goes live immediately, and
the output includes a **claim URL** you can open to keep it permanently.

## Usage

1. Run `pnpm start [path]` to deploy
2. The console prints the live URL, the file count, and the labels
3. On an anonymous deploy it also prints the claim URL

To deploy into your own account instead, set `SHIP_TOKEN` — the SDK reads it
with no code change:

```bash
SHIP_TOKEN=ship-your-api-key pnpm start ./dist
```

That value is your API key. One credential, two names: the console mints it as
an *API key*, and every slot that carries it is called the *token*.

## Code

```javascript
import Ship from '@shipstatic/ship';

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry. Set SHIP_TOKEN
// in the environment and the SDK picks it up on its own.
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
```

## Notes

- **There is no upload-progress callback.** `fetch` cannot observe upload
  progress, so the SDK does not pretend to — a deploy is one multipart POST.
  To bound it, pass `timeout` to the constructor or your own `signal` to the
  deploy.
- **Node input is a path or paths** (`string | string[]`); directories are
  walked recursively. The browser SDK takes `File[]` instead.
