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

The whole example is [`index.js`](./index.js).

## Notes

- **There is no upload-progress callback.** `fetch` cannot observe upload
  progress, so the SDK does not pretend to. To bound a deploy, pass your own
  `signal` to it; `timeout` on the constructor bounds each request.
- **In Node the input can be a path or paths** (`string | string[]`);
  directories are walked recursively. `File` objects work here too, as they do
  everywhere the SDK runs.
