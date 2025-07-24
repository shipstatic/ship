import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShipError } from '@shipstatic/types';
import { Stats } from 'fs';

// Mock dependencies
vi.mock('@/lib/env', () => ({
  getENV: vi.fn().mockReturnValue('node')
}));

vi.mock('@/core/platform-config', () => ({
  getCurrentConfig: vi.fn().mockReturnValue({
    maxFileSize: 10 * 1024 * 1024,
    maxFilesCount: 1000,
    maxTotalSize: 100 * 1024 * 1024
  })
}));

// Mock filesystem operations
vi.mock('fs', () => ({
  statSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    resolve: vi.fn(),
    basename: vi.fn(),
    dirname: vi.fn(),
    join: vi.fn()
  };
});

// Mock file discovery
vi.mock('@/lib/node-files', () => ({
  processFilesForNode: vi.fn(),
  findAllFilePaths: vi.fn()
}));

// Mock browser file processing
vi.mock('@/lib/browser-files', () => ({
  processFilesForBrowser: vi.fn()
}));

describe('prepare-input flattenDirs behavior', () => {
  let prepareInput: typeof import('@/lib/prepare-input');

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const { getENV } = await import('@/lib/env');
    (getENV as any).mockReturnValue('node');
    
    const { getCurrentConfig } = await import('@/core/platform-config');
    (getCurrentConfig as any).mockReturnValue({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024
    });
    
    prepareInput = await import('@/lib/prepare-input');
  });

  describe('flattenDirs behavior with actual files', () => {
    it('should strip common directory prefix when enabled', async () => {
      // Mock processFilesForNode to return mock data
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValueOnce([
        { path: 'index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
        { path: 'css/style.css', content: Buffer.from('body {}'), md5: 'def456', size: 7 },
        { path: 'js/script.js', content: Buffer.from('console.log()'), md5: 'ghi789', size: 13 }
      ]);
      
      const result = await prepareInput.convertDeployInput(['/Users/test/demo-site'], { 
        flattenDirs: true 
      });
      
      // Verify that processFilesForNode was called with flattenDirs: true
      expect(processFilesForNode).toHaveBeenCalledWith(['/Users/test/demo-site'], expect.objectContaining({
        flattenDirs: true
      }));
      
      // All file paths should be relative (no security issues)
      result.forEach(file => {
        expect(file.path).not.toContain('..');
        expect(file.path).not.toContain('\0');
      });
    });

    it('should preserve directory structure when flattenDirs is false', async () => {
      // Mock processFilesForNode to return mock data with preserved paths
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValueOnce([
        { path: 'demo-site/index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
        { path: 'demo-site/css/style.css', content: Buffer.from('body {}'), md5: 'def456', size: 7 }
      ]);
      
      const result = await prepareInput.convertDeployInput(['/Users/test/demo-site'], { 
        flattenDirs: false 
      });
      
      // Verify that processFilesForNode was called with flattenDirs: false
      expect(processFilesForNode).toHaveBeenCalledWith(['/Users/test/demo-site'], expect.objectContaining({
        flattenDirs: false
      }));
      
      result.forEach(file => {
        expect(file.path).not.toContain('..');
        expect(file.path).not.toContain('\0');
      });
    });

    it('should handle multiple directories with flattenDirs', async () => {
      // Mock processFilesForNode to return mock data for multiple directories
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockResolvedValueOnce([
        { path: 'dist/index.html', content: Buffer.from('<html></html>'), md5: 'abc123', size: 13 },
        { path: 'public/readme.md', content: Buffer.from('# README'), md5: 'def456', size: 9 }
      ]);
      
      const result = await prepareInput.convertDeployInput([
        '/Users/test/project/dist',
        '/Users/test/project/public'
      ], { 
        flattenDirs: true 
      });
      
      // Verify the call was made with multiple paths
      expect(processFilesForNode).toHaveBeenCalledWith([
        '/Users/test/project/dist',
        '/Users/test/project/public'
      ], expect.objectContaining({
        flattenDirs: true
      }));
      
      result.forEach(file => {
        expect(file.path).not.toContain('..');
        expect(file.path).not.toContain('\0');
      });
    });
  });

  describe('security validation', () => {
    it('should reject paths with .. characters', async () => {
      // Mock processFilesForNode to throw security error for malicious paths
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockRejectedValueOnce(
        new ShipError('business', 'Security error: Path contains .. characters', 400)
      );
      
      await expect(prepareInput.convertDeployInput(['../malicious/path'], { 
        flattenDirs: true 
      })).rejects.toThrow(/Security error/);
    });

    it('should reject paths with null bytes', async () => {
      // Mock processFilesForNode to throw security error for null bytes
      const { processFilesForNode } = await import('@/lib/node-files');
      (processFilesForNode as any).mockRejectedValueOnce(
        new ShipError('business', 'Security error: Path contains null bytes', 400)
      );
      
      await expect(prepareInput.convertDeployInput(['file\0hidden.txt'], { 
        flattenDirs: true 
      })).rejects.toThrow(/Security error/);
    });
  });

  describe('input validation', () => {
    it('should handle empty input', async () => {
      await expect(prepareInput.convertDeployInput([])).rejects.toThrow(
        ShipError.business('No files to deploy.')
      );
    });

    it('should handle invalid input type in Node.js', async () => {
      await expect(prepareInput.convertDeployInput(null as any)).rejects.toThrow(
        ShipError.business('Invalid input type for Node.js environment. Expected string[] file paths.')
      );
    });
  });

  describe('browser environment', () => {
    beforeEach(async () => {
      const { getENV } = await import('@/lib/env');
      (getENV as any).mockReturnValue('browser');
    });

    it('should handle File array in browser with flattenDirs', async () => {
      // Mock processFilesForBrowser to return mock data
      const { processFilesForBrowser } = await import('@/lib/browser-files');
      (processFilesForBrowser as any).mockResolvedValueOnce([
        { path: 'index.html', content: new Blob(['<html></html>']), md5: 'abc123', size: 13 },
        { path: 'style.css', content: new Blob(['body {}']), md5: 'def456', size: 7 }
      ]);
      
      const mockFiles = [
        { name: 'index.html', size: 100, webkitRelativePath: 'mysite/index.html' },
        { name: 'style.css', size: 50, webkitRelativePath: 'mysite/style.css' }
      ];
      
      const result = await prepareInput.convertDeployInput(mockFiles as any, { 
        flattenDirs: true 
      });
      
      // Verify that processFilesForBrowser was called with flattenDirs: true
      expect(processFilesForBrowser).toHaveBeenCalledWith(mockFiles, expect.objectContaining({
        flattenDirs: true
      }));
      
      result.forEach(file => {
        expect(file.path).not.toContain('..');
        expect(file.path).not.toContain('\0');
      });
    });

    it('should preserve paths when flattenDirs is false in browser', async () => {
      // Mock processFilesForBrowser to return mock data with preserved paths
      const { processFilesForBrowser } = await import('@/lib/browser-files');
      (processFilesForBrowser as any).mockResolvedValueOnce([
        { path: 'mysite/index.html', content: new Blob(['<html></html>']), md5: 'abc123', size: 13 }
      ]);
      
      const mockFiles = [
        { name: 'index.html', size: 100, webkitRelativePath: 'mysite/index.html' }
      ];
      
      const result = await prepareInput.convertDeployInput(mockFiles as any, { 
        flattenDirs: false 
      });
      
      // Verify that processFilesForBrowser was called with flattenDirs: false
      expect(processFilesForBrowser).toHaveBeenCalledWith(mockFiles, expect.objectContaining({
        flattenDirs: false
      }));
      
      result.forEach(file => {
        expect(file.path).not.toContain('..');
        expect(file.path).not.toContain('\0');
      });
    });
  });
});