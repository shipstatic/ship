/**
 * @file SDK-specific type definitions
 * Consolidates all Ship SDK types into a single file for clarity.
 * Core types come from @shipstatic/types, while SDK-specific types are defined here.
 */

import type { DeploymentUploadOptions, DeploymentViaType } from '@shipstatic/types';

// Re-export all types from @shipstatic/types for convenience.
export * from '@shipstatic/types';

// =============================================================================
// DEPLOYMENT OPTIONS
// =============================================================================

/**
 * Universal deploy options for both Node.js and Browser environments.
 * Extends the API contract (DeploymentUploadOptions) with SDK-specific options.
 */
export interface DeploymentOptions extends DeploymentUploadOptions {
  /**
   * An AbortSignal to allow cancellation of the deploy operation. The one
   * cancellation mechanism — abort the signal and the request rejects with
   * a typed `Cancelled` error. Request timeouts are a client concern
   * (`ShipClientOptions.timeout`), not a per-deploy one.
   */
  signal?: AbortSignal;
  /** Whether to auto-detect and optimize file paths by flattening common directories. Defaults to true. */
  pathDetect?: boolean;
  /** Whether to auto-detect SPAs and generate ship.json configuration. Defaults to true. */
  spaDetect?: boolean;
}

export type ApiDeployOptions = Omit<DeploymentOptions, 'pathDetect'>;

/**
 * Context passed to the deploy body creator — everything that becomes a
 * form field alongside the files themselves.
 */
export interface DeployBodyContext {
  /**
   * Deployment labels for categorization. Each label must satisfy
   * `LABEL_CONSTRAINTS` (length and pattern, lowercased+trimmed).
   */
  labels?: string[];
  /**
   * Which client is deploying — the same closed vocabulary the public option
   * carries, not a second `string`. This context receives an already-narrowed
   * value and passed it on widened, which made the narrowing stop one seam
   * short of the wire.
   */
  via?: DeploymentViaType;
  /**
   * Optional plaintext password to protect the deployment.
   * Length: `PASSWORD_CONSTRAINTS.MIN_LENGTH` to `PASSWORD_CONSTRAINTS.MAX_LENGTH`
   * characters. Whitespace is preserved verbatim — significant.
   */
  password?: string;
  /**
   * Requested lifetime in SECONDS — a duration, never an instant, bounded by
   * `TTL_CONSTRAINTS`. The API stamps the expiry against its own clock.
   */
  ttl?: number;
  /** @internal Server-side processing flags. */
  flags?: { build?: boolean; prerender?: boolean; spa?: boolean };
  /** @internal reCAPTCHA proof for the anonymous human deploy channel (/upload). */
  captcha?: string;
}

// =============================================================================
// CLIENT CONFIGURATION
// =============================================================================

/** Standard `fetch` signature — the type of the `fetch` client option. */
export type Fetch = typeof fetch;

/**
 * Supplies the client token per request — synchronously or asynchronously.
 * The provider owns freshness: callers holding short-lived credentials
 * (e.g. OAuth access tokens) refresh inside the provider; the SDK just asks.
 * A provider that yields nothing fails the request — a configured provider
 * is credential intent, and intent never degrades to an anonymous request.
 */
export type TokenProvider = () => string | Promise<string>;

/**
 * Options for configuring a `Ship` instance.
 * Sets the API host, the client credential, the request timeout, and the transport.
 */
export interface ShipClientOptions {
  /** Default API URL for the client instance. */
  apiUrl?: string | undefined;
  /**
   * The client credential — any platform token, sent verbatim as
   * `Authorization: Bearer <value>` on every request. The token's prefix says
   * what it is: `ship-` API key (durable, full account), `deploy-` deploy
   * token (deploy-scoped, revocable, optional TTL), anything else an opaque
   * pre-issued bearer such as an OAuth access token. The server classifies by
   * value — the client never has to say which kind it holds.
   *
   * Pass a {@link TokenProvider} function instead of a string when the token
   * must be minted or refreshed per request.
   *
   * Omitted entirely: deploys still work — they land in the public account
   * with a claim URL and an expiry; every other operation requires a token.
   */
  token?: string | TokenProvider | undefined;
  /**
   * Timeout in milliseconds for every API request made by this client
   * instance. Defaults to 30 seconds.
   *
   * With retries, this is the ceiling on an ATTEMPT rather than on the wall
   * clock — each attempt is an honest request and deserves the ceiling you
   * named, and {@link ShipClientOptions.maxRetries} is the lever on the total.
   * For a hard overall deadline, pass your own `signal`
   * (`AbortSignal.timeout(ms)`): the client never retries past a signal you
   * supplied.
   */
  timeout?: number | undefined;
  /**
   * How many times to retry a failed request. Defaults to 2 (three attempts);
   * `0` disables retrying entirely.
   *
   * Retried: transport failures (including a timeout — nothing was exchanged
   * either way) and 500/502/503/504, with full-jitter exponential backoff.
   *
   * NOT retried, each deliberately: a maintenance 503 (a state, not a fault —
   * its message says when to come back), 429 (the rate limiter has just
   * answered), anything stopped by a `signal` you supplied, and any request
   * that cannot be safely repeated — `PUT`/`DELETE` are excluded outright, and
   * other non-`GET` methods retry only when they carry an `Idempotency-Key`,
   * which is what lets a deploy replay its stored result instead of creating a
   * second one.
   */
  maxRetries?: number | undefined;
  /**
   * When true, the client authenticates with the first-party cookie session
   * (`AuthMethod.SESSION`) — requests are sent with `credentials: 'include'`
   * and carry no `Authorization` header. For browser apps living on the
   * platform's own domains, where the API sets HTTP-only session cookies.
   * Mutually exclusive with `token`: a client holds one identity.
   *
   * Requires a cookie-capable transport. Browsers send first-party cookies
   * natively; in Node, pair it with an injected `fetch` that forwards the
   * session cookie (the default fetch has no cookie jar, and `session: true`
   * deliberately suppresses the `SHIP_TOKEN` fallback — a session client
   * never silently switches identity).
   */
  session?: boolean | undefined;
  /**
   * Custom `fetch` implementation. Defaults to `globalThis.fetch`.
   *
   * Use to inject a Cloudflare service-binding `Fetcher`
   * (`env.API.fetch.bind(env.API)`) for Worker-to-Worker calls, to wrap
   * requests with tracing/retries/signing, or to mock in tests.
   */
  fetch?: Fetch | undefined;
  /**
   * Caller identifier for multi-tenant orchestration — sent as `X-Caller`
   * on every request. Validated at construction against the shared `CALLER`
   * shape (`validateCaller` in `@shipstatic/types`: alphanumeric, dots,
   * underscores, hyphens; max 128 chars) — a value the API would silently
   * drop throws here instead.
   *
   * Used by orchestrators (e.g. the hosted MCP Worker processing many end
   * users from one egress) so the API's rate-limit buckets key per caller
   * rather than per shared IP. Instance identity metadata, like the
   * credential: one client speaks for one end user, and every write the
   * client makes is bucketed the same way. **Programmatic-only by design**
   * — there is no `--caller` CLI flag because every CLI invocation belongs
   * to one human; a per-tenant rate-limit bucket would defeat the purpose.
   *
   * Distinct from `via` (the client identifier — `'cli'`, `'sdk'`, `'web'`,
   * `'git'`, etc.). `via` is for analytics/origin tracking and is
   * env-overridable via `SHIP_VIA` for integrations that wrap the CLI
   * (GitHub Action, MCP). `caller` is for rate-limit isolation and stays
   * programmatic-only.
   */
  caller?: string | undefined;
  /**
   * Override the deploy endpoint path. Defaults to `/deployments`.
   *
   * @internal First-party hook used by `web/my` and `web/www` to target the
   * `/upload` route (which runs server-side build / SPA detection). External
   * SDK consumers must not set this — the `/deployments` endpoint is the
   * stable public contract. See `cloudflare/api/CLAUDE.md` for why the two
   * endpoints exist and what `/upload` does that `/deployments` doesn't.
   */
  deployEndpoint?: string | undefined;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Event map for Ship SDK events.
 *
 * **Every failure is visible, and the event NAME says whether it ended the
 * call.** One call emits `retry* (error | response)` — so the stream is
 * unambiguous at every prefix, and a consumer never has to wait to find out
 * what it is watching.
 *
 * `request` counts what went out; `retry` counts what failed and will be
 * tried again; `error` and `response` are the two terminal answers, exactly
 * one of which arrives.
 */
export interface ShipEvents {
  /** Emitted before each API request — once per ATTEMPT, so it counts what actually went out. */
  request: [url: string, init: RequestInit];
  /** Emitted after successful API response — once, on the attempt that worked. */
  response: [response: Response, url: string];
  /**
   * Emitted when an attempt failed and the client is going to try again.
   * Carries the same normalized `ShipError` the terminal `error` would, plus
   * `attempt` — the number of the attempt that just failed, counting from 1,
   * which matches the arithmetic the docs use ("two retries by default, so
   * three attempts"). Under that numbering the value reads both ways at once:
   * attempt N failing IS retry N, so `retry 1 of ${maxRetries}` needs no
   * adjustment.
   *
   * This event exists so `error` can keep meaning what it always meant. When
   * retries landed, `error` fired per attempt — honest about what happened,
   * but it silently redefined the event: a consumer seeing `error, error,
   * response` could not tell "failed, retrying" from "failed, terminally" at
   * any prefix, and counting `error`s no longer counted failed calls. Two
   * names, two meanings, and nothing lost: every failure is still announced.
   *
   * A failure the loop will NOT retry is terminal and emits `error` directly,
   * never this. So is an abort that lands mid-backoff.
   */
  retry: [error: Error, url: string, attempt: number];
  /**
   * Emitted when the CALL failed — terminally, exactly once. TWO populations
   * arrive here, which is why the type is `Error` and not `ShipError`:
   *
   *  - a failed request — always a `ShipError` (`executeRequest` normalizes
   *    every failure through `ShipError.fromFetchError` before emitting), so
   *    `isShipError(error)` narrows and `.type` / `.status` are readable;
   *  - a THROWING HANDLER of yours — `SimpleEvents.emit` evicts it and
   *    re-emits the raw failure here, which is a plain `Error`.
   *
   * Narrowing this to `ShipError` was tried on 2026-07-27 and reverted: it
   * made the second population a lie.
   */
  error: [error: Error, url: string];
}
