import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import CLI utilities that we want to test
import { success, error, formatTimestamp } from '@/cli/utils';

// Mock console methods to capture output
let mockConsoleLog: any;
let mockConsoleError: any;

describe('CLI Output Formatting', () => {
  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Message Helpers', () => {
    it('should format success messages with green circle', () => {
      success('Test success message');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Test success message\n');
    });

    it('should format error messages with red circle', () => {
      error('Test error message');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Test error message\n');
    });

    it('should format alias created message', () => {
      success('Alias created: test-alias');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias created: test-alias\n');
    });

    it('should format alias updated message', () => {
      success('Alias updated: test-alias');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias updated: test-alias\n');
    });

    it('should format deployment created message', () => {
      success('Deployment created: test-deployment-123');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Deployment created: test-deployment-123\n');
    });

    it('should format resource removal messages', () => {
      success('Alias removed: test-alias');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias removed: test-alias\n');

      success('Deployment removed: test-deployment');
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Deployment removed: test-deployment\n');
    });

    it('should format resource not found error messages', () => {
      error('Alias not found: nonexistent-alias');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Alias not found: nonexistent-alias\n');

      error('Deployment not found: nonexistent-deployment');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Deployment not found: nonexistent-deployment\n');
    });
  });

  describe('Timestamp Formatting', () => {
    it('should format unix timestamps to ISO 8601 date strings', () => {
      // Test with a known timestamp (2025-01-15 12:00:00 UTC = 1736942400)
      const timestamp = 1736942400;
      const result = formatTimestamp(timestamp);
      
      // Should be in ISO 8601 format (YYYY-MM-DD)
      expect(result).toBe('2025-01-15');
    });

    it('should return dash for undefined timestamps', () => {
      expect(formatTimestamp(undefined)).toBe('-');
    });

    it('should return dash for null timestamps', () => {
      expect(formatTimestamp(null as any)).toBe('-');
    });

    it('should handle zero timestamp', () => {
      const result = formatTimestamp(0);
      expect(result).toBe('-');
    });
  });

  describe('Alias Operation Differentiation', () => {
    it('should test alias creation vs update logic', () => {
      // This test verifies the logic that would be used in CLI formatters
      const createResult = { alias: 'test-alias', deployment: 'abc123', isCreate: true };
      const updateResult = { alias: 'test-alias', deployment: 'def456', isCreate: false };

      // Simulate the CLI formatter logic
      const createOperation = createResult.isCreate ? 'created' : 'updated';
      const updateOperation = updateResult.isCreate ? 'created' : 'updated';

      expect(createOperation).toBe('created');
      expect(updateOperation).toBe('updated');

      // Test the actual message formatting
      success(`Alias ${createOperation}: ${createResult.alias}`);
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias created: test-alias\n');

      success(`Alias ${updateOperation}: ${updateResult.alias}`);
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias updated: test-alias\n');
    });

    it('should handle aliases without isCreate property gracefully', () => {
      const legacyResult = { alias: 'test-alias', deployment: 'abc123' };
      
      // Simulate the CLI formatter logic with fallback
      const operation = legacyResult.isCreate !== undefined 
        ? (legacyResult.isCreate ? 'created' : 'updated')
        : 'updated'; // fallback to 'updated' for backward compatibility

      expect(operation).toBe('updated');
      
      success(`Alias ${operation}: ${legacyResult.alias}`);
      expect(mockConsoleLog).toHaveBeenCalledWith('\x1b[32m●\x1b[0m Alias updated: test-alias\n');
    });
  });

  describe('Error Message Consistency', () => {
    it('should use consistent format for all error types', () => {
      const errorMessages = [
        'Authentication failed. Check your API key.',
        'Network error. Check your connection and API URL.',
        'Server error. Please try again later.',
        'Alias not found: test-alias',
        'Deployment not found: test-deployment'
      ];

      errorMessages.forEach(message => {
        error(message);
        expect(mockConsoleError).toHaveBeenCalledWith(`\x1b[31m●\x1b[0m ${message}\n`);
      });
    });
  });

  describe('Success Message Consistency', () => {
    it('should use consistent format for all success types', () => {
      const successMessages = [
        'API connected',
        'Alias created: test-alias',
        'Alias updated: test-alias',
        'Alias removed: test-alias',
        'Deployment created: test-deployment',
        'Deployment removed: test-deployment'
      ];

      successMessages.forEach(message => {
        success(message);
        expect(mockConsoleLog).toHaveBeenCalledWith(`\x1b[32m●\x1b[0m ${message}\n`);
      });
    });
  });

  describe('Specific Error Cases', () => {
    it('should format deployment not found error for aliases set', () => {
      error('Deployment not found: driven-rune-62f2ac6');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Deployment not found: driven-rune-62f2ac6\n');
    });

    it('should format business logic error messages', () => {
      error('Cannot delete deployment with active aliases.');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Cannot delete deployment with active aliases.\n');
    });

    it('should format resource not found messages for different contexts', () => {
      error('Alias not found: nonexistent-alias');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Alias not found: nonexistent-alias\n');

      error('Deployment not found: nonexistent-deployment');
      expect(mockConsoleError).toHaveBeenCalledWith('\x1b[31m●\x1b[0m Deployment not found: nonexistent-deployment\n');
    });
  });
});