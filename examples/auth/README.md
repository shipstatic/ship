# Ship SDK - Credentials Example

How the SDK's one credential slot works. No deploy, no network — it constructs
clients and prints what each shape does.

## Quick Start

```bash
pnpm install
pnpm start
```

## The one slot

The platform issues more than one kind of credential and they all travel the
same way: one `token` option, sent verbatim as `Authorization: Bearer`. The
value's **prefix** says which population it belongs to and the server
classifies it, so a client never declares what it is holding and there is no
precedence to reason about.

| Prefix | Credential | Lifetime and reach |
|---|---|---|
| `ship-` | API key | Durable, full account access, one per account |
| `deploy-` | Deploy token | Scoped to deploys, revocable, optional TTL |
| `oauth-` | OAuth access token | Delegated, short-lived |

There is no `apiKey` option and no `deployToken` option. There never has to be.

## What the example shows

1. **One slot, any population** — the same call site takes an API key or a
   deploy token.
2. **No token at all** — deploys still work and land in the public account with
   a claim URL and an expiry. Every other operation needs a credential. In Node
   the SDK also reads `SHIP_TOKEN`, which is how most programs keep the
   credential out of their source.
3. **`setToken()`** — swaps the credential on a live client; effective on the
   next request, no rebuild.
4. **`TokenProvider`** — pass a *function* when the credential must be minted
   or refreshed. The SDK calls it per request, so expiry and renewal stay with
   the caller that knows the rules.
5. **What the slot refuses, and where** — format is checked client-side so a
   malformed value fails before a round trip. A value with no known prefix is
   *not* malformed: it is the opaque population, forwarded untouched for the
   server to refuse.
6. **Empty string** — absence of intent, not a credential. `token: ''` is what
   an unset shell variable expands to, so the constructor falls through to
   `SHIP_TOKEN` rather than locking in a phantom. `setToken('')` is an explicit
   instruction that cannot be satisfied, so it throws.

## Choosing a lifetime

**Storage must not outlive the credential.**

| Storage | Lives for | Holds |
|---|---|---|
| `~/.shiprc` (CLI only) | Indefinitely | Durable tokens |
| `SHIP_TOKEN` | The process | Whatever its provisioner keeps fresh |
| Constructor arg / `TokenProvider` | One request | Anything, including hourly OAuth bearers |

A browser app should carry a **deploy token**, never an API key: an API key
grants full account access to anyone who opens devtools.

## Note on the sample values

The example builds well-formed sample credentials at runtime
(`` `ship-${'0'.repeat(32)}` ``) rather than writing key-shaped literals into
source. They are structurally valid and deliberately not real — the SDK checks
a credential's *shape*, and only the server can say whether one is *genuine*.
