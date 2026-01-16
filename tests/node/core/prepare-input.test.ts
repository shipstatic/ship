import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShipError } from '@shipstatic/types';
import { __setTestEnvironment } from '../../../src/shared/lib/env';
import { setConfig } from '../../../src/shared/core/platform-config';

// Mock the node-files module
vi.mock('../../../src/node/core/node-files', () => ({
  processFilesForNode: vi.fn()
}));

// Mock the browser-files module
vi.mock('../../../src/browser/lib/browser-files', () => ({
  processFilesForBrowser: vi.fn()
}));

// Import after mocks are set up
import { convertNodeInput, convertBrowserInput, convertDeployInput } from '../../../src/node/core/prepare-input';
import { processFilesForNode } from '../../../src/node/core/node-files';
import { processFilesForBrowser } from '../../../src/browser/lib/browser-files';

describe('Node Core Prepare Input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('node');

    // Set default platform config
    setConfig({
      maxFileSize: 10 * 1024 * 1024,
      maxFilesCount: 1000,
      maxTotalSize: 100 * 1024 * 1024,
    });
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });

  describe('convertNodeInput', () => {
    it('should convert string[] paths to StaticFile[]', async () => {
      const mockFiles = [
        { path: 'index.html', content: Buffer.from('<html>'), size: 6, md5: 'abc123' }
      ];
      (processFilesForNode as any).mockResolvedValue(mockFiles);

      const result = await convertNodeInput(['./dist']);

      expect(processFilesForNode).toHaveBeenCalledWith(['./dist'], {});
      expect(result).toEqual(mockFiles);
    });

    it('should pass options to processFilesForNode', async () => {
      const mockFiles = [
        { path: 'app.js', content: Buffer.from('code'), size: 4, md5: 'def456' }
      ];
      (processFilesForNode as any).mockResolvedValue(mockFiles);
      const options = { pathDetect: false };

      await convertNodeInput(['./src'], options);

      expect(processFilesForNode).toHaveBeenCalledWith(['./src'], options);
    });

    it('should throw on empty input array', async () => {
      await expect(convertNodeInput([])).rejects.toThrow('No files to deploy');
    });

    it('should throw on non-array input', async () => {
      await expect(convertNodeInput('not-an-array' as any)).rejects.toThrow('Invalid input type');
    });

    it('should throw on array with non-string items', async () => {
      await expect(convertNodeInput([123, 456] as any)).rejects.toThrow('Invalid input type');
    });

    it('should throw when file exceeds max size', async () => {
      const oversizedFiles = [
        { path: 'huge.bin', content: Buffer.alloc(1), size: 50 * 1024 * 1024, md5: 'xyz' }
      ];
      (processFilesForNode as any).mockResolvedValue(oversizedFiles);

      await expect(convertNodeInput(['./large'])).rejects.toThrow('too large');
    });

    it('should throw when file count exceeds limit', async () => {
      const tooManyFiles = Array.from({ length: 1001 }, (_, i) => ({
        path: `file${i}.txt`,
        content: Buffer.from('x'),
        size: 1,
        md5: 'hash'
      }));
      (processFilesForNode as any).mockResolvedValue(tooManyFiles);

      await expect(convertNodeInput(['./many'])).rejects.toThrow('Too many files');
    });

    it('should throw when total size exceeds limit', async () => {
      // Use files under individual limit (10MB) but exceeding total limit (100MB)
      const largeFiles = [
        { path: 'a.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'a' },
        { path: 'b.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'b' },
        { path: 'c.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'c' },
        { path: 'd.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'd' },
        { path: 'e.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'e' },
        { path: 'f.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'f' },
        { path: 'g.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'g' },
        { path: 'h.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'h' },
        { path: 'i.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'i' },
        { path: 'j.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'j' },
        { path: 'k.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'k' },
        { path: 'l.bin', content: Buffer.alloc(1), size: 9 * 1024 * 1024, md5: 'l' }
      ];
      (processFilesForNode as any).mockResolvedValue(largeFiles);

      await expect(convertNodeInput(['./big'])).rejects.toThrow('Total deploy size is too large');
    });

    it('should normalize backslashes in paths', async () => {
      const mockFiles = [
        { path: 'assets\\css\\style.css', content: Buffer.from('body{}'), size: 6, md5: 'hash' }
      ];
      (processFilesForNode as any).mockResolvedValue(mockFiles);

      const result = await convertNodeInput(['./dist']);

      expect(result[0].path).toBe('assets/css/style.css');
    });
  });

  describe('convertBrowserInput', () => {
    beforeEach(() => {
      __setTestEnvironment('browser');
    });

    it('should convert File[] to StaticFile[]', async () => {
      const mockInputFiles = [
        { name: 'test.html', size: 100 }
      ] as File[];
      const mockOutputFiles = [
        { path: 'test.html', content: Buffer.from('<html>'), size: 100, md5: 'abc' }
      ];
      (processFilesForBrowser as any).mockResolvedValue(mockOutputFiles);

      const result = await convertBrowserInput(mockInputFiles);

      expect(processFilesForBrowser).toHaveBeenCalledWith(mockInputFiles, {});
      expect(result).toEqual(mockOutputFiles);
    });

    it('should filter out empty files with warning', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockInputFiles = [
        { name: 'empty.txt', size: 0 },
        { name: 'content.txt', size: 50 }
      ] as File[];
      const mockOutputFiles = [
        { path: 'content.txt', content: Buffer.from('data'), size: 50, md5: 'xyz' }
      ];
      (processFilesForBrowser as any).mockResolvedValue(mockOutputFiles);

      const result = await convertBrowserInput(mockInputFiles);

      expect(consoleSpy).toHaveBeenCalledWith('Skipping empty file: empty.txt');
      expect(result).toEqual(mockOutputFiles);
      consoleSpy.mockRestore();
    });

    it('should throw on string[] input in browser', async () => {
      await expect(convertBrowserInput(['./path'] as any)).rejects.toThrow('Invalid input type for browser');
    });

    it('should throw on non-array input', async () => {
      await expect(convertBrowserInput('not-array' as any)).rejects.toThrow('Invalid input type for browser');
    });

    it('should validate file sizes before processing', async () => {
      const oversizedFiles = [
        { name: 'huge.bin', size: 50 * 1024 * 1024 }
      ] as File[];

      await expect(convertBrowserInput(oversizedFiles)).rejects.toThrow('too large');
      expect(processFilesForBrowser).not.toHaveBeenCalled();
    });

    it('should throw on empty file array after filtering', async () => {
      const emptyFiles = [
        { name: 'empty1.txt', size: 0 },
        { name: 'empty2.txt', size: 0 }
      ] as File[];
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(convertBrowserInput(emptyFiles)).rejects.toThrow('No files to deploy');
    });
  });

  describe('convertDeployInput', () => {
    describe('node environment', () => {
      beforeEach(() => {
        __setTestEnvironment('node');
      });

      it('should convert single string path to string[]', async () => {
        const mockFiles = [
          { path: 'index.html', content: Buffer.from('<html>'), size: 6, md5: 'abc' }
        ];
        (processFilesForNode as any).mockResolvedValue(mockFiles);

        const result = await convertDeployInput('./dist');

        expect(processFilesForNode).toHaveBeenCalledWith(['./dist'], {});
        expect(result).toEqual(mockFiles);
      });

      it('should handle string[] input directly', async () => {
        const mockFiles = [
          { path: 'app.js', content: Buffer.from('code'), size: 4, md5: 'def' }
        ];
        (processFilesForNode as any).mockResolvedValue(mockFiles);

        const result = await convertDeployInput(['./src', './public']);

        expect(processFilesForNode).toHaveBeenCalledWith(['./src', './public'], {});
        expect(result).toEqual(mockFiles);
      });

      it('should throw on invalid input type in node', async () => {
        await expect(convertDeployInput({ invalid: true } as any)).rejects.toThrow('Invalid input type for Node.js');
      });

      it('should pass options through', async () => {
        const mockFiles = [
          { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'z' }
        ];
        (processFilesForNode as any).mockResolvedValue(mockFiles);
        const options = { pathDetect: false, spaDetect: false };

        await convertDeployInput('./dist', options);

        expect(processFilesForNode).toHaveBeenCalledWith(['./dist'], options);
      });
    });

    describe('browser environment', () => {
      beforeEach(() => {
        __setTestEnvironment('browser');
      });

      it('should convert File[] input', async () => {
        const mockInputFiles = [
          { name: 'index.html', size: 100 }
        ] as File[];
        const mockOutputFiles = [
          { path: 'index.html', content: Buffer.from('<html>'), size: 100, md5: 'abc' }
        ];
        (processFilesForBrowser as any).mockResolvedValue(mockOutputFiles);

        const result = await convertDeployInput(mockInputFiles as any);

        expect(processFilesForBrowser).toHaveBeenCalled();
        expect(result).toEqual(mockOutputFiles);
      });
    });

    describe('unsupported environment', () => {
      it('should throw on unsupported environment', async () => {
        __setTestEnvironment('unsupported' as any);

        await expect(convertDeployInput('./dist')).rejects.toThrow('Unsupported execution environment');
      });
    });
  });

  describe('validation edge cases', () => {
    it('should validate file count at boundary', async () => {
      // Exactly at limit should pass
      const exactFiles = Array.from({ length: 1000 }, (_, i) => ({
        path: `file${i}.txt`,
        content: Buffer.from('x'),
        size: 1,
        md5: 'hash'
      }));
      (processFilesForNode as any).mockResolvedValue(exactFiles);

      const result = await convertNodeInput(['./exactly1000']);
      expect(result).toHaveLength(1000);
    });

    it('should validate total size incrementally', async () => {
      // First file is fine, but adding second exceeds limit
      setConfig({
        maxFileSize: 60 * 1024 * 1024,
        maxFilesCount: 1000,
        maxTotalSize: 100 * 1024 * 1024,
      });

      const filesExceedingTotal = [
        { path: 'a.bin', content: Buffer.alloc(1), size: 60 * 1024 * 1024, md5: 'a' },
        { path: 'b.bin', content: Buffer.alloc(1), size: 50 * 1024 * 1024, md5: 'b' }
      ];
      (processFilesForNode as any).mockResolvedValue(filesExceedingTotal);

      await expect(convertNodeInput(['./big'])).rejects.toThrow('Total deploy size is too large');
    });
  });
});
