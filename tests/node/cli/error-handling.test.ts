/**
 * @file Unit tests for CLI error handling.
 * Tests the pure functions extracted from index.ts for error message generation.
 * These are the critical tests that were missing - now we have direct coverage.
 */

import { describe, it, expect } from 'vitest';
import { ShipError, ErrorType } from '@shipstatic/types';
import {
  getUserMessage,
  ensureShipError,
  formatErrorJson,
  type ErrorContext,
  type ErrorOptions
} from '../../../src/node/cli/error-handling';

describe('CLI Error Handling', () => {
  describe('getUserMessage', () => {
    describe('not found errors', () => {
      it('should format not_found error with resource context', () => {
        const err = new ShipError(ErrorType.Api, 'Not found', 404, {
          data: { error: 'not_found' }
        });
        const context: ErrorContext = {
          resourceType: 'Deployment',
          resourceId: 'abc123'
        };

        const message = getUserMessage(err, context);

        expect(message).toBe('abc123 deployment not found');
      });

      it('should handle not_found without resourceId', () => {
        const err = new ShipError(ErrorType.Api, 'Not found', 404, {
          data: { error: 'not_found' }
        });
        const context: ErrorContext = {
          resourceType: 'Domain'
        };

        const message = getUserMessage(err, context);

        expect(message).toBe('domain not found');
      });

      it('should handle not_found without any context', () => {
        const err = new ShipError(ErrorType.Api, 'Not found', 404, {
          data: { error: 'not_found' }
        });

        const message = getUserMessage(err);

        expect(message).toBe('resource not found');
      });

      it('should lowercase resourceType in message', () => {
        const err = new ShipError(ErrorType.Api, 'Not found', 404, {
          data: { error: 'not_found' }
        });
        const context: ErrorContext = {
          resourceType: 'TOKEN',
          resourceId: 'xyz'
        };

        const message = getUserMessage(err, context);

        expect(message).toBe('xyz token not found');
      });
    });

    describe('business logic errors', () => {
      it('should use API message for business logic errors', () => {
        const err = new ShipError(ErrorType.Api, 'Generic error', 400, {
          data: {
            error: 'business_logic_error',
            message: 'Domain limit exceeded for this account'
          }
        });

        const message = getUserMessage(err);

        expect(message).toBe('Domain limit exceeded for this account');
      });

      it('should fallback to err.message if API message is missing', () => {
        const err = new ShipError(ErrorType.Api, 'Fallback message', 400, {
          data: { error: 'business_logic_error' }
        });

        const message = getUserMessage(err);

        expect(message).toBe('Fallback message');
      });
    });

    describe('authentication errors', () => {
      it('should show invalid API key message when apiKey is provided', () => {
        const err = ShipError.authentication('Auth failed');
        const options: ErrorOptions = { apiKey: 'ship-abc123' };

        const message = getUserMessage(err, undefined, options);

        expect(message).toBe('authentication failed: invalid API key');
      });

      it('should show invalid deploy token message when deployToken is provided', () => {
        const err = ShipError.authentication('Auth failed');
        const options: ErrorOptions = { deployToken: 'dt_abc123' };

        const message = getUserMessage(err, undefined, options);

        expect(message).toBe('authentication failed: invalid or expired deploy token');
      });

      it('should show auth required message when no credentials provided', () => {
        const err = ShipError.authentication('Auth failed');

        const message = getUserMessage(err);

        expect(message).toBe('authentication required: use --api-key or --deploy-token, or set SHIP_API_KEY');
      });

      it('should prefer apiKey message over deployToken when both provided', () => {
        const err = ShipError.authentication('Auth failed');
        const options: ErrorOptions = {
          apiKey: 'ship-abc123',
          deployToken: 'dt_abc123'
        };

        const message = getUserMessage(err, undefined, options);

        expect(message).toBe('authentication failed: invalid API key');
      });
    });

    describe('network errors', () => {
      it('should include URL when available in details', () => {
        const err = new ShipError(ErrorType.Network, 'Network failed', undefined, {
          url: 'https://api.shipstatic.com'
        });

        const message = getUserMessage(err);

        expect(message).toBe('network error: could not reach https://api.shipstatic.com');
      });

      it('should show generic network message when no URL', () => {
        const err = ShipError.network('Network failed');

        const message = getUserMessage(err);

        expect(message).toBe('network error: could not reach the API. check your internet connection');
      });
    });

    describe('file errors', () => {
      it('should pass through file error message', () => {
        const err = ShipError.file('dist/index.html path does not exist', 'dist/index.html');

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

        expect(message).toBe('server error: please try again or check https://status.shipstatic.com');
      });

      it('should show generic server error for unknown error types', () => {
        const err = new ShipError(ErrorType.Api, 'Something broke', 502);

        const message = getUserMessage(err);

        expect(message).toBe('server error: please try again or check https://status.shipstatic.com');
      });
    });

    describe('edge cases', () => {
      it('should handle error with empty details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, {});

        const message = getUserMessage(err);

        expect(message).toBe('server error: please try again or check https://status.shipstatic.com');
      });

      it('should handle error with null details', () => {
        const err = new ShipError(ErrorType.Api, 'Error', 500, null);

        const message = getUserMessage(err);

        expect(message).toBe('server error: please try again or check https://status.shipstatic.com');
      });
    });
  });

  describe('ensureShipError', () => {
    it('should return ShipError unchanged', () => {
      const original = ShipError.validation('test error');

      const result = ensureShipError(original);

      expect(result).toBe(original);
    });

    it('should wrap Error as ShipError', () => {
      const original = new Error('something went wrong');

      const result = ensureShipError(original);

      expect(result).toBeInstanceOf(ShipError);
      expect(result.message).toBe('something went wrong');
      // Wrapped errors become business errors (which are client errors)
      expect(result.isClientError()).toBe(true);
    });

    it('should wrap string as ShipError', () => {
      const result = ensureShipError('plain string error');

      expect(result).toBeInstanceOf(ShipError);
      expect(result.message).toBe('plain string error');
    });

    it('should handle null/undefined gracefully', () => {
      const resultNull = ensureShipError(null);
      const resultUndefined = ensureShipError(undefined);

      expect(resultNull).toBeInstanceOf(ShipError);
      expect(resultUndefined).toBeInstanceOf(ShipError);
      // null/undefined get converted to 'Unknown error'
      expect(resultNull.message).toBe('Unknown error');
      expect(resultUndefined.message).toBe('Unknown error');
    });

    it('should handle objects without message', () => {
      const result = ensureShipError({ code: 'ERR_UNKNOWN' });

      expect(result).toBeInstanceOf(ShipError);
      // Objects without message get stringified
      expect(result.message).toBe('[object Object]');
    });
  });

  describe('formatErrorJson', () => {
    it('should format error without details', () => {
      const json = formatErrorJson('something went wrong');
      const parsed = JSON.parse(json);

      expect(parsed).toEqual({
        error: 'something went wrong'
      });
    });

    it('should format error with details', () => {
      const details = { code: 'ERR_AUTH', data: { reason: 'expired' } };
      const json = formatErrorJson('auth failed', details);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual({
        error: 'auth failed',
        details: { code: 'ERR_AUTH', data: { reason: 'expired' } }
      });
    });

    it('should handle undefined details', () => {
      const json = formatErrorJson('error', undefined);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual({
        error: 'error'
      });
      expect(parsed).not.toHaveProperty('details');
    });

    it('should handle null details', () => {
      const json = formatErrorJson('error', null);
      const parsed = JSON.parse(json);

      // null is falsy, so details should not be included
      expect(parsed).toEqual({
        error: 'error'
      });
    });

    it('should produce valid JSON', () => {
      const json = formatErrorJson('test');

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should be properly indented', () => {
      const json = formatErrorJson('test', { foo: 'bar' });

      expect(json).toContain('\n');
      expect(json).toContain('  '); // 2-space indentation
    });
  });
});
