import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setTestEnvironment } from '../../src/shared/lib/env';
import { DEPLOYMENT_CONFIG_FILENAME } from '@shipstatic/types';

// Mock the ApiHttp class to prevent real network calls
const mockApiClient = {
  ping: vi.fn().mockResolvedValue(true),
  deploy: vi.fn().mockResolvedValue({
    id: 'pipeline_test_123',
    url: 'https://pipeline_test_123.shipstatic.dev',
    files: []
  }),
  getAccount: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
  getConfig: vi.fn().mockResolvedValue({ maxFileSize: 10485760, domains: [] }),
  checkSPA: vi.fn().mockResolvedValue(false)
};

vi.mock('../../src/shared/api/http', () => ({
  ApiHttp: vi.fn(() => mockApiClient)
}));

/**
 * Cross-Environment Deploy Pipeline Integration Tests
 * 
 * These tests validate that the complete deployment pipeline
 * (input processing → file transformation → API calls → response handling)
 * behaves identically across browser and Node.js environments.
 */

describe('Deploy Pipeline Cross-Environment Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reinitialize the mock functions after clearing
    mockApiClient.ping = vi.fn().mockResolvedValue(true);
    mockApiClient.deploy = vi.fn().mockResolvedValue({
      id: 'pipeline_test_123',
      url: 'https://pipeline_test_123.shipstatic.dev',
      files: []
    });
    mockApiClient.getAccount = vi.fn().mockResolvedValue({ email: 'test@example.com' });
    mockApiClient.getConfig = vi.fn().mockResolvedValue({ maxFileSize: 10485760, domains: [] });
    mockApiClient.checkSPA = vi.fn().mockResolvedValue(false);
  });

  describe('Complete Deployment Pipeline Consistency', () => {
    it('should process identical file content through the full pipeline consistently', async () => {
      const testFileContent = '<html><head><title>Test</title></head><body><h1>Pipeline Test</h1></body></html>';
      const results: any[] = [];

      // Test Node.js pipeline
      __setTestEnvironment('node');
      const { Ship: NodeShip } = await import('../../src/node/index');
      const nodeShip = new NodeShip({ apiKey: 'test-key' });
      (nodeShip as any).http = mockApiClient;
      
      // Mock the processInput to return consistent data
      (nodeShip as any).processInput = vi.fn().mockResolvedValue([
        {
          path: 'index.html',
          content: Buffer.from(testFileContent),
          size: testFileContent.length,
          md5: 'consistent-hash-123'
        }
      ]);

      const nodeResult = await nodeShip.deploy(['./index.html']);
      results.push(nodeResult);

      // Test Browser pipeline
      __setTestEnvironment('browser');
      const { Ship: BrowserShip } = await import('../../src/browser/index');
      const browserShip = new BrowserShip({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
      (browserShip as any).http = mockApiClient;
      
      // Mock the processInput to return consistent data
      (browserShip as any).processInput = vi.fn().mockResolvedValue([
        {
          path: 'index.html',
          content: new TextEncoder().encode(testFileContent).buffer,
          size: testFileContent.length,
          md5: 'consistent-hash-123'
        }
      ]);

      const mockFile = new File([testFileContent], 'index.html', { type: 'text/html' });
      const browserResult = await browserShip.deploy([mockFile]);
      results.push(browserResult);

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toEqual({
        id: 'pipeline_test_123',
        url: 'https://pipeline_test_123.shipstatic.dev',
        files: []
      });

      // API should have been called twice with same data structure
      expect(mockApiClient.deploy).toHaveBeenCalledTimes(2);
    });

    it('should handle SPA detection consistently in the pipeline', async () => {
      mockApiClient.checkSPA.mockResolvedValue(true);
      
      const spaFiles = [
        { path: 'index.html', content: '<html><script src="app.js"></script></html>' },
        { path: 'app', content: 'console.log("SPA app");' }
      ];

      const results: any[] = [];

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          // Mock processInput to simulate the pipeline
          (ship as any).processInput = vi.fn().mockResolvedValue(
            spaFiles.map(f => ({
              path: f.path,
              content: Buffer.from(f.content),
              size: f.content.length,
              md5: `hash-${f.path}`
            }))
          );

          const result = await ship.deploy(['./index.html', './app'], { spaDetect: true });
          results.push(result);
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          // Mock processInput to simulate the pipeline
          (ship as any).processInput = vi.fn().mockResolvedValue(
            spaFiles.map(f => ({
              path: f.path,
              content: new TextEncoder().encode(f.content).buffer,
              size: f.content.length,
              md5: `hash-${f.path}`
            }))
          );

          const mockFiles = spaFiles.map(f => new File([f.content], f.path));
          const result = await ship.deploy(mockFiles, { spaDetect: true });
          results.push(result);
        }
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      
      // SPA detection should have been called in both environments
      expect(mockApiClient.checkSPA).toHaveBeenCalledTimes(2);
    });

    it('should handle deployment options consistently across the pipeline', async () => {
      const deploymentOptions = {
        timeout: 30000,
        maxConcurrency: 5,
        spaDetect: false
      };

      const results: any[] = [];

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          const mockProcessInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash' }
          ]);
          (ship as any).processInput = mockProcessInput;

          const result = await ship.deploy(['./test.html'], deploymentOptions);
          results.push({ result, processInputCall: mockProcessInput.mock.calls[0] });
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          const mockProcessInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'hash' }
          ]);
          (ship as any).processInput = mockProcessInput;

          const mockFile = new File(['<html></html>'], 'test.html');
          const result = await ship.deploy([mockFile], deploymentOptions);
          results.push({ result, processInputCall: mockProcessInput.mock.calls[0] });
        }
      }

      // Deployment results should be identical
      expect(results[0].result).toEqual(results[1].result);
      
      // Options should be passed consistently to processInput
      const nodeOptions = results[0].processInputCall[1];
      const browserOptions = results[1].processInputCall[1];
      
      expect(nodeOptions.timeout).toBe(browserOptions.timeout);
      expect(nodeOptions.maxConcurrency).toBe(browserOptions.maxConcurrency);
      expect(nodeOptions.spaDetect).toBe(browserOptions.spaDetect);
    });
  });

  describe('Error Handling in Pipeline Integration', () => {
    it('should handle file processing errors consistently across environments', async () => {
      const processingError = new Error('File processing failed');

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          // Mock processInput to throw error
          (ship as any).processInput = vi.fn().mockRejectedValue(processingError);

          try {
            await ship.deploy(['./test.html']);
            expect.fail('Node.js deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('File processing failed');
          }
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          // Mock processInput to throw error
          (ship as any).processInput = vi.fn().mockRejectedValue(processingError);

          const mockFile = new File(['test'], 'test.html');
          try {
            await ship.deploy([mockFile]);
            expect.fail('Browser deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('File processing failed');
          }
        }
      }
    });

    it('should handle API deployment errors consistently across environments', async () => {
      const apiError = new Error('Deployment failed: insufficient quota');
      mockApiClient.deploy.mockRejectedValue(apiError);

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash' }
          ]);

          try {
            await ship.deploy(['./test.html']);
            expect.fail('Node.js deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('Deployment failed: insufficient quota');
          }
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'hash' }
          ]);

          const mockFile = new File(['<html></html>'], 'test.html');
          try {
            await ship.deploy([mockFile]);
            expect.fail('Browser deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('Deployment failed: insufficient quota');
          }
        }
      }
    });

    it('should handle network timeout errors consistently across environments', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      mockApiClient.deploy.mockRejectedValue(timeoutError);

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash' }
          ]);

          try {
            await ship.deploy(['./test.html']);
            expect.fail('Node.js deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('Request timeout after 30000ms');
          }
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue([
            { path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'hash' }
          ]);

          const mockFile = new File(['<html></html>'], 'test.html');
          try {
            await ship.deploy([mockFile]);
            expect.fail('Browser deploy should have been rejected');
          } catch (error: any) {
            expect(error.message).toBe('Request timeout after 30000ms');
          }
        }
      }
    });
  });

  describe('Real-World Deployment Scenarios', () => {
    it('should handle Vite build deployment consistently across environments', async () => {
      const viteFiles = [
        { path: 'index.html', content: '<!DOCTYPE html><html><head><script type="module" src="/assets/index.js"></script></head></html>' },
        { path: 'assets/index', content: 'import"./style.css";console.log("Vite app");' },
        { path: 'assets/style.css', content: 'body{margin:0;padding:0}' },
        { path: 'vite.svg', content: '<svg>...</svg>' }
      ];

      const results: any[] = [];

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue(
            viteFiles.map(f => ({
              path: f.path,
              content: Buffer.from(f.content),
              size: f.content.length,
              md5: `vite-${f.path}-hash`
            }))
          );

          const result = await ship.deploy(['./dist']);
          results.push(result);
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue(
            viteFiles.map(f => ({
              path: f.path,
              content: new TextEncoder().encode(f.content).buffer,
              size: f.content.length,
              md5: `vite-${f.path}-hash`
            }))
          );

          const mockFiles = viteFiles.map(f => new File([f.content], f.path));
          const result = await ship.deploy(mockFiles);
          results.push(result);
        }
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(mockApiClient.deploy).toHaveBeenCalledTimes(2);
    });

    it('should handle large file set deployment consistently', async () => {
      // Create a large set of files to test performance characteristics
      const largeFileSet = Array.from({ length: 50 }, (_, i) => ({
        path: `file-${i.toString().padStart(3, '0')}.txt`,
        content: `Content of file ${i}`.repeat(100) // Make each file substantial
      }));

      const results: any[] = [];

      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue(
            largeFileSet.map(f => ({
              path: f.path,
              content: Buffer.from(f.content),
              size: f.content.length,
              md5: `large-${f.path}-hash`
            }))
          );

          const filePaths = largeFileSet.map(f => `./${f.path}`);
          const result = await ship.deploy(filePaths);
          results.push(result);
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          (ship as any).processInput = vi.fn().mockResolvedValue(
            largeFileSet.map(f => ({
              path: f.path,
              content: new TextEncoder().encode(f.content).buffer,
              size: f.content.length,
              md5: `large-${f.path}-hash`
            }))
          );

          const mockFiles = largeFileSet.map(f => new File([f.content], f.path));
          const result = await ship.deploy(mockFiles);
          results.push(result);
        }
      }

      // Results should be identical
      expect(results[0]).toEqual(results[1]);
      expect(mockApiClient.deploy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Pipeline State Management Consistency', () => {
    it('should maintain consistent state throughout the pipeline across environments', async () => {
      for (const env of ['node', 'browser'] as const) {
        __setTestEnvironment(env);
        
        if (env === 'node') {
          const { Ship } = await import('../../src/node/index');
          const ship = new Ship({ apiKey: 'test-key' });
          (ship as any).http = mockApiClient;
          
          // Track state changes through the pipeline
          let stateLog: string[] = [];
          
          (ship as any).processInput = vi.fn().mockImplementation(async (input, options) => {
            stateLog.push(`processInput-called-with-${input.length}-files`);
            return [{ path: 'test.html', content: Buffer.from('<html></html>'), size: 13, md5: 'hash' }];
          });

          const originalDeploy = mockApiClient.deploy;
          mockApiClient.deploy = vi.fn().mockImplementation(async (files) => {
            stateLog.push(`api-deploy-called-with-${files.length}-files`);
            return originalDeploy(files);
          });

          await ship.deploy(['./test.html']);
          
          expect(stateLog).toEqual([
            'processInput-called-with-1-files',
            'api-deploy-called-with-1-files'
          ]);
        } else {
          const { Ship } = await import('../../src/browser/index');
          const ship = new Ship({ deployToken: 'test-token', apiUrl: 'https://api.test.com' });
          (ship as any).http = mockApiClient;
          
          // Track state changes through the pipeline
          let stateLog: string[] = [];
          
          (ship as any).processInput = vi.fn().mockImplementation(async (input, options) => {
            stateLog.push(`processInput-called-with-${input.length}-files`);
            return [{ path: 'test.html', content: new ArrayBuffer(13), size: 13, md5: 'hash' }];
          });

          const originalDeploy = mockApiClient.deploy;
          mockApiClient.deploy = vi.fn().mockImplementation(async (files) => {
            stateLog.push(`api-deploy-called-with-${files.length}-files`);
            return originalDeploy(files);
          });

          const mockFile = new File(['<html></html>'], 'test.html');
          await ship.deploy([mockFile]);
          
          expect(stateLog).toEqual([
            'processInput-called-with-1-files',
            'api-deploy-called-with-1-files'
          ]);
        }
      }
    });
  });
});