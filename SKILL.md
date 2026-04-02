---
name: ship
description: Deploy static websites to ShipStatic. Use when the user wants to deploy a site, publish a website, upload to hosting, go live, set up a custom domain, manage deployments, or share a site URL. No account required — instant deployment. CLI (`ship`) and Node.js/browser SDK.
compatibility: Node.js >= 20. Install globally via npm: npm install -g @shipstatic/ship
metadata:
  openclaw:
    requires:
      bins:
        - ship
    emoji: "🚀"
    homepage: https://github.com/shipstatic/ship
    install:
      - kind: node
        package: "@shipstatic/ship"
        bins: [ship]
---

Deploy static sites. No account, no config — just ship it.

## Deploy

```bash
ship ./dist
```

Site is live. Output includes the URL and a claim link.

Pass a build output directory (e.g. `./dist`, `./build`, `./out`) or a single file. Ship strips the directory prefix for clean URLs — `dist/assets/app.js` serves at `/assets/app.js`. A single file keeps its name: `ship page.html` deploys as `/page.html`. Deploying a project root (contains `package.json`, `node_modules`) is rejected — build first, then deploy the output.

Without credentials, deployments are public and expire in 3 days. **Always show the user both the deployment URL and the claim link** — the claim link lets them keep the site permanently.

The deployment ID **is** the URL hostname. Use the full ID (e.g. `happy-cat-abc1234.shipstatic.com`) as the argument to all other commands. The site lives at `https://<deployment>`.

### Parsing output

```bash
ship ./dist --json
```

```json
{
  "deployment": "happy-cat-abc1234.shipstatic.com",
  "files": 12,
  "size": 348160,
  "status": "success",
  "config": false,
  "labels": [],
  "via": "cli",
  "created": 1743552000,
  "expires": 1743811200,
  "claim": "https://my.shipstatic.com/claim/abc123"
}
```

`claim` and `expires` only appear without credentials. With an API key, deployments are permanent.

### Piping

```bash
ship ./dist -q              # → happy-cat-abc1234.shipstatic.com
```

`-q` outputs only the identifier — use it when piping or scripting.

### Labels

```bash
ship ./dist --label v1.0 --label production
```

Labels **replace all existing**, not append. Include current labels to keep them.

### SPA routing

Ship auto-detects single-page apps from `index.html` content and configures client-side routing rewrites — all paths serve `index.html`. No action needed. Skipped if a `ship.json` config is already included in the deployment. Disable with `--no-spa-detect`.

## Authentication

Deploy works without credentials. Everything else requires an API key.

| Needs API key | No auth needed |
|---------------|----------------|
| Permanent deploys, domains, tokens, account | Deploy (public, 3-day TTL) |

```bash
export SHIP_API_KEY=<key>          # Environment variable (best for automation)
ship --api-key <key> ...           # Per-command override
ship config                        # Interactive setup → ~/.shiprc (requires TTY)
```

Deploy tokens (`--deploy-token`) are single-use — consumed after one successful deploy. For CI/CD one-shot workflows.

Free API key: https://my.shipstatic.com/api-key

## Custom Domains

Requires an API key. Full workflow:

```bash
# 1. Validate
ship domains validate www.example.com

# 2. Deploy + link in one pipe
ship ./dist -q | ship domains set www.example.com

# 3. Show DNS records to the user
ship domains records www.example.com

# 4. After user configures DNS → verify
ship domains verify www.example.com
```

Step 2 auto-prints DNS records and a setup link in text mode. With `--json`, call `domains records` separately.

Verification is async — DNS propagation takes minutes to hours. Check status with `ship domains get <name> --json` and look for `"status": "success"`.

### Domain types

| Type | Example | DNS needed | Goes live |
|------|---------|------------|-----------|
| Internal | `my-site.shipstatic.com` | No | Instantly |
| Custom | `www.example.com` | CNAME + A | After DNS verified |

**No apex domains.** Always `www.example.com`, not `example.com`. The A record only redirects apex to www.

### Upsert operations

`domains set` creates if new, updates if exists:

```bash
ship domains set www.example.com                   # Reserve (no deployment yet)
ship domains set www.example.com <deployment>       # Link to deployment
ship domains set www.example.com <other-dep>        # Switch (instant rollback)
ship domains set www.example.com --label prod       # Update labels
```

Reads deployment from stdin when piped: `ship ./dist -q | ship domains set www.example.com`

**No unlinking.** Once linked, switch deployments or delete the domain. Setting deployment to null returns 400.

### Parsing domain output

```bash
ship domains set www.example.com <dep> --json
```

```json
{
  "domain": "www.example.com",
  "deployment": "happy-cat-abc1234.shipstatic.com",
  "status": "pending",
  "labels": [],
  "created": 1743552000,
  "linked": 1743552000,
  "links": 1
}
```

```bash
ship domains records www.example.com --json
```

```json
{
  "domain": "www.example.com",
  "apex": "example.com",
  "records": [
    {"type": "A", "name": "@", "value": "76.76.21.21"},
    {"type": "CNAME", "name": "www", "value": "cname.shipstatic.com"}
  ]
}
```

### DNS helpers (custom domains only)

```bash
ship domains dns www.example.com                  # Provider name
ship domains share www.example.com                # Shareable setup link
ship domains records www.example.com -q           # TYPE NAME VALUE (one per line)
```

### Validation

Exit codes as the answer:

```bash
ship domains validate www.example.com -q && echo "valid" || echo "invalid"
```

Exit 0 = valid (outputs normalized name). Exit 1 = invalid (no output).

## Output Modes

Every command supports three modes:

| Flag | Output | When to use |
|------|--------|-------------|
| *(default)* | Human-readable | Showing results to the user |
| `--json` | JSON on stdout | Parsing programmatically |
| `-q` | Identifier only | Piping between commands |

Errors go to stderr in all modes. Exit 0 = success, 1 = error.

List commands return `{"<resource>s": [...], "cursor": null, "total": N}`. `domains list` text mode omits status — use `--json` to see `pending` vs `success`.

## Commands

### Deployments

```bash
ship ./dist                          # Deploy (shortcut)
ship deployments upload <path>       # Deploy (explicit)
ship deployments list                # List all
ship deployments get <deployment>    # Details
ship deployments set <deployment>    # Update labels (--label)
ship deployments remove <deployment> # Delete (async)
```

### Domains

```bash
ship domains list                     # List all
ship domains get <name>               # Details
ship domains set <name> [deployment]  # Create, link, or update
ship domains validate <name>          # Check validity (exit code)
ship domains records <name>           # Required DNS records
ship domains dns <name>               # DNS provider lookup
ship domains share <name>             # Shareable setup link
ship domains verify <name>            # Trigger DNS verification
ship domains remove <name>            # Delete
```

### Account & Tokens

```bash
ship whoami                           # Account info
ship ping                             # Connectivity check
ship tokens create                    # New deploy token (shown once)
ship tokens create --ttl 3600         # With expiry (seconds)
ship tokens list                      # List tokens
ship tokens remove <token>            # Revoke
```

## Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output |
| `-q, --quiet` | Identifier only |
| `--api-key <key>` | API key for this command |
| `--deploy-token <token>` | Single-use deploy token |
| `--label <label>` | Set label (repeatable, replaces all) |
| `--no-path-detect` | Skip build output auto-detection |
| `--no-spa-detect` | Skip SPA rewrite auto-configuration |
| `--no-color` | Disable colors |
| `--config <file>` | Custom config path |

## Errors

| Message | Cause | Fix |
|---------|-------|-----|
| `too many requests` | Rate limited | Wait, or set an API key |
| `authentication failed` | Bad credentials | Check key/token |
| `not found` | No such resource | Verify the ID/name |
| `path does not exist` | Bad deploy path | Check file/directory |
| `invalid domain name` | Not a subdomain | Use `www.example.com`, not `example.com` |
| `DNS information is only available for external domains` | DNS op on internal domain | Only custom domains need DNS |
| `DNS verification already requested recently` | Rate limited | Wait |
