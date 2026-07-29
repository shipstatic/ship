/**
 * @file The `--json` error envelope — the CLI's machine-readable failure
 * contract, asserted across every code path that produces one.
 *
 * **The law: text translates, JSON transmits.** In `--json` mode the CLI emits
 * the platform's `ErrorResponse` verbatim — `error` is the `ErrorType`,
 * `message` is the wire's own sentence, `status` is the HTTP status. In text
 * mode it emits the CLI's actionable rewording instead. The two channels say
 * different things on purpose; what they may never do is disagree about the
 * SHAPE.
 *
 * Why this file exists: until 2026-07-29 `--json` emitted `{ error: <message> }`
 * — prose under the key the API, the SDK, and `@shipstatic/types` all reserve
 * for the type. An agent reading a CLI failure had nothing to branch on but the
 * sentence, in direct contradiction of the platform's own rule that clients
 * branch on `error` type / `status` and never on message strings. One emitter
 * was found and fixed; four more were producing the same inverted shape.
 *
 * So this fence asserts the envelope for EVERY producer rather than for the one
 * that was reported. The complement is a type-level guard: `error()` in
 * `utils.ts` is overloaded so a bare string cannot reach the JSON channel at
 * all, which is what keeps a SIXTH producer from being written.
 */

import { ErrorType } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { runProgram } from './harness';

const ERROR_TYPES = new Set<string>(Object.values(ErrorType));

/** Every field of `ErrorResponse`, and nothing else. */
const WIRE_KEYS = ['error', 'message', 'status', 'details'];

/**
 * Parse the single JSON document the CLI wrote to stderr and assert it is a
 * wire `ErrorResponse`. Returns it so a caller can assert the specifics.
 */
function assertWireError(stderr: string): { error: string; message: string; status?: number } {
  const parsed = JSON.parse(stderr.trim());
  const keys = Object.keys(parsed);

  // The key that carries the type. Prose here is the exact regression.
  expect(ERROR_TYPES).toContain(parsed.error);
  expect(typeof parsed.message).toBe('string');
  expect(parsed.message.length).toBeGreaterThan(0);
  // `message` holds the sentence; `error` never does.
  expect(parsed.error).not.toBe(parsed.message);

  // The envelope IS `ErrorResponse` — an added key is drift the same way a
  // missing one is.
  expect(keys).toEqual(expect.arrayContaining(['error', 'message']));
  expect(keys.filter((key) => !WIRE_KEYS.includes(key))).toEqual([]);

  return parsed;
}

describe('--json error envelope', () => {
  describe('every producer emits ErrorResponse', () => {
    it('the global error boundary — an API failure', async () => {
      const { stderr, exitCode } = await runProgram([
        'deployments',
        'get',
        'does-not-exist',
        '--json',
      ]);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.NotFound);
      expect(parsed.status).toBe(404);
      expect(exitCode).toBe(1);
    });

    it('the global error boundary — a missing credential', async () => {
      const { stderr } = await runProgram(['whoami', '--json'], { anonymous: true });

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Authentication);
      expect(parsed.status).toBe(401);
    });

    it('the parser — an unknown top-level command', async () => {
      const { stderr } = await runProgram(['not-a-command', '--json']);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Validation);
    });

    it('handleUnknownSubcommand — an unknown subcommand', async () => {
      const { stderr } = await runProgram(['domains', 'not-a-subcommand', '--json']);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Validation);
      expect(parsed.message).toContain('not-a-subcommand');
    });

    it('the preAction validator — a malformed API key', async () => {
      // Must be CLASSIFIABLE to reach the format rules: an unprefixed value is
      // a legal opaque bearer (an OAuth access token) and validates fine, so
      // it would test the API's 401 instead of the parse-time validator.
      const { stderr } = await runProgram(['whoami', '--json', '--token', 'ship-tooshort']);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Validation);
    });

    it('the preAction validator — a malformed API URL', async () => {
      const { stderr } = await runProgram(['whoami', '--json', '--api-url', 'not-a-url']);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Validation);
    });

    it('a transport failure, where no response ever existed', async () => {
      const { stderr } = await runProgram(['ping', '--json', '--api-url', 'http://127.0.0.1:1']);

      const parsed = assertWireError(stderr);
      expect(parsed.error).toBe(ErrorType.Network);
    });
  });

  /**
   * `ErrorResponse.status` is documented "(API contexts)". So the field is not
   * decoration on a 4xx-ish type — it is an HTTP fact, present exactly when an
   * exchange produced one. Getting this wrong is subtler than the prose-under-
   * `error` inversion it replaced: a fabricated 400 is a PLAUSIBLE lie.
   */
  describe("status is the wire's, so a local failure has none", () => {
    it.each([
      ['an unknown command', ['not-a-command', '--json']],
      ['an unknown subcommand', ['domains', 'not-a-subcommand', '--json']],
      ['an unsupported shell', ['completion', 'install', '--json']],
    ])('%s carries no status', async (_label, argv) => {
      const { stderr } = await runProgram(argv, { env: { SHELL: '/bin/csh' } });

      const parsed = assertWireError(stderr);
      expect(parsed).not.toHaveProperty('status');
    });

    it('but a failure the API answered carries its status', async () => {
      const { stderr } = await runProgram(['deployments', 'get', 'does-not-exist', '--json']);

      expect(assertWireError(stderr).status).toBe(404);
    });

    it('and a check that mirrors a server rule keeps the status it would send', async () => {
      // Dual validation: the API rejects this token shape too, so the error
      // must read the same whether the client or the server caught it.
      const { stderr } = await runProgram(['whoami', '--json', '--token', 'ship-tooshort']);

      expect(assertWireError(stderr).status).toBe(400);
    });
  });

  describe('the envelope is the wire, not a rewording of it', () => {
    it("carries the API message, not the CLI's actionable copy", async () => {
      // The auth case is where the two channels diverge most: text says
      // "authentication required: pass --token, set SHIP_TOKEN, or run ship
      // config", which is CLI vocabulary with no wire behind it. JSON must
      // carry what the API actually said.
      const json = await runProgram(['whoami', '--json'], { anonymous: true });
      const text = await runProgram(['whoami'], { anonymous: true });

      const parsed = assertWireError(json.stderr);
      expect(parsed.message).not.toContain('--token');
      expect(text.stderr).toContain('--token');
    });

    it('says nothing on stdout — a failure is stderr-only', async () => {
      const { stdout } = await runProgram(['deployments', 'get', 'does-not-exist', '--json']);
      expect(stdout).toBe('');
    });

    it('emits exactly one JSON document', async () => {
      const { stderr } = await runProgram(['deployments', 'get', 'does-not-exist', '--json']);
      expect(() => JSON.parse(stderr.trim())).not.toThrow();
    });
  });
});
