/**
 * @file CLI-specific error UX utilities.
 *
 * Two pure functions: `toShipError` normalizes any thrown value into a typed
 * `ShipError` for the CLI's global error boundary; `getUserMessage` translates
 * a `ShipError` into the actionable string the CLI prints. Both are pure for
 * easy unit testing.
 *
 * Both serve the TEXT channel only. `--json` transmits `ShipError.toResponse()`
 * untouched — see `error()` in `utils.ts`, which owns both channels. There is
 * deliberately no JSON formatter here: a second serializer is exactly how the
 * `--json` error envelope drifted from the wire's in the first place.
 *
 * Distinct from `ShipError.fromFetchError` (in `@shipstatic/types`), which is
 * for HTTP fetch failures. The CLI's global handler also catches things like
 * Commander parse errors, runtime exceptions in user code, etc. — so it uses
 * `toShipError` and intentionally normalizes unknowns to `Business` (a client
 * error type) so `getUserMessage`'s `isClientError()` branch surfaces the
 * original message rather than swallowing it as a generic "server error".
 */

import { ErrorType, isShipError, ShipError } from '@shipstatic/types';

/**
 * Normalize any thrown value to a `ShipError` for the CLI error boundary.
 * Pass-through for existing `ShipError`s; wraps other Errors and unknowns
 * as `Business` so their message is preserved through `getUserMessage`.
 */
export function toShipError(err: unknown): ShipError {
  if (isShipError(err)) {
    return err;
  }
  if (err instanceof Error) {
    return ShipError.business(err.message);
  }
  return ShipError.business(String(err ?? 'Unknown error'));
}

/**
 * How a CLI user supplies a credential — the remedy, stated once.
 *
 * Two sentences offer it: the auth failure below, and the `--domain` preflight
 * in `index.ts`, which refuses before it uploads anything. They are different
 * messages about the same missing thing, so the advice is one fact with one
 * owner. It is also a fact with a recorded future — the device flow
 * (`CLAUDE.md`, "The device-flow future") adds a spelling to this list, and
 * this is where it will be added.
 */
export const CREDENTIAL_HINT = 'pass --token, set SHIP_TOKEN, or run ship config';

/**
 * CLI options relevant to error message generation.
 */
export interface ErrorOptions {
  /**
   * The credential the CLI resolved (flag > env > file) — not the raw
   * `--token` flag. Presence selects the "invalid or expired" auth message;
   * absence selects the "how to authenticate" one.
   */
  token?: string;
}

/**
 * Get actionable user-facing message from an error.
 * Transforms technical errors into helpful messages that tell users what to do.
 *
 * This is a pure function - given the same inputs, always returns the same output.
 * All error message logic is centralized here for easy testing and maintenance.
 *
 * The chain below is ORDER-SENSITIVE in exactly two places, and both are TIES
 * — an error matching two predicates, where the first arm to claim it wins.
 * Stated here because a tie is invisible at the arm that loses it:
 *
 *  - **auth before client.** `ShipError.authentication()` carries 401, and
 *    `isClientError()` reads any 4xx — so the client arm claims it too, and
 *    would relay the API's deliberately uninformative "Authentication failed"
 *    instead of naming the three ways to supply a credential.
 *  - **timeout before network.** A deadline is inside the network category by
 *    design (nothing was exchanged either way), so only the TYPE separates
 *    them; see that arm.
 *
 * Both are held by tests rather than by this comment — reorder either and
 * `error-handling.unit.test.ts` turns red. Maintenance is deliberately NOT in
 * this list: it matches no other predicate, so its position is clarity rather
 * than correctness.
 *
 * An ordered TABLE (the `SHAPES` / `FILE_RULES` move) is the answer if this
 * ever grows a third tie; recorded with that trigger in CLAUDE.md. It buys
 * nothing today — those tables exist to delete a SECOND statement of one
 * fact, and this chain has one reader.
 */
export function getUserMessage(err: ShipError, options?: ErrorOptions): string {
  // Auth errors - tell user what credentials to provide. FIRST, by the tie
  // above: a 401 is also a 4xx, so the client arm would otherwise claim it.
  if (err.isAuthError()) {
    if (options?.token) {
      return 'authentication failed: invalid or expired token';
    }
    return `authentication required: ${CREDENTIAL_HINT}`;
  }

  // A deadline of ours expired. It shares the network CATEGORY — nothing was
  // exchanged either way — so this arm must sit AHEAD of that one, and it
  // branches on the TYPE, which is the only thing that tells the two apart.
  // Until 2026-08-12 there was no type to branch on and the arm below claimed
  // it, so a deploy that hit its five-minute ceiling told the user to check
  // their Wi-Fi.
  //
  // The sentence is `fromFetchError`'s own ("<operation> timed out"), relayed
  // rather than rewritten: nothing was received, so the surface owns the
  // words, and they are already authored one layer down where the operation
  // name lives. No advice is appended — "try again" is half-false when the
  // client has already retried three times.
  if (err.isType(ErrorType.Timeout)) {
    return err.message;
  }

  // Network errors — the transport failed before any response existed, so
  // there is nothing of the API's to quote. (A URL-naming variant lived here
  // until 2026-07-27, reading `details.url`; nothing has ever set that field —
  // `ShipError.fromFetchError` carries `{ cause }` — so the branch was dead.)
  if (err.isNetworkError()) {
    return 'network error: could not reach the API. check your internet connection';
  }

  // Maintenance — a state, not a fault. The platform is closed on purpose, so
  // the API's sentence is the whole answer and it is relayed verbatim; the CLI
  // adds only the one thing the server cannot, where to watch for the
  // all-clear. Deliberately NOT the generic 5xx arm's "try again": that arm
  // advises a retry because it has nothing better to say, and here the message
  // itself says when.
  if (err.isType(ErrorType.Maintenance)) {
    return `${err.message.replace(/\.$/, '')} — check https://status.shipstatic.com`;
  }

  // Client-attributable — a client-fault type, or any 4xx status (the guard
  // reads both axes, so a status-derived `Api` at 404 lands here too). The
  // message was authored for the end user at the throw site, API or local
  // code alike, so it is shown verbatim.
  if (err.isClientError()) {
    return err.message;
  }

  // Server faults (5xx). The wire message is relayed like every other, because
  // the API leaves nothing to withhold: its global handler emits either a
  // deliberately authored sentence (a 503 naming what is unavailable) or a flat
  // generic, and sends the raw failure to its operator channel rather than to
  // the client. This
  // discarded it until 2026-07-29, so a 503 that named its cause arrived as
  // "server error: please try again" — the platform authored a message for the
  // user and one surface threw it away. The CLI ADDS the one thing it knows and
  // the server does not: where to look when it keeps happening.
  return `${err.message.replace(/\.$/, '')} — try again, or check https://status.shipstatic.com`;
}
