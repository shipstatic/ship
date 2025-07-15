import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShipError } from '@shipstatic/types';

// Mock dependencies
vi.mock('@/lib/env', () => ({
  getENV: vi.fn().mockReturnValue('node')
}));

vi.mock('@/lib/node-files', () => ({
  processFilesForNode: vi.fn().mockResolvedValue([
    { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
  ])
}));

vi.mock('@/lib/browser-files', () => ({
  processFilesForBrowser: vi.fn().mockResolvedValue([
    { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
  ])
}));

vi.mock('@/core/platform-config', () => ({
  getCurrentConfig: vi.fn().mockReturnValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024
  })
}));

vi.mock('@/lib/path', () => ({
  findCommonParent: vi.fn().mockReturnValue('/common/path')
}));

describe('prepare-input', () => {
  let prepareInput: typeof import('@/lib/prepare-input');

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Re-setup mocks after clearing
    const { getENV } = await import('@/lib/env');
    (getENV as any).mockReturnValue('node');
    
    const { processFilesForNode } = await import('@/lib/node-files');
    (processFilesForNode as any).mockResolvedValue([
      { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
    ]);
    
    const { processFilesForBrowser } = await import('@/lib/browser-files');
    (processFilesForBrowser as any).mockResolvedValue([
      { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
    ]);
    
    const { getCurrentConfig } = await import('@/core/platform-config');
    (getCurrentConfig as any).mockReturnValue({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024
    });
    
    const { findCommonParent } = await import('@/lib/path');
    (findCommonParent as any).mockReturnValue('/common/path');
    
    prepareInput = await import('@/lib/prepare-input');
  });

  describe('convertDeployInput', () => {
    it('should convert Node.js string array input', async () => {
      const result = await prepareInput.convertDeployInput(['./test.txt']);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should convert browser File array input', async () => {
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('browser');
      
      const mockFile = { name: 'test.txt', size: 4, type: 'text/plain' };
      const result = await prepareInput.convertDeployInput([mockFile] as any);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should handle empty input', async () => {
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValue([]);
      
      await expect(prepareInput.convertDeployInput([])).rejects.toThrow(
        ShipError.business('No files to deploy.')
      );
    });

    it('should handle invalid input type', async () => {
      await expect(prepareInput.convertDeployInput(null as any)).rejects.toThrow(
        ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.')
      );
    });
  });

  describe('convertNodeInput', () => {
    it('should process string array input', async () => {
      const result = await prepareInput.convertNodeInput(['./test.txt']);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should apply stripCommonPrefix option', async () => {
      const result = await prepareInput.convertNodeInput(['./test.txt'], { stripCommonPrefix: true });
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should handle non-string array input', async () => {
      await expect(prepareInput.convertNodeInput({ notArray: true } as any)).rejects.toThrow(
        ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.')
      );
    });

    it('should handle File objects in Node.js', async () => {
      const mockFile = { name: 'test.txt', size: 4, type: 'text/plain' };
      await expect(prepareInput.convertNodeInput([mockFile] as any)).rejects.toThrow(
        ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.')
      );
    });
  });

  describe('convertBrowserInput', () => {
    beforeEach(async () => {
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('browser');
    });

    it('should process File array input', async () => {
      const mockFile = { name: 'test.txt', size: 4, type: 'text/plain' };
      const result = await prepareInput.convertBrowserInput([mockFile] as any);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should process FileList input', async () => {
      const mockFileList = {
        0: { name: 'test.txt', size: 4, type: 'text/plain' },
        length: 1,
        item: (index: number) => index === 0 ? { name: 'test.txt', size: 4, type: 'text/plain' } : null
      };
      const result = await prepareInput.convertBrowserInput(mockFileList as any);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should process HTMLInputElement input', async () => {
      // Mock HTMLInputElement constructor for instanceof check
      global.HTMLInputElement = class MockHTMLInputElement {
        files: any[];
        constructor() {
          this.files = [{ name: 'test.txt', size: 4, type: 'text/plain' }];
        }
      } as any;
      
      const mockInput = new global.HTMLInputElement();
      const result = await prepareInput.convertBrowserInput(mockInput as any);
      
      expect(result).toEqual([
        { path: 'test.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 }
      ]);
    });

    it('should handle string array in browser environment', async () => {
      await expect(prepareInput.convertBrowserInput(['./test.txt'] as any)).rejects.toThrow(
        ShipError.business('Invalid input type for browser environment. Expected File[], FileList, or HTMLInputElement.')
      );
    });

    it('should handle empty FileList', async () => {
      const { processFilesForBrowser } = await import('@/lib/browser-files');
      (processFilesForBrowser as any).mockResolvedValue([]);
      
      const mockFileList = { length: 0, item: () => null };
      await expect(prepareInput.convertBrowserInput(mockFileList as any)).rejects.toThrow(
        ShipError.business('No files to deploy.')
      );
    });
  });

  describe('validation through public API', () => {
    it('should validate file count through convertDeployInput', async () => {
      // Ensure we're in node environment for string array input
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('node');
      
      const { getCurrentConfig } = await import('@/core/platform-config');
      getCurrentConfig.mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 2, // Set low limit for testing
        maxTotalSize: 100 * 1024 * 1024
      });

      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValue([
        { path: 'file1.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 },
        { path: 'file2.txt', content: Buffer.from('test'), md5: 'def456', size: 4 },
        { path: 'file3.txt', content: Buffer.from('test'), md5: 'ghi789', size: 4 }
      ]);

      await expect(prepareInput.convertDeployInput(['file1.txt', 'file2.txt', 'file3.txt'])).rejects.toThrow(
        ShipError.business('Too many files to deploy. Maximum allowed is 2.')
      );
    });

    it('should validate total size through convertDeployInput', async () => {
      // Ensure we're in node environment for string array input
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('node');
      
      const { getCurrentConfig } = await import('@/core/platform-config');
      getCurrentConfig.mockReturnValue({
        maxFileSize: 10 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 // Set low limit for testing
      });

      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValue([
        { path: 'file1.txt', content: Buffer.from('test'), md5: 'abc123', size: 150 } // Exceeds total size limit
      ]);

      await expect(prepareInput.convertDeployInput(['file1.txt'])).rejects.toThrow(
        ShipError.business('Total deploy size is too large. Maximum allowed is 0.000095367431640625MB.')
      );
    });
  });

  describe('path normalization through public API', () => {
    it('should normalize file paths through convertDeployInput', async () => {
      // Ensure we're in node environment for string array input
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('node');
      
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValue([
        { path: 'windows/path/file.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 },
        { path: 'relative/path/file.txt', content: Buffer.from('test'), md5: 'def456', size: 4 }
      ]);

      const result = await prepareInput.convertDeployInput(['\\windows\\path\\file.txt', './relative/path/file.txt']);

      expect(result).toEqual([
        { path: 'windows/path/file.txt', content: Buffer.from('test'), md5: 'abc123', size: 4 },
        { path: 'relative/path/file.txt', content: Buffer.from('test'), md5: 'def456', size: 4 }
      ]);
    });
  });
});