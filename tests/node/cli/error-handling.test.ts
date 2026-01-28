/**
 * @file Unit tests for CLI error handling.
 * Tests the pure functions extracted from index.ts for error message generation.
 * These are the critical tests that were missing - now we have direct coverage.
 */

import { describe, it, expect } from 'vitest';
import { ShipError, ErrorType } from '@shipstatic/types';
import {
  getUserMessage,
  toShipError,
  formatErrorJson,
  type ErrorContext,
  type ErrorOptions
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
        const err = new ShipError(ErrorType.Api, 'Tag must be at least 3 characters', 400);
        const message = getUserMessage(err);
        expect(message).toBe('Tag must be at least 3 characters');
      });

      it('should pass through 409 conflict message', () => {
        const err = new ShipError(ErrorType.Api, 'Domain already exists', 409);
        const message = getUserMessage(err);
        expect(message).toBe('Domain already exists');
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
