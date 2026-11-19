# Ship SDK Examples

Minimal examples demonstrating Ship SDK usage across different environments.
Every one deploys for real without an account.

## Available Examples

### [Node.js](./node/)
Deploy a directory from a script. In Node a deploy also takes paths, and walks
a folder recursively.
```js
const result = await ship.deployments.upload(['./dist']);
```

### [React](./react/)
Deploy files picked in the browser. React 19 on Vite.
```js
const result = await ship.deployments.upload(Array.from(files));
```

### [Vanilla JavaScript](./vanilla/)
The same thing with no framework and no bundler — one ES module.
```js
const result = await ship.deployments.upload(Array.from(files));
```

### [CLI](./cli/)
No code at all.
```bash
npx -y @shipstatic/ship ./dist
```

### [Credentials](./auth/)
How the one `token` slot works: the three populations, `setToken`, and
`TokenProvider` for credentials that must be minted per request.

## Quick Start

Every example follows the same shape:

```js
import Ship from '@shipstatic/ship';

// 1. Initialize. One credential slot — the prefix says which credential it is,
//    and the server classifies it. Omit it entirely and deploys still work:
//    they land in the public account with a claim URL and an expiry.
const ship = new Ship({ token: 'ship-your-api-key' });   // or 'deploy-your-token'

// 2. Deploy. `File` objects work everywhere; Node also takes paths.
const result = await ship.deployments.upload(input, {
  labels: ['production', 'v1.0.0'],
});

// 3. Read the answer.
console.log(`Deployed: ${result.url}`);
if (result.claim) console.log(`Claim: ${result.claim}`);
```

In Node the SDK also reads `SHIP_TOKEN`, which is how most programs keep the
credential out of their source.

## Example Comparison

| Example | Environment | Credential | Deploy input |
|---------|-------------|------------|--------------|
| Node.js | Server | API key, usually via `SHIP_TOKEN` | `string \| string[]` (paths) |
| React | Browser | Deploy token | `File[]` |
| Vanilla | Browser | Deploy token | `File[]` |
| CLI | Terminal | API key, via `~/.shiprc` or `--token` | Path argument |
| Credentials | Server | — | — |

**A browser gets a deploy token, never an API key.** An API key grants full
account access to anyone who opens devtools; a deploy token is scoped to
deploys, revocable, and can carry a TTL. Both ride the same `token` slot.

## Two things that trip people up

- **`FileList` is not `File[]`.** In the browser, pass `Array.from(input.files)`.
  A raw `FileList` is refused with
  `A deploy takes a list of File objects. To publish the files of a file input, pass Array.from(input.files).`
- **There is no upload-progress callback.** `fetch` cannot observe upload
  progress, so the SDK does not pretend to. To bound a deploy, pass your own
  `signal` to it; `timeout` on the constructor bounds each request.

---

**Choose the example that matches your environment and start deploying.**
