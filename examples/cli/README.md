# Ship SDK - CLI Example

The most minimal CLI usage of ShipStatic. No project, no config file, nothing
to install if you do not want to.

## Quick Start

```bash
# Run it without installing anything
npx -y @shipstatic/ship ./dist

# Or install it once
npm install -g @shipstatic/ship
ship ./dist
```

## Usage

1. Run `ship [path]` to deploy — no account, no API key, nothing to configure
2. The terminal prints the live URL, plus a **claim link**
3. Open the claim link to keep the site permanently, or configure a token
   (environment, config file, or `--token`) so deploys land in your account
   from the start. That token is your API key — one credential, two names.

## Command Examples

```bash
# Deploy the current directory
ship .

# Deploy with a token (your API key)
ship ./dist --token ship-your-api-key

# Or set it once and forget it
export SHIP_TOKEN=ship-your-api-key
ship config                               # writes ~/.shiprc, owner-only

# Deploy with labels
ship ./dist --label production --label v1.0.0

# Deploy and serve it at a domain, in one command (needs a token)
ship ./dist --domain www.example.com

# Deploy something that expires on its own
ship ./dist --ttl 7d

# List deployments
ship deployments list

# Link a domain to an existing deployment
ship domains set www.example.com happy-cat-abc1234 --label prod

# Show the DNS records a custom domain needs
ship domains records www.example.com

# Check account and connectivity
ship whoami
ship ping
```

## Composing

`-q` prints only the identifier, which is the value you would pipe forward:

```bash
ship ./dist -q | ship domains set www.example.com
```

`--domain` does the same two calls in one process, which is the right shape for
CI — one exit code and one `--json` document:

```bash
ship ./dist --domain www.example.com --json
```

## Notes

- **A deploy needs no credential.** Anonymous deploys are public, expire, and
  come with a claim URL. Everything else — listing, domains, account — needs a
  token.
- **For CI, prefer a deploy token** (`ship tokens create --ttl 30d --label ci`)
  over your API key: it is scoped to deploys, revocable, and can expire on its
  own. Both ride the same `--token` slot.
- Run `ship --help` for the full command tree, or `ship completion install` to
  get tab completion in bash, zsh, or fish.
