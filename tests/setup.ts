/**
 * @file Suite-wide hermeticity — loaded by BOTH the `unit` and `integration`
 * projects. The mock-server lifecycle lives in `setup-server.ts`, which only
 * the `integration` project loads.
 *
 * Two invariants, enforced here rather than by convention:
 *
 *   1. No ambient credentials. In Node the SDK reads `SHIP_TOKEN` /
 *      `SHIP_API_URL` from the process environment, so a developer who has
 *      exported either would silently authenticate the suite's "anonymous"
 *      paths — and aim them somewhere real.
 *   2. No outbound network. `DEFAULT_API` is the production API, so a missing
 *      mock route or a forgotten `apiUrl` reaches PRODUCTION rather than
 *      failing. Anything that is not loopback fails loudly, naming the URL.
 */

// -----------------------------------------------------------------------------
// 1. Scrub ambient credentials
// -----------------------------------------------------------------------------

for (const key of Object.keys(process.env)) {
  if (key.startsWith('SHIP_')) delete process.env[key];
}

// -----------------------------------------------------------------------------
// 2. No-network guard
// -----------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const realFetch = globalThis.fetch;

/**
 * Throws synchronously rather than rejecting: real `fetch` never throws
 * synchronously, so a `fetch(...).catch(...)` chain cannot swallow this into a
 * plausible-looking network error. The offending test fails naming its URL.
 *
 * Tests that install their own transport are unaffected — a `vi.spyOn`,
 * `vi.stubGlobal`, or an injected `fetch` option replaces this wrapper.
 */
function assertLoopback(url: string): void {
  let hostname: string;
  try {
    // A relative URL (jsdom) resolves against the loopback base and passes.
    hostname = new URL(url, 'http://localhost/').hostname;
  } catch {
    hostname = 'localhost';
  }
  if (LOOPBACK_HOSTS.has(hostname)) return;
  throw new Error(
    `[no-network guard] blocked an outbound request to ${url}\n` +
      `Tests must never reach a real host. Point this call at the mock server ` +
      `(pass its URL as \`apiUrl\`), add the missing mock route, or stub \`fetch\` ` +
      `in the test itself. See tests/setup.ts.`,
  );
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  assertLoopback(url);
  return realFetch(input as RequestInfo, init);
}) as typeof globalThis.fetch;

// -----------------------------------------------------------------------------
// 3. Environment shims
// -----------------------------------------------------------------------------

// jsdom lacks Blob.prototype.arrayBuffer; every shipping runtime has it.
// Polyfill via FileReader so tests exercise the production code path.
if (typeof Blob !== 'undefined' && typeof (Blob.prototype as any).arrayBuffer !== 'function') {
  (Blob.prototype as any).arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this);
    });
  };
}
