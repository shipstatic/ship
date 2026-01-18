import { describe, it, expect, beforeEach } from 'vitest';
import {
  setConfig,
  getCurrentConfig,
  isConfigInitialized,
  resetConfig
} from '../../../src/shared/core/platform-config';
import { ShipError } from '@shipstatic/types';
import type { ConfigResponse } from '@shipstatic/types';

describe('Platform Configuration State Management', () => {
  // Reset config state before each test for isolation
  beforeEach(() => {
    resetConfig();
  });

  describe('setConfig', () => {
    it('should store configuration', () => {
      const config: ConfigResponse = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      };

      setConfig(config);

      expect(isConfigInitialized()).toBe(true);
    });

    it('should overwrite previous configuration', () => {
      const config1: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024
      };

      const config2: ConfigResponse = {
        maxFileSize: 20 * 1024 * 1024,
        maxFilesCount: 2000,
        maxTotalSize: 200 * 1024 * 1024
      };

      setConfig(config1);
      setConfig(config2);

      const current = getCurrentConfig();
      expect(current.maxFileSize).toBe(20 * 1024 * 1024);
      expect(current.maxFilesCount).toBe(2000);
      expect(current.maxTotalSize).toBe(200 * 1024 * 1024);
    });

    it('should accept configuration with minimum values', () => {
      const config: ConfigResponse = {
        maxFileSize: 1,
        maxFilesCount: 1,
        maxTotalSize: 1
      };

      setConfig(config);

      const current = getCurrentConfig();
      expect(current.maxFileSize).toBe(1);
      expect(current.maxFilesCount).toBe(1);
      expect(current.maxTotalSize).toBe(1);
    });

    it('should accept configuration with large values', () => {
      const config: ConfigResponse = {
        maxFileSize: Number.MAX_SAFE_INTEGER,
        maxFilesCount: Number.MAX_SAFE_INTEGER,
        maxTotalSize: Number.MAX_SAFE_INTEGER
      };

      setConfig(config);

      const current = getCurrentConfig();
      expect(current.maxFileSize).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('getCurrentConfig', () => {
    it('should return stored configuration', () => {
      const config: ConfigResponse = {
        maxFileSize: 15 * 1024 * 1024,
        maxFilesCount: 1500,
        maxTotalSize: 150 * 1024 * 1024
      };

      setConfig(config);

      const current = getCurrentConfig();

      expect(current).toEqual(config);
    });

    it('should throw ShipError.config when not initialized', () => {
      // Config is reset in beforeEach, so it should be uninitialized

      expect(() => getCurrentConfig()).toThrow(ShipError);
    });

    it('should throw with correct error type when not initialized', () => {
      try {
        getCurrentConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ShipError);
        expect((error as ShipError).type).toBe('config_error');
      }
    });

    it('should throw with descriptive message when not initialized', () => {
      try {
        getCurrentConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as ShipError).message).toContain('Platform configuration not initialized');
        expect((error as ShipError).message).toContain('fetch configuration from the API');
      }
    });

    it('should return same reference to config object', () => {
      const config: ConfigResponse = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      };

      setConfig(config);

      const first = getCurrentConfig();
      const second = getCurrentConfig();

      expect(first).toBe(second);
    });
  });

  describe('isConfigInitialized', () => {
    it('should return false when config not set', () => {
      expect(isConfigInitialized()).toBe(false);
    });

    it('should return true after config is set', () => {
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      });

      expect(isConfigInitialized()).toBe(true);
    });

    it('should return false after config is reset', () => {
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      });

      expect(isConfigInitialized()).toBe(true);

      resetConfig();

      expect(isConfigInitialized()).toBe(false);
    });
  });

  describe('resetConfig', () => {
    it('should clear stored configuration', () => {
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024
      });

      expect(isConfigInitialized()).toBe(true);

      resetConfig();

      expect(isConfigInitialized()).toBe(false);
      expect(() => getCurrentConfig()).toThrow(ShipError);
    });

    it('should be safe to call multiple times', () => {
      resetConfig();
      resetConfig();
      resetConfig();

      expect(isConfigInitialized()).toBe(false);
    });

    it('should be safe to call when already uninitialized', () => {
      // Config is reset in beforeEach
      expect(() => resetConfig()).not.toThrow();
      expect(isConfigInitialized()).toBe(false);
    });

    it('should allow re-initialization after reset', () => {
      const config1: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024
      };

      const config2: ConfigResponse = {
        maxFileSize: 20 * 1024 * 1024,
        maxFilesCount: 2000,
        maxTotalSize: 200 * 1024 * 1024
      };

      setConfig(config1);
      expect(getCurrentConfig().maxFileSize).toBe(5 * 1024 * 1024);

      resetConfig();
      expect(() => getCurrentConfig()).toThrow();

      setConfig(config2);
      expect(getCurrentConfig().maxFileSize).toBe(20 * 1024 * 1024);
    });
  });

  describe('test isolation', () => {
    it('should have isolated config state per test (test 1)', () => {
      setConfig({
        maxFileSize: 1,
        maxFilesCount: 1,
        maxTotalSize: 1
      });

      expect(getCurrentConfig().maxFileSize).toBe(1);
    });

    it('should have isolated config state per test (test 2)', () => {
      // This test should start with uninitialized config due to beforeEach reset
      expect(isConfigInitialized()).toBe(false);

      setConfig({
        maxFileSize: 2,
        maxFilesCount: 2,
        maxTotalSize: 2
      });

      expect(getCurrentConfig().maxFileSize).toBe(2);
    });

    it('should have isolated config state per test (test 3)', () => {
      // Verify isolation again
      expect(isConfigInitialized()).toBe(false);
    });
  });

  describe('fail-fast behavior', () => {
    it('should fail immediately when accessing config before initialization', () => {
      const startTime = Date.now();

      try {
        getCurrentConfig();
      } catch {
        // Expected
      }

      const endTime = Date.now();

      // Should fail immediately (< 10ms)
      expect(endTime - startTime).toBeLessThan(10);
    });

    it('should provide actionable error message', () => {
      try {
        getCurrentConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as ShipError).message;

        // Error message should guide the developer
        expect(message).toContain('SDK');
        expect(message).toContain('API');
      }
    });
  });

  describe('config value preservation', () => {
    it('should preserve all config properties', () => {
      const config: ConfigResponse = {
        maxFileSize: 12345678,
        maxFilesCount: 9999,
        maxTotalSize: 987654321
      };

      setConfig(config);

      const retrieved = getCurrentConfig();

      expect(retrieved.maxFileSize).toBe(12345678);
      expect(retrieved.maxFilesCount).toBe(9999);
      expect(retrieved.maxTotalSize).toBe(987654321);
    });

    it('should handle zero values correctly', () => {
      const config: ConfigResponse = {
        maxFileSize: 0,
        maxFilesCount: 0,
        maxTotalSize: 0
      };

      setConfig(config);

      const retrieved = getCurrentConfig();

      expect(retrieved.maxFileSize).toBe(0);
      expect(retrieved.maxFilesCount).toBe(0);
      expect(retrieved.maxTotalSize).toBe(0);
    });
  });

  describe('module state', () => {
    it('should maintain state across multiple imports (simulated)', () => {
      // Set config
      setConfig({
        maxFileSize: 42,
        maxFilesCount: 100,
        maxTotalSize: 1000
      });

      // The same module state should be accessible
      expect(getCurrentConfig().maxFileSize).toBe(42);
      expect(isConfigInitialized()).toBe(true);
    });
  });
});
