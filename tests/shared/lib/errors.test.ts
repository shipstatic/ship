import { describe, it, expect } from 'vitest';
import { ensureShipError } from '../../../src/shared/lib/errors';
import { ShipError } from '@shipstatic/types';

describe('Error Utilities', () => {
  describe('ensureShipError', () => {
    describe('ShipError passthrough', () => {
      it('should return ShipError instance unchanged', () => {
        const original = ShipError.business('Original error');

        const result = ensureShipError(original);

        expect(result).toBe(original);
        expect(result.message).toBe('Original error');
      });

      it('should preserve ShipError type', () => {
        const networkError = ShipError.network('Network failed');

        const result = ensureShipError(networkError);

        expect(result).toBe(networkError);
        expect(result.type).toBe('network_error');
      });

      it('should preserve ShipError with all factory types', () => {
        const errors = [
          ShipError.validation('Validation error', 'details'),
          ShipError.notFound('Deployment', 'abc123'),
          ShipError.rateLimit('Rate limit hit'),
          ShipError.authentication('Auth failed'),
          ShipError.network('Network error'),
          ShipError.cancelled('Operation cancelled'),
          ShipError.file('File error', '/path/to/file'),
          ShipError.config('Config error')
        ];

        errors.forEach(error => {
          const result = ensureShipError(error);
          expect(result).toBe(error);
        });
      });
    });

    describe('Error instance conversion', () => {
      it('should convert Error to ShipError', () => {
        const original = new Error('Standard error');

        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Standard error');
      });

      it('should convert Error to business type ShipError', () => {
        const original = new Error('Business logic failed');

        const result = ensureShipError(original);

        expect(result.type).toBe('business_logic_error');
      });

      it('should convert TypeError to ShipError', () => {
        const original = new TypeError('Cannot read property of undefined');

        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Cannot read property of undefined');
        expect(result.type).toBe('business_logic_error');
      });

      it('should convert RangeError to ShipError', () => {
        const original = new RangeError('Invalid array length');

        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Invalid array length');
      });

      it('should convert SyntaxError to ShipError', () => {
        const original = new SyntaxError('Unexpected token');

        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Unexpected token');
      });

      it('should handle Error with empty message', () => {
        const original = new Error('');

        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('');
      });

      it('should handle Error with multiline message', () => {
        const original = new Error('Line 1\nLine 2\nLine 3');

        const result = ensureShipError(original);

        expect(result.message).toBe('Line 1\nLine 2\nLine 3');
      });
    });

    describe('null/undefined handling', () => {
      it('should convert null to ShipError with default message', () => {
        const result = ensureShipError(null);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Unknown error');
        expect(result.type).toBe('business_logic_error');
      });

      it('should convert undefined to ShipError with default message', () => {
        const result = ensureShipError(undefined);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Unknown error');
        expect(result.type).toBe('business_logic_error');
      });
    });

    describe('primitive value conversion', () => {
      it('should convert string to ShipError', () => {
        const result = ensureShipError('String error message');

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('String error message');
        expect(result.type).toBe('business_logic_error');
      });

      it('should convert empty string to ShipError', () => {
        const result = ensureShipError('');

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('');
      });

      it('should convert number to ShipError', () => {
        const result = ensureShipError(42);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('42');
      });

      it('should convert zero to ShipError', () => {
        const result = ensureShipError(0);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('0');
      });

      it('should convert boolean true to ShipError', () => {
        const result = ensureShipError(true);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('true');
      });

      it('should convert boolean false to ShipError', () => {
        const result = ensureShipError(false);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('false');
      });

      it('should convert NaN to ShipError', () => {
        const result = ensureShipError(NaN);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('NaN');
      });

      it('should convert Infinity to ShipError', () => {
        const result = ensureShipError(Infinity);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Infinity');
      });
    });

    describe('object conversion', () => {
      it('should convert plain object to ShipError', () => {
        const result = ensureShipError({ message: 'Object error' });

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('[object Object]');
      });

      it('should convert object with toString to ShipError', () => {
        const obj = {
          toString() {
            return 'Custom toString message';
          }
        };

        const result = ensureShipError(obj);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Custom toString message');
      });

      it('should convert array to ShipError', () => {
        const result = ensureShipError(['error1', 'error2']);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('error1,error2');
      });

      it('should convert empty array to ShipError', () => {
        const result = ensureShipError([]);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('');
      });

      it('should handle Symbol conversion', () => {
        const sym = Symbol('test');

        // Symbol.toString() returns 'Symbol(test)'
        const result = ensureShipError(sym);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Symbol(test)');
      });
    });

    describe('edge cases', () => {
      it('should handle Error subclass', () => {
        class CustomError extends Error {
          constructor(message: string) {
            super(message);
            this.name = 'CustomError';
          }
        }

        const original = new CustomError('Custom error message');
        const result = ensureShipError(original);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Custom error message');
      });

      it('should handle error-like object (has message property but not Error)', () => {
        const errorLike = { message: 'Looks like an error' };

        const result = ensureShipError(errorLike);

        // Since it's not instanceof Error, it will be stringified
        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('[object Object]');
      });

      it('should handle BigInt', () => {
        const bigInt = BigInt(9007199254740991);

        const result = ensureShipError(bigInt);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('9007199254740991');
      });

      it('should handle function', () => {
        const fn = () => 'test';

        const result = ensureShipError(fn);

        expect(result).toBeInstanceOf(ShipError);
        // Function stringification varies by environment
        expect(result.message).toContain('test');
      });

      it('should handle Date object', () => {
        const date = new Date('2024-01-01T00:00:00.000Z');

        const result = ensureShipError(date);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toContain('2024');
      });

      it('should handle RegExp', () => {
        const regex = /test/gi;

        const result = ensureShipError(regex);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('/test/gi');
      });
    });

    describe('type safety', () => {
      it('should always return ShipError type', () => {
        const inputs: unknown[] = [
          null,
          undefined,
          'string',
          42,
          true,
          {},
          [],
          new Error('test'),
          ShipError.business('test')
        ];

        inputs.forEach(input => {
          const result = ensureShipError(input);
          expect(result).toBeInstanceOf(ShipError);
        });
      });

      it('should be usable in catch blocks', () => {
        const testFn = () => {
          try {
            throw 'string error';
          } catch (err) {
            const shipError = ensureShipError(err);
            return shipError;
          }
        };

        const result = testFn();
        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('string error');
      });

      it('should work with unknown error in async context', async () => {
        const asyncFn = async () => {
          try {
            await Promise.reject({ code: 'ASYNC_ERROR' });
          } catch (err) {
            return ensureShipError(err);
          }
        };

        const result = await asyncFn();
        expect(result).toBeInstanceOf(ShipError);
      });
    });

    describe('real-world scenarios', () => {
      it('should handle fetch TypeError', () => {
        // Simulating: fetch failed to fetch
        const fetchError = new TypeError('Failed to fetch');

        const result = ensureShipError(fetchError);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toBe('Failed to fetch');
      });

      it('should handle JSON.parse error', () => {
        let parseError: unknown;
        try {
          JSON.parse('invalid json');
        } catch (e) {
          parseError = e;
        }

        const result = ensureShipError(parseError);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toContain('JSON');
      });

      it('should handle DOM exception', () => {
        // Simulating a DOMException-like object
        const domError = new Error('AbortError: The operation was aborted');
        domError.name = 'AbortError';

        const result = ensureShipError(domError);

        expect(result).toBeInstanceOf(ShipError);
        expect(result.message).toContain('aborted');
      });

      it('should handle Axios-style error object', () => {
        // Simulating Axios error structure
        const axiosError = {
          message: 'Request failed with status code 500',
          response: { status: 500, data: {} },
          config: {},
          isAxiosError: true
        };

        const result = ensureShipError(axiosError);

        // Will be stringified since not instanceof Error
        expect(result).toBeInstanceOf(ShipError);
      });
    });
  });
});
