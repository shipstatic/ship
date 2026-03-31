---
name: ship
description: Static hosting via ShipStatic. Use when the user wants to deploy a website, upload files, manage deployments, set up domains, or publish static files to shipstatic.com.
metadata:
  openclaw:
    requires:
      env:
        - SHIP_API_KEY
      bins:
        - ship
    primaryEnv: SHIP_API_KEY
    emoji: "🚀"
    homepage: https://github.com/shipstatic/ship
    install:
      - kind: node
        package: "@shipstatic/ship"
        bins: [ship]
---

## Authenticate

```bash
ship config                    # Interactive — saves to ~/.shiprc
ship --api-key <key> ...       # Per-command
export SHIP_API_KEY=<key>      # Environment variable
```

Get an API key at https://my.shipstatic.com/settings

## Output Modes

Every command supports three output modes:

| Flag | Purpose | Use when |
|------|---------|----------|
| (default) | Human-readable text | Showing results to the user |
| `--json` | Raw JSON on stdout | Parsing output programmatically |
| `-q` | Key identifier only | Piping between commands |

Always use `--json` when you need to parse output. Always use `-q` when piping between commands.

Errors go to stderr in all modes. Exit code 0 = success, 1 = error.

## Deploy

```bash
ship ./dist                              # Deploy a directory or file
ship ./dist --json                       # Parse: {"deployment": "happy-cat-abc1234.shipstatic.com", ...}
ship ./dist -q                           # Outputs only: happy-cat-abc1234.shipstatic.com
ship ./dist --label v1.0 --label latest  # Labels (repeatable, replaces all existing)
```

Deployment IDs are their permanent URLs: `word-word-hash.shipstatic.com`. Always use the full ID (including `.shipstatic.com`) as the argument to other commands.

## Custom Domain Setup (full workflow)

```bash
# 1. Pre-flight check (exit 0 = valid, exit 1 = invalid)
ship domains validate www.example.com

# 2. Deploy and link in one pipe
ship ./dist -q | ship domains set www.example.com

# 3. Get the required DNS records (to show the user)
ship domains records www.example.com

# 4. After user configures DNS, trigger verification
ship domains verify www.example.com
```

In text mode, step 2 automatically prints the DNS records and a shareable setup link when creating a new external domain. In `--json` mode it does not — use `domains records` separately.

Additional setup helpers (external domains only):
```bash
ship domains dns www.example.com         # DNS provider name (where to configure)
ship domains share www.example.com       # Shareable setup link for the user
```

## Domain Types

| Type | Example | DNS required | Status |
|------|---------|-------------|--------|
| Internal subdomain | `my-site.shipstatic.com` | No | Instant (`success`) |
| Custom subdomain | `www.example.com` | Yes (CNAME + A) | Starts `pending` until DNS verified |

**Apex domains are not supported.** Always use a subdomain: `www.example.com`, not `example.com`. The A record exists only to redirect `example.com` to `www.example.com`.

## Domain Operations

`domains set` is an upsert — creates if new, updates if exists:

```bash
ship domains set www.example.com                  # Reserve (no deployment)
ship domains set www.example.com <deployment>      # Link to deployment
ship domains set www.example.com <other-dep>       # Switch (instant rollback)
ship domains set www.example.com --label prod      # Update labels
```

`domains set` reads deployment from stdin when piped:
```bash
ship ./dist -q | ship domains set www.example.com
```

`domains validate` uses exit codes as the answer (the `grep`/`test` convention):
```bash
ship domains validate www.example.com -q && echo "valid" || echo "invalid"
# valid → exit 0, outputs normalized name
# invalid → exit 1, no output
```

## Important Behaviors

- **Labels replace, not append.** `--label foo --label bar` sets labels to `["foo", "bar"]`, removing any existing labels. To keep existing labels, include them in the command.
- **`records` quiet mode** outputs one record per line, space-separated: `TYPE NAME VALUE`. Parseable with awk: `ship domains records <name> -q | awk '{print $3}'` extracts values.
- **`domains list` text mode** does not show domain status. Use `--json` to see which domains are `pending` vs `success`.

## Command Reference

### Deployments

```bash
ship ./dist                          # Shortcut for deployments upload
ship deployments upload <path>       # Upload directory or file
ship deployments list                # List all deployments
ship deployments get <deployment>    # Show deployment details
ship deployments set <deployment>    # Update labels (--label)
ship deployments remove <deployment> # Delete permanently (async)
```

### Domains

```bash
ship domains list                     # List all domains
ship domains get <name>               # Show domain details
ship domains set <name> [deployment]  # Create, link, or update labels
ship domains validate <name>          # Pre-flight check (exit 1 if invalid)
ship domains records <name>           # Required DNS records (external only)
ship domains dns <name>               # DNS provider lookup (external only)
ship domains share <name>             # Shareable setup link (external only)
ship domains verify <name>            # Trigger DNS verification (external only)
ship domains remove <name>            # Delete permanently
```

### Account & Tokens

```bash
ship whoami                           # Account info
ship ping                             # API connectivity check
ship tokens create                    # Create deploy token (secret shown once)
ship tokens create --ttl 3600         # With expiry (seconds)
ship tokens list                      # List tokens (management IDs only)
ship tokens remove <token>            # Delete token
```

## Global Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output |
| `-q, --quiet` | Key identifier only |
| `--api-key <key>` | API key for this command |
| `--deploy-token <token>` | Single-use deploy token |
| `--label <label>` | Set label (repeatable, replaces all existing) |
| `--no-path-detect` | Disable build output auto-detection |
| `--no-spa-detect` | Disable SPA rewrite auto-configuration |
| `--no-color` | Plain text output |
| `--config <file>` | Custom config file path |

## Error Patterns

| Error | Meaning | Action |
|-------|---------|--------|
| `authentication required` | No credentials | Use `--api-key`, `--deploy-token`, or `ship config` |
| `authentication failed` | Invalid credentials | Check key/token validity |
| `not found` | Resource doesn't exist | Verify the ID/name |
| `path does not exist` | Deploy path invalid | Check the file/directory path |
| `invalid domain name` | Bad domain format | Must be a subdomain (e.g., `www.example.com`) |
| `DNS information is only available for external domains` | Used records/dns/share on `*.shipstatic.com` | Only custom domains need DNS setup |
| `DNS verification already requested recently` | Rate limited | Wait and retry |
