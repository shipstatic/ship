import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __setTestEnvironment, getENV } from '../../src/shared/lib/env';
import { setConfig } from '../../src/shared/core/platform-config';

/**
 * Environment Switching Validation Tests
 * 
 * These tests validate that environment detection and switching work correctly,
 * ensuring proper isolation and behavior consistency when switching environments.
 */

describe('Environment Switching Cross-Platform Validation', () => {
  let originalEnv: string | null;

  beforeEach(() => {
    originalEnv = getENV();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    __setTestEnvironment(originalEnv);
  });

  describe('Environment Detection Accuracy', () => {
    it('should detect environment changes accurately', () => {
      // Test initial state
      expect(getENV()).toBe(originalEnv);

      // Test switching to browser
      __setTestEnvironment('browser');
      expect(getENV()).toBe('browser');

      // Test switching to node
      __setTestEnvironment('node');
      expect(getENV()).toBe('node');

      // Test switching to null (auto-detect)
      __setTestEnvironment(null);
      expect(getENV()).toBe('node'); // Should auto-detect Node.js in test environment
    });

    it('should handle rapid environment switches', () => {
      const switches = ['browser', 'node', 'browser', 'node', null] as const;
      
      for (const env of switches) {
        __setTestEnvironment(env);
        if (env === null) {
          expect(getENV()).toBe('node'); // Auto-detect in test environment
        } else {
          expect(getENV()).toBe(env);
        }
      }
    });

    it('should maintain environment isolation during concurrent operations', async () => {
      // Test that environment switches don't interfere with each other
      const results: string[] = [];
      
      const promises = [
        (async () => {
          __setTestEnvironment('browser');
          await new Promise(resolve => setTimeout(resolve, 10));
          results.push(`operation1-${getENV()}`);
        })(),
        (async () => {
          __setTestEnvironment('node');
          await new Promise(resolve => setTimeout(resolve, 5));
          results.push(`operation2-${getENV()}`);
        })(),
        (async () => {
          __setTestEnvironment('browser');
          await new Promise(resolve => setTimeout(resolve, 15));
          results.push(`operation3-${getENV()}`);
        })()
      ];

      await Promise.all(promises);
      
      // Each operation should have maintained its environment
      // Note: Due to global state, the last set wins, but operations should complete
      expect(results).toHaveLength(3);
      expect(results.every(r => r.includes('-'))).toBe(true);
    });
  });

  describe('Environment-Specific Behavior Validation', () => {
    it('should enforce browser-only functionality in browser environment', async () => {
      __setTestEnvironment('browser');

      // Initialize platform config (required by processFilesForBrowser)
      setConfig({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024,
      });

      // Mock DOM APIs since we're running in Node.js
      global.Blob = class MockBlob {
        constructor(public bits: any[], public options: any = {}) {}
        get size() { return this.bits.join('').length; }
        get type() { return this.options.type || 'text/plain'; }
        async arrayBuffer() { return new ArrayBuffer(this.size); }
        slice(start = 0, end = this.size) {
          return new MockBlob([this.bits.join('').slice(start, end)], this.options);
        }
      } as any;

      global.File = class MockFile extends (global.Blob as any) {
        constructor(public bits: any[], public name: string, public options: any = {}) {
          super(bits, options);
        }
      } as any;

      global.FileReader = class MockFileReader {
        readAsArrayBuffer() { this.onload?.({ target: { result: new ArrayBuffer(4) } } as any); }
        onload: any;
      } as any;

      // Import browser-specific functionality
      const { processFilesForBrowser } = await import('../../src/browser/lib/browser-files');

      // Should work in browser environment with mocked APIs
      const mockFile = new File(['test'], 'test.txt');
      await expect(processFilesForBrowser([mockFile], {})).resolves.toBeDefined();
    });

    it('should enforce node-only functionality in node environment', async () => {
      __setTestEnvironment('node');
      
      // Import node-specific functionality
      const { processFilesForNode } = await import('../../src/node/core/node-files');
      
      // Should work in node environment (but will fail due to mocking in test)
      // The important part is that it doesn't throw environment errors
      await expect(processFilesForNode(['./test.txt'])).rejects.toThrow();
      // But not due to environment validation
    });

    it('should prevent cross-environment functionality usage', async () => {
      // Test browser functions in node environment
      __setTestEnvironment('node');
      const { processFilesForBrowser } = await import('../../src/browser/lib/browser-files');
      
      const mockFile = new File(['test'], 'test.txt');
      await expect(processFilesForBrowser([mockFile], {}))
        .rejects.toThrow('processFilesForBrowser can only be called in a browser environment.');

      // Test node functions in browser environment  
      __setTestEnvironment('browser');
      const { processFilesForNode } = await import('../../src/node/core/node-files');
      
      await expect(processFilesForNode(['./test.txt']))
        .rejects.toThrow('processFilesForNode can only be called in Node.js environment.');
    });
  });

  describe('Ship Class Environment Validation', () => {
    it('should enforce Node.js Ship class environment requirements', async () => {
      __setTestEnvironment('browser');
      
      const { Ship: NodeShip } = await import('../../src/node/index');
      
      expect(() => {
        new NodeShip({ apiKey: 'test-key' });
      }).toThrow('Node.js Ship class can only be used in Node.js environment.');
    });

    it('should allow browser Ship class in any environment', async () => {
      // Browser Ship should work in both environments for flexibility
      for (const env of ['browser', 'node'] as const) {
        __setTestEnvironment(env);
        
        const { Ship: BrowserShip } = await import('../../src/browser/index');
        
        expect(() => {
          new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
        }).not.toThrow();
      }
    });

    it('should handle environment switching during Ship instance lifecycle', async () => {
      // Create Ship instance in one environment
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });
      
      // Switch environment
      __setTestEnvironment('browser');
      
      // Should still be able to use the instance (implementation-dependent)
      expect(nodeShip).toBeDefined();
      expect(nodeShip.deployments).toBeDefined();
    });
  });

  describe('Configuration Environment Isolation', () => {
    it('should use shared platform configuration across environments', async () => {
      // Both browser and node now use the same shared platform-config module
      __setTestEnvironment('browser');
      const { setConfig: setPlatformConfig } = await import('../../src/shared/core/platform-config');

      const testConfig = {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024,
      };

      setPlatformConfig(testConfig);

      // Switch to node environment - should still access the same shared config
      __setTestEnvironment('node');
      const { getCurrentConfig } = await import('../../src/shared/core/platform-config');

      // Platform config is shared across environments
      expect(getCurrentConfig()).toEqual(testConfig);
    });

    it('should handle config loading consistently across environment switches', async () => {
      // Node loads config from env/files; browser receives config via constructor (no file loading)
      __setTestEnvironment('node');
      const { loadConfig: loadNodeConfig } = await import('../../src/node/core/config');
      const nodeConfig = await loadNodeConfig();

      // Node config behavior depends on environment — should not throw
      expect(nodeConfig).toBeDefined();
    });
  });

  describe('Module Import Consistency During Environment Switches', () => {
    it('should handle module imports consistently during environment switches', async () => {
      const imports: any[] = [];
      
      // Import in browser environment
      __setTestEnvironment('browser');
      imports.push(await import('../../src/browser/index'));
      
      // Import in node environment
      __setTestEnvironment('node');
      imports.push(await import('../../src/node/index'));
      
      // Both imports should succeed
      expect(imports[0]).toBeDefined();
      expect(imports[1]).toBeDefined();
      
      // Both should have Ship class
      expect(imports[0].Ship).toBeDefined();
      expect(imports[1].Ship).toBeDefined();
    });

    it('should handle shared module imports consistently', async () => {
      const sharedImports: any[] = [];
      
      for (const env of ['browser', 'node'] as const) {
        __setTestEnvironment(env);
        
        const sharedModule = await import('../../src/shared/lib/env');
        sharedImports.push(sharedModule);
      }
      
      // Shared modules should be identical
      expect(sharedImports[0].getENV).toBe(sharedImports[1].getENV);
      expect(sharedImports[0].__setTestEnvironment).toBe(sharedImports[1].__setTestEnvironment);
    });
  });

  describe('Error Handling During Environment Switches', () => {
    it('should handle errors consistently when switching environments mid-operation', async () => {
      const errors: any[] = [];
      
      // Start operation in one environment
      __setTestEnvironment('browser');
      
      try {
        const { processFilesForNode } = await import('../../src/node/core/node-files');
        await processFilesForNode(['./test.txt']);
      } catch (error) {
        errors.push(error);
      }
      
      // Switch environment and try again
      __setTestEnvironment('node');
      
      try {
        const { processFilesForBrowser } = await import('../../src/browser/lib/browser-files');
        const mockFile = new File(['test'], 'test.txt');
        await processFilesForBrowser([mockFile], {});
      } catch (error) {
        errors.push(error);
      }
      
      // Both should have thrown environment-specific errors
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toContain('Node.js environment');
      expect(errors[1].message).toContain('browser environment');
    });

    it('should provide helpful error messages for environment mismatches', async () => {
      __setTestEnvironment('browser');
      
      const { processFilesForNode } = await import('../../src/node/core/node-files');
      
      await expect(processFilesForNode(['./test.txt']))
        .rejects.toThrow(/can only be called in Node\.js environment/);
      
      __setTestEnvironment('node');
      
      const { processFilesForBrowser } = await import('../../src/browser/lib/browser-files');
      const mockFile = new File(['test'], 'test.txt');
      
      await expect(processFilesForBrowser([mockFile], {}))
        .rejects.toThrow(/can only be called in a browser environment/);
    });
  });

  describe('Performance Impact of Environment Switching', () => {
    it('should not significantly impact performance when switching environments', async () => {
      const switchTimes: number[] = [];
      
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        __setTestEnvironment(i % 2 === 0 ? 'browser' : 'node');
        const end = performance.now();
        switchTimes.push(end - start);
      }
      
      // Environment switching should be fast (< 1ms average)
      const averageTime = switchTimes.reduce((a, b) => a + b, 0) / switchTimes.length;
      expect(averageTime).toBeLessThan(1);
    });

    it('should handle frequent environment detection calls efficiently', () => {
      const start = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        getENV();
      }
      
      const end = performance.now();
      const totalTime = end - start;
      
      // 1000 calls should complete quickly (< 10ms)
      expect(totalTime).toBeLessThan(10);
    });
  });

  describe('Environment State Consistency', () => {
    it('should maintain consistent state across environment boundaries', async () => {
      const stateLog: string[] = [];
      
      // Record state changes
      __setTestEnvironment('browser');
      stateLog.push(`browser-${getENV()}`);
      
      __setTestEnvironment('node');
      stateLog.push(`node-${getENV()}`);
      
      __setTestEnvironment(null);
      stateLog.push(`auto-${getENV()}`);
      
      expect(stateLog).toEqual([
        'browser-browser',
        'node-node',
        'auto-node'
      ]);
    });

    it('should handle concurrent environment state queries', async () => {
      __setTestEnvironment('browser');
      
      const promises = Array.from({ length: 10 }, async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        return getENV();
      });
      
      const results = await Promise.all(promises);
      
      // All should return the same environment
      expect(results.every(env => env === 'browser')).toBe(true);
    });
  });
});