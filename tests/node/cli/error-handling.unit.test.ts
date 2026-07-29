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

        const message = getUserMessage(err, undefined, options);

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
      it('should show generic server error for API errors', () => {
        const err = ShipError.api('Internal server error', 500);

        const message = getUserMessage(err);

        expect(message).toBe(
          'server error: please try again or check https://status.shipstatic.com',
        );
      });

      it('should show generic server error for unknown error types', () => {
        const err = new ShipError(ErrorType.Api, 'Something broke', 502);

        const message = getUserMessage(err);

        expect(message).toBe(
          'server error: please try again or check https://status.shipstatic.com',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle error with empty details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, {});

        const message = getUserMessage(err);

        expect(message).toBe(
          'server error: please try again or check https://status.shipstatic.com',
        );
      });

      it('should handle error with null details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, null);

        const message = getUserMessage(err);

        expect(message).toBe(
          'server error: please try again or check https://status.shipstatic.com',
        );
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
