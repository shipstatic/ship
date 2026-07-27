/**
 * @file `node:http` adapter for `handleApiRequest` — a Request/Response bridge
 * and a real lifecycle. The wire truth lives entirely in `handler.ts`; nothing
 * here decides anything about the API.
 *
 * Three properties this file is responsible for:
 *
 *   **An ephemeral port.** `listen(0)`, so the OS picks. The previous server
 *   bound a fixed 13579 and treated `EADDRINUSE` as success — a second vitest
 *   run silently shared another process's state, and every reset became a
 *   no-op in one of them.
 *
 *   **A real close.** `cleanupMockServer` used to be `Promise.resolve()` under
 *   a comment reading "Never close".
 *
 *   **Per-file isolation.** Each test file gets its own server AND its own
 *   state, which is what makes `fileParallelism` safe.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { makeAccount } from '../fixtures/builders';
import { handleApiRequest } from './handler';
import { createMockState, type MockState } from './state';

let server: Server | null = null;
let baseUrl: string | null = null;
let state: MockState = createMockState(makeAccount);

/** The current per-file state — tests may seed it directly. */
export const mockState = () => state;

/** Base URL of the running mock server. Throws if it is not up. */
export function getMockServerUrl(): string {
  if (!baseUrl) throw new Error('Mock server is not running — is tests/setup-server.ts loaded?');
  return baseUrl;
}

/**
 * The handler as a `fetch`, for in-process tests that would rather inject the
 * SDK's published transport hook than talk to a socket.
 */
export const mockFetch: typeof globalThis.fetch = (input, init) =>
  handleApiRequest(new Request(input as RequestInfo, init), state);

// =============================================================================
// NODE HTTP BRIDGE
// =============================================================================

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    // GET/HEAD may not carry a body, even an empty one.
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer.length ? buffer : undefined);
}

// =============================================================================
// LIFECYCLE
// =============================================================================

export function setupMockServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (baseUrl) return resolve(baseUrl);

    server = createServer((req, res) => {
      void (async () => {
        try {
          const request = await toRequest(req, baseUrl ?? 'http://localhost');
          await writeResponse(await handleApiRequest(request, state), res);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'internal_server_error',
              message: error instanceof Error ? error.message : String(error),
              status: 500,
            }),
          );
        }
      })();
    });

    server.on('error', reject);
    // Port 0 — the OS assigns a free one, so nothing can collide.
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') return reject(new Error('no address'));
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve(baseUrl);
    });
  });
}

export function cleanupMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const closing = server;
    server = null;
    baseUrl = null;
    closing.closeAllConnections?.();
    closing.close(() => resolve());
  });
}

/** Fresh state between tests — a real reset, on state this process owns. */
export function resetMockServer(): void {
  state = createMockState(makeAccount);
}
