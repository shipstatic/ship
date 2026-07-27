/**
 * @file SDK-specific type definitions
 * Consolidates all Ship SDK types into a single file for clarity.
 * Core types come from @shipstatic/types, while SDK-specific types are defined here.
 */

import type { DeploymentUploadOptions, ProgressInfo, StaticFile } from '@shipstatic/types';

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
  /** An AbortSignal to allow cancellation of the deploy operation. */
  signal?: AbortSignal;
  /** Callback invoked if the deploy is cancelled via the AbortSignal. */
  onCancel?: () => void;
  /** Maximum number of concurrent operations. */
  maxConcurrency?: number;
  /** Timeout in milliseconds for the deploy request. */
  timeout?: number;
  /** Whether to auto-detect and optimize file paths by flattening common directories. Defaults to true. */
  pathDetect?: boolean;
  /** Whether to auto-detect SPAs and generate ship.json configuration. Defaults to true. */
  spaDetect?: boolean;
  /** Callback for deploy progress with detailed statistics. */
  onProgress?: (info: ProgressInfo) => void;
}

export type ApiDeployOptions = Omit<DeploymentOptions, 'pathDetect'>;

/**
 * Prepared request body for deployment.
 * Created by platform-specific code, consumed by HTTP client.
 */
export interface DeployBody {
  body: FormData | ArrayBuffer;
  headers: Record<string, string>;
}

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
  /** Client identifier (`cli`, `sdk`, `web`). */
  via?: string;
  /**
   * Optional plaintext password to protect the deployment.
   * Length: `PASSWORD_CONSTRAINTS.MIN_LENGTH` to `PASSWORD_CONSTRAINTS.MAX_LENGTH`
   * characters. Whitespace is preserved verbatim — significant.
   */
  password?: string;
  /** @internal Server-side processing flags. */
  flags?: { build?: boolean; prerender?: boolean; spa?: boolean };
  /** @internal reCAPTCHA proof for the anonymous human deploy channel (/upload). */
  captcha?: string;
}

/**
 * Function that creates a deploy request body from files.
 * Implemented differently for Node.js and Browser.
 */
export type DeployBodyCreator = (
  files: StaticFile[],
  context?: DeployBodyContext,
) => Promise<DeployBody>;

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
 * Sets default API host, the client credential, progress callbacks, concurrency, and timeouts for the client.
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
   * Default callback for deploy progress for deploys made with this client.
   * @param info - Progress information including percentage and byte counts.
   */
  onProgress?: ((info: ProgressInfo) => void) | undefined;
  /**
   * Default for maximum concurrent deploys.
   * Used if an deploy operation doesn't specify its own `maxConcurrency`.
   * Defaults to 4 if not set here or in the specific deploy call.
   */
  maxConcurrency?: number | undefined;
  /**
   * Default timeout in milliseconds for API requests made by this client instance.
   * Used if an deploy operation doesn't specify its own timeout.
   */
  timeout?: number | undefined;
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
 * Event map for Ship SDK events
 * Core events for observability: request, response, error
 */
export interface ShipEvents {
  /** Emitted before each API request */
  request: [url: string, init: RequestInit];
  /** Emitted after successful API response */
  response: [response: Response, url: string];
  /**
   * Emitted when something fails. TWO populations arrive here, which is why
   * the type is `Error` and not `ShipError`:
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
