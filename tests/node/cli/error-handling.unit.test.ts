/**
 * @file Unit tests for CLI error handling.
 * Tests the pure functions extracted from index.ts for error message generation.
 * These are the critical tests that were missing - now we have direct coverage.
 */

import { ErrorType, ShipError } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import {
  type ErrorOptions,
  getUserMessage,
  toShipError,
} from '../../../src/node/cli/error-handling';

describe('CLI Error Handling', () => {
  describe('getUserMessage', () => {
    describe('4xx API errors', () => {
      it('should pass through 404 not found message', () => {
        const err = new ShipError(ErrorType.Api, 'Domain example.com not found', 404);
        const message = getUserMessage(err);
        expect(message).toBe('Domain example.com not found');
      });

      it('should pass through 400 validation message', () => {
        const err = new ShipError(ErrorType.Api, 'Label must be at least 3 characters', 400);
        const message = getUserMessage(err);
        expect(message).toBe('Label must be at least 3 characters');
      });

      it('should pass through 409 conflict message', () => {
        const err = new ShipError(ErrorType.Api, 'Domain already exists', 409);
        const message = getUserMessage(err);
        expect(message).toBe('Domain already exists');
      });
    });

    describe('authentication errors', () => {
      it('should show invalid token message when a token was provided', () => {
        const err = ShipError.authentication('Auth failed');
        const options: ErrorOptions = { token: 'ship-abc123' };

        const message = getUserMessage(err, options);

        expect(message).toBe('authentication failed: invalid or expired token');
      });

      it('should show auth required message when no token was provided', () => {
        const err = ShipError.authentication('Auth failed');

        const message = getUserMessage(err);

        expect(message).toBe(
          'authentication required: pass --token, set SHIP_TOKEN, or run ship config',
        );
      });
    });

    describe('network errors', () => {
      it('should show generic network message', () => {
        const err = ShipError.network('Network failed');

        const message = getUserMessage(err);

        expect(message).toBe(
          'network error: could not reach the API. check your internet connection',
        );
      });
    });

    describe('timeouts', () => {
      // A deadline shares the network CATEGORY, so its arm has to sit ahead of
      // the one above and branch on the TYPE. Until 2026-08-12 there was no
      // type to branch on: a deploy that hit its five-minute ceiling — the
      // slowest, most expensive failure this CLI produces — told the user to
      // check their Wi-Fi. `--json` was truthful throughout; only the human
      // channel lied.
      it('relays the deadline sentence instead of the connectivity advice', () => {
        const err = ShipError.timeout('Deploy timed out');

        const message = getUserMessage(err);

        expect(message).toBe('Deploy timed out');
        expect(message).not.toContain('internet connection');
      });

      it('appends no advice, because the client has already retried', () => {
        // "try again" is the 5xx arm's, and it is half-false here: three
        // attempts have been made by the time this sentence is composed.
        const message = getUserMessage(ShipError.timeout('Deploy timed out'));

        expect(message).not.toContain('try again');
        expect(message).not.toContain('status.shipstatic.com');
      });

      it('is caught by TYPE, never by reading the message', () => {
        // The platform's law is that clients branch on the type, so an error
        // that merely SAYS "timed out" must not reach this arm — a 504 the
        // API authored is a server fault and keeps the 5xx treatment.
        const gateway = new ShipError(ErrorType.Api, 'Upstream timed out', 504);

        expect(getUserMessage(gateway)).toBe(
          'Upstream timed out — try again, or check https://status.shipstatic.com',
        );
      });
    });

    describe('file errors', () => {
      it('should pass through file error message', () => {
        const err = ShipError.file('dist/index.html path does not exist', {
          filePath: 'dist/index.html',
        });

        const message = getUserMessage(err);

        expect(message).toBe('dist/index.html path does not exist');
      });
    });

    describe('validation errors', () => {
      it('should pass through validation error message', () => {
        const err = ShipError.validation("unknown command 'foo'");

        const message = getUserMessage(err);

        expect(message).toBe("unknown command 'foo'");
      });
    });

    describe('business/client errors', () => {
      it('should pass through business error message', () => {
        const err = ShipError.business('Invalid configuration');

        const message = getUserMessage(err);

        // Business errors are client errors and pass through
        expect(message).toBe('Invalid configuration');
      });

      it('should pass through forbidden error message', () => {
        const err = ShipError.forbidden('Account terminated');

        const message = getUserMessage(err);

        // Forbidden is a client error and passes through
        expect(message).toBe('Account terminated');
      });

      it('should pass through config error message', () => {
        const err = ShipError.config('Missing required field');

        const message = getUserMessage(err);

        expect(message).toBe('Missing required field');
      });
    });

    describe('server errors', () => {
      // A 5xx message is authored for the user like any other — the API emits
      // a deliberate sentence or a safe generic and sends the raw failure to
      // Slack, so the CLI relays it and appends the one thing it knows that
      // the server does not.
      it('relays the wire message for a server fault, adding where to look', () => {
        const err = ShipError.api('Internal server error', 500);

        const message = getUserMessage(err);

        expect(message).toBe(
          'Internal server error — try again, or check https://status.shipstatic.com',
        );
      });

      it('relays a deliberately authored 5xx rather than flattening it', () => {
        // The case that motivated this: a 503 that names its cause must not
        // arrive as an anonymous "server error".
        const err = new ShipError(ErrorType.Api, 'Content moderation is unavailable', 503);

        const message = getUserMessage(err);

        expect(message).toContain('Content moderation is unavailable');
      });
    });

    describe('maintenance', () => {
      // A closed platform is a STATE, not a fault, and the two neighbouring
      // arms would both mis-serve it: the generic 5xx one advises "try again"
      // (the message already says when), and `Api` at 503 is the platform's
      // OTHER 503 — a dependency that failed.
      it('relays the operator sentence and points at status, without advising a retry', () => {
        const err = ShipError.maintenance(
          'ShipStatic is briefly down for scheduled maintenance and will be back shortly.',
        );

        const message = getUserMessage(err);

        expect(message).toBe(
          'ShipStatic is briefly down for scheduled maintenance and will be back shortly — check https://status.shipstatic.com',
        );
        expect(message).not.toContain('try again');
      });

      it('is not read as a client fault, so the sentence is never swallowed', () => {
        const err = ShipError.maintenance('Back at 14:30 UTC.');

        expect(err.isClientError()).toBe(false);
        expect(getUserMessage(err)).toContain('Back at 14:30 UTC');
      });
    });

    describe('edge cases', () => {
      it('should handle error with empty details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, {});

        const message = getUserMessage(err);

        expect(message).toBe('Error — try again, or check https://status.shipstatic.com');
      });

      it('should handle error with null details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, null);

        const message = getUserMessage(err);

        expect(message).toBe('Error — try again, or check https://status.shipstatic.com');
      });

      it("a cancellation is the caller's own action, never a server fault", () => {
        // `Cancelled` sat outside the client-attributable set until
        // 2026-07-29, so aborting a deploy reported "server error: please try
        // again" — the fallback for everything that set does not claim.
        const message = getUserMessage(ShipError.cancelled('Deploy was cancelled'));

        expect(message).toBe('Deploy was cancelled');
        expect(message).not.toContain('status.shipstatic.com');
      });
    });
  });

  describe('toShipError', () => {
    it('should return ShipError unchanged', () => {
      const original = ShipError.validation('test error');
      const result = toShipError(original);
      expect(result).toBe(original);
    });

    it('should wrap Error as ShipError', () => {
      const original = new Error('something went wrong');
      const result = toShipError(original);
      expect(result).toBeInstanceOf(ShipError);
      expect(result.message).toBe('something went wrong');
    });

    it('should wrap string as ShipError', () => {
      const result = toShipError('plain string error');
      expect(result).toBeInstanceOf(ShipError);
      expect(result.message).toBe('plain string error');
    });

    it('should handle null/undefined gracefully', () => {
      expect(toShipError(null).message).toBe('Unknown error');
      expect(toShipError(undefined).message).toBe('Unknown error');
    });
  });
});
