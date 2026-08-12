/**
 * @file The transport. It carries requests; it does not know what they mean.
 *
 * Headers, the credential, the timeout signal, the retry loop, the event
 * vocabulary and error normalization live here — everything that is true of
 * EVERY request this client makes. What is true of one request (its path, its
 * verb, its body, its response type) lives with the resource that names it,
 * in `resources.ts`.
 *
 * **That was two statements of one fact until 2026-08-12.** This class carried
 * eighteen endpoint methods — `getDomain`, `listTokens`, … — and every one of
 * them existed to be wrapped by a resource method of the same shape, because
 * this SDK mirrors the wire 1:1 by design. Two layers that are isomorphic BY
 * DESIGN are not two layers. The endpoints went down to the resources, and
 * "`ApiHttp` is pure transport" stopped being an aspiration in a doc.
 */
import {
  API_PATHS,
  CALLER,
  DEFAULT_API,
  ErrorType,
  IDEMPOTENCY_KEY_CONSTRAINTS,
  ShipError,
} from '@shipstatic/types';
import { SimpleEvents } from '../events.js';
import type { Fetch, ShipClientOptions } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_REQUEST_TIMEOUT = 30_000;

/**
 * Retries: two, so three attempts. The CLI's own 5xx message says "try again",
 * and the client should take its own advice before handing that sentence to a
 * person.
 *
 * `maxRetries` on `ShipClientOptions` is the one public knob (`0` disables) —
 * the name Stripe and OpenAI use, which is what earns it README surface under
 * this repo's doc-placement rule. No env var and no CLI flag: the CLI rides
 * the default, and a flag can be added the day someone asks.
 */
const DEFAULT_MAX_RETRIES = 2;

/** Full-jitter exponential backoff, in milliseconds. */
const RETRY_BASE_DELAY = 300;
const RETRY_MAX_DELAY = 2_000;

/**
 * The server faults worth trying again. 429 is deliberately absent: the
 * platform's rate limiter has just answered, and a client that auto-retries is
 * arguing with it. (Revisit only alongside honoring `Retry-After`, as its own
 * decision.)
 */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

/**
 * Sleep, unless the caller's signal says otherwise — so an abort mid-backoff
 * lands immediately instead of after the delay. Rejects with the signal's own
 * reason, which the caller's error path then classifies like any other.
 */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Deploys get their own ceilings, because one budget cannot fit every
 * operation this client performs.
 *
 * 30s is right for a metadata read — `/ping`, `/account`, a page of a list —
 * where anything slower is a fault rather than a big payload. A deploy is
 * bounded by the PLATFORM's limits instead: `DEPLOYMENT.MAX_TOTAL_SIZE` is
 * 50MB, and 50MB in 30s needs ~13 Mbit/s of sustained UPLOAD, above what most
 * residential links give. A deployment the API explicitly permits was being
 * aborted here by default — which is the exact failure `Idempotency-Key`
 * exists to repair, so the cause had to go and not merely the remedy.
 *
 * 5 minutes covers 50MB at ~1.4 Mbit/s.
 */
const DEFAULT_DEPLOY_TIMEOUT = 300_000;

/**
 * The server's own budget for a build, mirrored here because the client has
 * to outlast it: the API gives the build service
 * `PERFORMANCE.BUILD_SERVICE_TIMEOUT` (`cloudflare/api/src/lib/config.ts`),
 * and that work begins only after the upload lands.
 *
 * **Raising it there must raise it here.** The two sit in different repos, so
 * nothing can fence the pair; the constraint is stated at both ends instead.
 */
const BUILD_SERVICE_BUDGET = 300_000;

/**
 * A deploy that also builds: the upload, then the build, then the commit.
 *
 * Written as a sum rather than a number, so the name and the value compose
 * the same way — `DEPLOY` plus `BUILD` on one side, the deploy budget plus
 * the build budget on the other. A magic `600_000` would state the result
 * and hide the reasoning, and the reasoning is the part that has to survive
 * someone tuning either half.
 */
const DEFAULT_DEPLOY_BUILD_TIMEOUT = DEFAULT_DEPLOY_TIMEOUT + BUILD_SERVICE_BUDGET;

// =============================================================================
// TYPES
// =============================================================================

export interface ApiHttpOptions extends ShipClientOptions {
  /** Resolves the credential slot per request — async so token providers can mint/refresh. */
  getAuthHeaders: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface RequestResult<T> {
  data: T;
  status: number;
}

/**
 * The deploy's CARRIAGE — the two facts about a deploy that are transport's
 * rather than the deployment resource's.
 *
 * The numbers are transport's because a budget for how long to wait on a wire
 * is nothing else, and the endpoint is transport's because `deployEndpoint` is
 * a client option that redirects the route. The CHOICE between the two
 * ceilings is the resource's, because only it knows that `build`/`prerender`
 * wait on work the server does after the upload lands.
 */
export interface DeployTransport {
  /** `/deployments`, or `/upload` where the `@internal` option redirects it. */
  readonly endpoint: string;
  /** The ordinary deploy ceiling. */
  readonly timeout: number;
  /** The ceiling when the server will also build. */
  readonly buildTimeout: number;
}

/**
 * What a resource may ask of the transport: carry this request, and tell me
 * what came back.
 *
 * This interface is the whole seam. `resources.ts` states WHICH request — the
 * path, the verb, the body, the response type — and hands it here; nothing
 * above this line knows the base URL, the credential, the retry policy or the
 * event vocabulary, and nothing below knows what a domain is.
 */
export interface Transport {
  request<T>(
    path: string,
    options: ShipRequestInit,
    operationName: string,
    timeoutMs?: number,
  ): Promise<T>;
  requestWithStatus<T>(
    path: string,
    options: ShipRequestInit,
    operationName: string,
  ): Promise<RequestResult<T>>;
  readonly deploy: DeployTransport;
}

/**
 * A request as THIS client composes one.
 *
 * Identical to `RequestInit` but for the headers, which are narrowed from the
 * DOM's three-shaped `HeadersInit` to the one shape every call site here
 * actually builds. That narrowing is load-bearing twice over: `mergeHeaders`
 * used to reach its record through an `as` cast, and `hasIdempotencyKey` used
 * to walk all three shapes to find a key that only ever arrives in one of
 * them. Narrowing at RUNTIME instead would have turned an unreachable case
 * into a SILENT no-retry — a deploy that quietly stopped replaying because
 * someone handed the transport a `Headers`. Here that is a compile error.
 */
export type ShipRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

// =============================================================================
// HTTP CLIENT
// =============================================================================

export class ApiHttp extends SimpleEvents implements Transport {
  private readonly apiUrl: string;
  private readonly getAuthHeadersCallback: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  private readonly session: boolean;
  private readonly caller: string | undefined;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetch: Fetch;
  private globalHeaders: Record<string, string> = {};

  /** @see DeployTransport — the carriage facts the deployment resource reads. */
  readonly deploy: DeployTransport;

  constructor(options: ApiHttpOptions) {
    super();
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.getAuthHeadersCallback = options.getAuthHeaders;
    this.session = options.session ?? false;
    this.caller = options.caller;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    // Bind to globalThis when falling back to the platform `fetch` — browsers
    // require `this === window` on `window.fetch` and throw "Illegal invocation"
    // when it's invoked as a property of any other object.
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.deploy = {
      endpoint: options.deployEndpoint || API_PATHS.DEPLOYMENTS,
      // An explicit timeout is the caller's whole answer and applies to deploys
      // too — they asked for a ceiling, not for one with an exception. Only the
      // DEFAULT splits by operation.
      timeout: options.timeout ?? DEFAULT_DEPLOY_TIMEOUT,
      buildTimeout: options.timeout ?? DEFAULT_DEPLOY_BUILD_TIMEOUT,
    };
  }

  /**
   * Set global headers included in every request.
   * Priority: globalHeaders (lowest) < instance auth < per-request headers (highest)
   */
  setGlobalHeaders(headers: Record<string, string>): void {
    this.globalHeaders = headers;
  }

  // ===========================================================================
  // CORE REQUEST INFRASTRUCTURE
  // ===========================================================================

  /**
   * Execute an HTTP request, retrying the failures that are worth retrying.
   *
   * The loop lives here because `attemptOnce` is already the single wrap point
   * for headers, the timeout signal, the events and error normalization — so
   * an attempt is a whole request and nothing has to be undone between two.
   *
   * **Every failure is visible, and the event NAME says whether it ended the
   * call.** One call emits `retry* (error | response)`: `request` fires per
   * attempt, so a consumer counting requests sees what actually went out; a
   * failure that will be tried again is a `retry`; `error` and `response` are
   * the two terminal answers, exactly one of which arrives.
   *
   * The failure events are emitted HERE rather than in `attemptOnce`, and
   * that placement is the whole mechanism: terminality is a property of the
   * loop — of `isRetryable` and the attempt budget — so it is knowable only
   * at the one point that owns both. An attempt cannot name its own failure.
   *
   * **The caller's `timeout` governs an ATTEMPT, not the wall clock.** Each
   * attempt is an honest request and deserves the ceiling the caller named;
   * `maxRetries` is the lever on the total. A caller who wants a hard overall
   * deadline passes their own `signal` — see `isRetryable` for why that ends
   * the loop even when it is a timeout.
   */
  private async executeRequest<T>(
    url: string,
    options: ShipRequestInit,
    operationName: string,
    timeoutMs: number = this.timeout,
  ): Promise<RequestResult<T>> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attemptOnce<T>(url, options, operationName, timeoutMs);
      } catch (error) {
        // `attemptOnce` already normalized; this is a pass-through.
        const shipError = ShipError.fromFetchError(error, operationName);
        if (attempt >= this.maxRetries || !this.isRetryable(shipError, options)) {
          this.emit('error', shipError, url);
          throw shipError;
        }
        // Counting from 1: the attempt that just failed, which is also which
        // retry is about to happen. See `ShipEvents.retry`.
        this.emit('retry', shipError, url, attempt + 1);

        // Full jitter: `random() * min(cap, base * 2^n)`. Jitter matters more
        // than the curve — it is what stops a platform hiccup from returning
        // every client in lockstep.
        const ceiling = Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2 ** attempt);
        try {
          await sleep(Math.random() * ceiling, options.signal);
        } catch (aborted) {
          // The caller stopped us mid-backoff. Their reason, their error — and
          // terminal, so it is an `error` and not a second `retry`.
          const cancelled = ShipError.fromFetchError(aborted, operationName);
          this.emit('error', cancelled, url);
          throw cancelled;
        }
      }
    }
  }

  /**
   * Is this failure worth another attempt?
   *
   * Two axes, and both must say yes: what went wrong, and whether the request
   * is one that may be sent twice.
   */
  private isRetryable(error: ShipError, options: ShipRequestInit): boolean {
    // The caller's own signal fired — theirs to decide, whatever the reason.
    // This is what keeps a caller-supplied `AbortSignal.timeout()` working as
    // an OVERALL deadline, and it is the ONLY thing that does: a deadline
    // classifies as `Timeout`, which the loop retries on purpose, so on the
    // error alone a caller's ceiling would look exactly like ours and be
    // silently outlived. Nothing else in this function can tell them apart.
    if (options.signal?.aborted) return false;

    // A maintenance 503 is a STATE, not a fault. Its message says when to come
    // back, and retrying three times with backoff only delays that sentence
    // reaching the person who needs it.
    if (error.isType(ErrorType.Maintenance)) return false;

    // A user abort stops everything.
    if (error.isType(ErrorType.Cancelled)) return false;

    // Nothing was exchanged — `Network` (a refused connection, a DNS failure)
    // or `Timeout` (a deadline of ours expired) — or one of the server faults
    // above. Both retryable members are read through the CATEGORY rather than
    // named here: "nothing was exchanged" IS the retryability criterion, so a
    // future member of it should inherit this answer rather than wait for
    // someone to remember this line. Naming `Timeout` beside the guard that
    // already contains it would be a second owner of that membership, free to
    // disagree with the first. `@shipstatic/types` owns it; the timeout suite
    // pins that a deadline is retried.
    const worthRetrying =
      error.isNetworkError() || (error.status !== undefined && RETRYABLE_STATUS.has(error.status));
    if (!worthRetrying) return false;

    const method = (options.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return true;

    // PUT and DELETE are semantically idempotent here and still excluded: a
    // DELETE whose response was lost answers 404 on the retry, turning a
    // success into a reported failure. The classic hazard; stay out.
    if (method === 'PUT' || method === 'DELETE') return false;

    // Everything else needs the server's own replay guarantee. A deploy
    // carrying `Idempotency-Key` replays its stored 201, so a retry is safe by
    // construction rather than by assumption.
    return this.hasIdempotencyKey(options.headers);
  }

  /**
   * Did this request carry the header that makes a repeat safe?
   *
   * Case-insensitively, because HTTP field names are — the CLI's env tier and
   * the SDK option both spell it canonically, but a caller composing headers
   * by hand is entitled not to.
   */
  private hasIdempotencyKey(headers: ShipRequestInit['headers']): boolean {
    if (!headers) return false;
    const target = IDEMPOTENCY_KEY_CONSTRAINTS.HEADER.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
  }

  /**
   * One attempt: headers, timeout signal, the `request`/`response` events, and
   * error normalization.
   *
   * It does NOT emit a failure event. An attempt cannot know whether its own
   * failure ended the call — that is `executeRequest`'s question — so it
   * normalizes and throws, and the loop names what happened.
   */
  private async attemptOnce<T>(
    url: string,
    options: ShipRequestInit,
    operationName: string,
    timeoutMs: number = this.timeout,
  ): Promise<RequestResult<T>> {
    let cleanup = () => {};

    try {
      // Credential resolution runs inside the error boundary: a token
      // provider that throws or yields nothing fails the request through
      // the same typed path (and `error` event) as any transport failure.
      const headers = await this.mergeHeaders(options.headers);
      const timeout = this.createTimeoutSignal(options.signal, timeoutMs);
      cleanup = timeout.cleanup;

      const fetchOptions: RequestInit = {
        ...options,
        headers,
        credentials: this.session && !headers.Authorization ? 'include' : undefined,
        signal: timeout.signal,
      };

      this.emit('request', url, fetchOptions);

      const response = await this.fetch(url, fetchOptions);
      cleanup();

      if (!response.ok) {
        throw await ShipError.fromHttpResponse(response, operationName);
      }

      this.emit('response', this.safeClone(response), url);
      const data = await this.parseResponse<T>(this.safeClone(response));
      return { data, status: response.status };
    } catch (error) {
      cleanup();
      // Normalize anything thrown above (credential resolution, fetch
      // failure, abort, response error) into a ShipError.
      // fromFetchError passes existing ShipErrors through unchanged.
      throw ShipError.fromFetchError(error, operationName);
    }
  }

  /**
   * Send it; resolve what came back.
   *
   * Takes a PATH, not a URL: the base is this client's and nothing above needs
   * to know it. Twenty-two call sites wrote `${this.apiUrl}${API_PATHS.X}` by
   * hand before the endpoints moved out, which is twenty-two chances to
   * assemble it differently.
   */
  async request<T>(
    path: string,
    options: ShipRequestInit,
    operationName: string,
    timeoutMs?: number,
  ): Promise<T> {
    const { data } = await this.executeRequest<T>(
      `${this.apiUrl}${path}`,
      options,
      operationName,
      timeoutMs,
    );
    return data;
  }

  /**
   * The same, plus the HTTP status — for the one operation where the status IS
   * the answer: a domain upsert says create-or-update in its 201/200 and
   * nowhere else in the response.
   */
  async requestWithStatus<T>(
    path: string,
    options: ShipRequestInit,
    operationName: string,
  ): Promise<RequestResult<T>> {
    return this.executeRequest<T>(`${this.apiUrl}${path}`, options, operationName);
  }

  // ===========================================================================
  // REQUEST HELPERS
  // ===========================================================================

  private async mergeHeaders(
    customHeaders: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    // `caller` is instance identity metadata, like the credential: the
    // rate limiter buckets by X-Caller on every write, so it rides every
    // request rather than any single operation.
    return {
      ...this.globalHeaders,
      ...(this.caller ? { [CALLER.HEADER]: this.caller } : {}),
      ...(await this.getAuthHeadersCallback()),
      ...customHeaders,
    };
  }

  private createTimeoutSignal(
    existingSignal?: AbortSignal | null,
    timeoutMs: number = this.timeout,
  ): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();

    // The composed signal must say WHICH deadline fired. Both used to abort
    // bare, so the SDK's own timeout, a caller's abort and a caller's
    // `AbortSignal.timeout()` all arrived as `AbortError` and all classified
    // as `Cancelled` — "you cancelled this" for a deadline nobody set by hand.
    // An abort REASON survives fetch's rejection verbatim (captured across
    // Node, Bun and the three engines), so each keeps its own identity: ours
    // is a `TimeoutError` naming the ceiling, and the caller's is forwarded
    // untouched. `executeRequest` retries the first and never the second.
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, 'TimeoutError')),
      timeoutMs,
    );

    const forward = existingSignal ? () => controller.abort(existingSignal.reason) : undefined;
    if (existingSignal && forward) {
      existingSignal.addEventListener('abort', forward);
      if (existingSignal.aborted) controller.abort(existingSignal.reason);
    }

    return {
      signal: controller.signal,
      // The listener is removed, not just the timer: with retries a caller's
      // signal outlives the attempt, and one listener per attempt on a
      // long-lived signal is a leak that grows with every retry.
      cleanup: () => {
        clearTimeout(timeoutId);
        if (existingSignal && forward) existingSignal.removeEventListener('abort', forward);
      },
    };
  }

  private safeClone(response: Response): Response {
    try {
      return response.clone();
    } catch {
      return response;
    }
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.headers.get('Content-Length') === '0' || response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }
}
