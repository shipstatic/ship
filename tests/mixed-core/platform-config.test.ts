import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ConfigResponse } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';

// SUT (System Under Test) functions
let setConfigUnderTest: typeof import('../../src/shared/core/platform-config').setConfig;
let getCurrentConfigUnderTest: typeof import('../../src/shared/core/platform-config').getCurrentConfig;
let isConfigInitializedUnderTest: typeof import('../../src/shared/core/platform-config').isConfigInitialized;
let resetConfigUnderTest: typeof import('../../src/shared/core/platform-config').resetConfig;

describe('Platform Config Module Tests', () => {
  beforeEach(async () => {
    // Reset modules to ensure clean state
    vi.resetModules();

    // Import fresh instances for each test
    const platformConfigModule = await import('../../src/shared/core/platform-config');
    setConfigUnderTest = platformConfigModule.setConfig;
    getCurrentConfigUnderTest = platformConfigModule.getCurrentConfig;
    isConfigInitializedUnderTest = platformConfigModule.isConfigInitialized;
    resetConfigUnderTest = platformConfigModule.resetConfig;

    // Reset config state for each test
    resetConfigUnderTest();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('setConfig', () => {
    it('should set the config and make it accessible via getCurrentConfig', () => {
      const testConfig: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024,
      };

      setConfigUnderTest(testConfig);
      const retrievedConfig = getCurrentConfigUnderTest();
      
      expect(retrievedConfig).toEqual(testConfig);
    });

    it('should update config when called multiple times', () => {
      const config1: ConfigResponse = {
        maxFileSize: 1 * 1024 * 1024,
        maxFilesCount: 100,
        maxTotalSize: 10 * 1024 * 1024,
      };

      const config2: ConfigResponse = {
        maxFileSize: 2 * 1024 * 1024,
        maxFilesCount: 200,
        maxTotalSize: 20 * 1024 * 1024,
      };

      setConfigUnderTest(config1);
      expect(getCurrentConfigUnderTest()).toEqual(config1);

      setConfigUnderTest(config2);
      expect(getCurrentConfigUnderTest()).toEqual(config2);
    });
  });

  describe('getCurrentConfig', () => {
    it('should throw error when config is not initialized (fail-fast approach)', () => {
      expect(() => getCurrentConfigUnderTest()).toThrow('Platform configuration not initialized');
    });

    it('should return actual config when initialized', () => {
      const testConfig: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024,
      };

      setConfigUnderTest(testConfig);
      const config = getCurrentConfigUnderTest();
      
      expect(config).toEqual(testConfig);
    });

    it('should always return a valid config object after initialization', () => {
      const testConfig: ConfigResponse = {
        maxFileSize: 8 * 1024 * 1024,
        maxFilesCount: 800,
        maxTotalSize: 80 * 1024 * 1024,
      };

      setConfigUnderTest(testConfig);
      const config = getCurrentConfigUnderTest();

      expect(typeof config).toBe('object');
      expect(config).toHaveProperty('maxFileSize');
      expect(config).toHaveProperty('maxFilesCount');
      expect(config).toHaveProperty('maxTotalSize');
      expect(typeof config.maxFileSize).toBe('number');
      expect(typeof config.maxFilesCount).toBe('number');
      expect(typeof config.maxTotalSize).toBe('number');
    });
  });

  describe('isConfigInitialized', () => {
    it('should return false when config is not initialized', () => {
      expect(isConfigInitializedUnderTest()).toBe(false);
    });

    it('should return true after config is set', () => {
      const testConfig: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024,
      };

      setConfigUnderTest(testConfig);
      expect(isConfigInitializedUnderTest()).toBe(true);
    });

    it('should remain true after multiple setConfig calls', () => {
      const config1: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxFilesCount: 500,
        maxTotalSize: 50 * 1024 * 1024,
      };

      const config2: ConfigResponse = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024,
      };

      setConfigUnderTest(config1);
      expect(isConfigInitializedUnderTest()).toBe(true);

      setConfigUnderTest(config2);
      expect(isConfigInitializedUnderTest()).toBe(true);
    });
  });

  describe('config integration scenarios', () => {
    it('should handle typical initialization flow', () => {
      // 1. Check initial state
      expect(isConfigInitializedUnderTest()).toBe(false);
      expect(() => getCurrentConfigUnderTest()).toThrow('Platform configuration not initialized');

      // 2. Initialize config
      const apiConfig: ConfigResponse = {
        maxFileSize: 15 * 1024 * 1024, // 15MB
        maxFilesCount: 1500,
        maxTotalSize: 150 * 1024 * 1024, // 150MB
      };

      setConfigUnderTest(apiConfig);

      // 3. Verify config is accessible
      expect(isConfigInitializedUnderTest()).toBe(true);
      const retrievedConfig = getCurrentConfigUnderTest();
      expect(retrievedConfig).toEqual(apiConfig);
    });

    it('should handle config values with different types', () => {
      const testConfig: ConfigResponse = {
        maxFileSize: 0, // Edge case: zero
        maxFilesCount: 1, // Edge case: minimum
        maxTotalSize: Number.MAX_SAFE_INTEGER, // Edge case: large number
      };

      setConfigUnderTest(testConfig);
      const config = getCurrentConfigUnderTest();

      expect(config.maxFileSize).toBe(0);
      expect(config.maxFilesCount).toBe(1);
      expect(config.maxTotalSize).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});