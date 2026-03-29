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

## Install

Requires Node.js >= 20.

```bash
npm install -g @shipstatic/ship
```

## Authenticate

```bash
ship config
```

Enter your API key when prompted. Get one at https://my.shipstatic.com/settings

Alternative: set the `SHIP_API_KEY` environment variable or pass `--api-key` per command.

## Workflow 1 — Deploy

```bash
ship ./dist
ship ./dist --label production --label v1.0
ship ./dist --json   # Returns {"deployment": "happy-cat-abc1234.shipstatic.com", ...}
```

## Workflow 2 — Deploy and Link Domain

```bash
# Deploy and link in one pipe
ship ./dist -q | ship domains set www.example.com
```

## Workflow 3 — Reserve a Domain

```bash
# Pre-flight check
ship domains validate www.example.com

# Reserve (no deployment linked yet)
ship domains set www.example.com

# Or reserve an internal subdomain (instant, no DNS)
ship domains set my-site.shipstatic.com
```

Internal domains (`my-site.shipstatic.com`) are free and instant. Custom domains require DNS configuration — the CLI prints the required records.

**Apex domains are not supported.** Always use a subdomain: `www.example.com`, not `example.com`.

## Workflow 4 — Link Domain to Deployment

```bash
# Link domain to a deployment
ship domains set www.example.com <deployment>

# Switch to a different deployment (instant rollback)
ship domains set www.example.com <other-deployment>

# For custom domains: verify DNS after configuring records
ship domains verify www.example.com
```

## Reference

```bash
# Deployments
ship deployments list
ship deployments get <deployment>
ship deployments set <deployment> --label production
ship deployments remove <deployment>

# Domains
ship domains list
ship domains get <name>
ship domains validate <name>
ship domains verify <name>
ship domains remove <name>

# Account
ship whoami
ship ping
```

Use `--json` on any command for machine-readable output. Use `-q` for the key identifier only.
