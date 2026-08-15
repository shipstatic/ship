# Ship SDK - Vanilla JavaScript Example

The most minimal vanilla JavaScript application demonstrating Ship SDK usage.
No framework and no bundler — one ES module and a `<script type="module">`.

## Quick Start

```bash
# Build the SDK once, from the repo root of this package
cd ../.. && pnpm build && cd examples/vanilla

# Install the static server, then start
pnpm install
pnpm start
```

`pnpm start` copies `../../dist/browser.js` to `./ship.js` first (the `prestart`
script), so the bundle the page loads always matches the SDK you just built.

`ship.js` is a **build artifact and is gitignored.** It used to be committed,
which is exactly how this example came to serve a two-major-stale bundle: a
generated file that is regenerated on every run cannot drift, and a generated
file in git can only drift.

No account and no credential are required. The site goes live immediately, and
the status box shows a **claim URL** you can open to keep it permanently.

## Usage

1. Select a folder to deploy
2. Click **Deploy**
3. The status box shows the live URL, the file count, and the claim URL

## Code

```javascript
import Ship from './ship.js';

const fileInput = document.getElementById('fileInput');
const deployButton = document.getElementById('deployButton');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

// One credential slot. Leave it empty and the deploy still works — the site
// lands in the public account with a claim URL and an expiry.
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
    setStatus(`Deployed: ${result.url}`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    deployButton.disabled = false;
  }
});
```

## Notes

- **A browser gets a deploy token, never an API key.** An API key grants full
  account access to anyone who opens devtools. A [deploy token](https://docs.shipstatic.com/tokens)
  is scoped to deploys, revocable, and can carry a TTL. Both ride the same
  `token` slot — the prefix is what tells them apart.
- **`Array.from(files)` is required**, and this is the one mistake this example
  exists to prevent: `deployments.upload()` takes `File[]`, and a `FileList` is
  not an array. Passing one raises
  `Invalid input type for browser environment. Expected File[].`
- **There is no upload-progress callback.** `fetch` cannot observe upload
  progress, so the SDK does not pretend to.
