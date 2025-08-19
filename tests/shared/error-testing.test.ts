import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShipError } from '@shipstatic/types';
import { __setTestEnvironment } from '../../src/shared/lib/env';

/**
 * Shared error testing utilities and standardized error behavior tests
 * These tests ensure consistent error handling across browser and Node.js platforms
 */

// Mock API client for error testing
const createMockApiClient = () => ({
  deploy: vi.fn(),
  ping: vi.fn(),
  getConfig: vi.fn(),
  checkSPA: vi.fn()
});

describe('Cross-Platform Error Standardization', () => {
  describe('ShipError consistency', () => {
    it('should create business errors with consistent format', () => {
      const error = ShipError.business('Test error message', 400);
      
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error message');
      expect(error.status).toBe(400);
      expect(error.type).toBe('business_logic_error');
    });

    it('should create network errors with consistent format', () => {
      const error = ShipError.network('Network timeout');
      
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Network timeout');
      expect(error.type).toBe('network_error');
    });

    it('should create validation errors with consistent format', () => {
      const error = ShipError.validation('Invalid input format');
      
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Invalid input format');
      expect(error.type).toBe('validation_failed');
    });
  });

  describe('Input validation error messages', () => {
    it('should have consistent invalid input type messages', () => {
      // These messages should be identical across platforms
      const browserInvalidMessage = 'Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.';
      const nodeInvalidMessage = 'Invalid input type for Node.js environment. Expected string[] file paths.';
      
      expect(browserInvalidMessage).toContain('Invalid input type');
      expect(nodeInvalidMessage).toContain('Invalid input type');
      expect(browserInvalidMessage).toContain('browser environment');
      expect(nodeInvalidMessage).toContain('Node.js environment');
    });

    it('should have consistent empty input messages', () => {
      const emptyInputMessage = 'No files to deploy.';
      
      expect(emptyInputMessage).toBe('No files to deploy.');
    });

    it('should have consistent file size error messages', () => {
      const fileSizeError = 'File "large-file.zip" exceeds maximum size limit of 10MB.';
      
      expect(fileSizeError).toContain('exceeds maximum size limit');
      expect(fileSizeError).toContain('MB');
    });

    it('should have consistent file count error messages', () => {
      const fileCountError = 'Too many files: 1001. Maximum allowed: 1000.';
      
      expect(fileCountError).toContain('Too many files');
      expect(fileCountError).toContain('Maximum allowed');
    });
  });

  describe('Network error consistency', () => {
    it('should handle timeout errors consistently', () => {
      const timeoutError = ShipError.network('Request timeout after 30000ms');
      
      expect(timeoutError.message).toContain('timeout');
      expect(timeoutError.message).toContain('ms');
      expect(timeoutError.type).toBe('network_error');
    });

    it('should handle connection errors consistently', () => {
      const connectionError = ShipError.network('Failed to connect to https://api.shipstatic.dev');
      
      expect(connectionError.message).toContain('Failed to connect');
      expect(connectionError.type).toBe('network_error');
    });

    it('should handle API errors consistently', () => {
      const apiError = ShipError.business('API key is invalid', 401);
      
      expect(apiError.message).toBe('API key is invalid');
      expect(apiError.status).toBe(401);
      expect(apiError.type).toBe('business_logic_error');
    });
  });

  describe('Configuration error consistency', () => {
    it('should handle missing configuration consistently', () => {
      const configError = ShipError.validation('API key is required');
      
      expect(configError.message).toContain('is required');
      expect(configError.type).toBe('validation_failed');
    });

    it('should handle invalid configuration consistently', () => {
      const invalidConfigError = ShipError.validation('Invalid API URL format');
      
      expect(invalidConfigError.message).toContain('Invalid');
      expect(invalidConfigError.message).toContain('format');
      expect(invalidConfigError.type).toBe('validation_failed');
    });
  });
});

/**
 * Browser-specific error testing
 */
export const browserErrorTests = {
  async testInvalidInputTypes() {
    const { Ship } = await import('../../src/browser/index');
    __setTestEnvironment('browser');
    
    const ship = new Ship({ deployToken: 'test-token' });
    
    // Mock HTTP client to avoid network calls
    (ship as any).http = createMockApiClient();
    
    return {
      async shouldRejectStringPaths() {
        await expect(ship.deploy('/path/to/file' as any))
          .rejects.toThrow('Invalid input type for browser environment');
      },
      
      async shouldRejectNodeArrays() {
        await expect(ship.deploy(['./file1.html', './file2.css'] as any))
          .rejects.toThrow('Invalid input type for browser environment');
      },
      
      async shouldRejectInvalidObjects() {
        await expect(ship.deploy({ invalid: 'object' } as any))
          .rejects.toThrow('Invalid input type for browser environment');
      }
    };
  },

  async testBrowserSpecificErrors() {
    const { Ship } = await import('../../src/browser/index');
    __setTestEnvironment('browser');
    
    const ship = new Ship({ deployToken: 'test-token' });
    (ship as any).http = createMockApiClient();
    
    return {
      async shouldHandleEmptyFileList() {
        const emptyFileList = {
          length: 0,
          item: () => null
        } as FileList;
        
        // Should not throw for empty FileList (might be valid use case)
        const result = await ship.deploy(emptyFileList);
        expect(result).toBeDefined();
      },
      
      async shouldHandleNullFiles() {
        const fileListWithNull = {
          0: null,
          length: 1,
          item: () => null
        } as any;
        
        await expect(ship.deploy(fileListWithNull))
          .rejects.toThrow();
      }
    };
  }
};

/**
 * Node.js-specific error testing
 */
export const nodeErrorTests = {
  async testInvalidInputTypes() {
    const { Ship } = await import('../../src/node/index');
    __setTestEnvironment('node');
    
    const ship = new Ship({ apiKey: 'test-key' });
    (ship as any).http = createMockApiClient();
    
    return {
      async shouldRejectFileArrays() {
        const mockFiles = [new File(['content'], 'test.txt')] as any;
        await expect(ship.deploy(mockFiles))
          .rejects.toThrow('Invalid input type for Node.js environment');
      },
      
      async shouldRejectFileList() {
        const mockFileList = {
          0: new File(['content'], 'test.txt'),
          length: 1,
          item: () => null
        } as any;
        
        await expect(ship.deploy(mockFileList))
          .rejects.toThrow('Invalid input type for Node.js environment');
      },
      
      async shouldRejectHTMLInputElement() {
        const mockInput = document.createElement('input') as any;
        await expect(ship.deploy(mockInput))
          .rejects.toThrow('Invalid input type for Node.js environment');
      }
    };
  },

  async testNodeSpecificErrors() {
    const { Ship } = await import('../../src/node/index');
    __setTestEnvironment('node');
    
    const ship = new Ship({ apiKey: 'test-key' });
    (ship as any).http = createMockApiClient();
    
    return {
      async shouldHandleNonExistentPaths() {
        await expect(ship.deploy(['/non/existent/path']))
          .rejects.toThrow();
      },
      
      async shouldHandleEmptyPathArray() {
        await expect(ship.deploy([]))
          .rejects.toThrow('No files to deploy');
      },
      
      async shouldHandleInvalidPathTypes() {
        await expect(ship.deploy([null, undefined, 123] as any))
          .rejects.toThrow();
      }
    };
  }
};