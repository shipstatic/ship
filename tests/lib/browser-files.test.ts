import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFilesForBrowser, findBrowserCommonParentDirectory } from '@/lib/browser-files';
import { __setTestEnvironment } from '@/lib/env';
import { ShipError, ShipErrorType } from '@shipstatic/types';

// Define mock implementations using vi.hoisted()
const { MOCK_CALCULATE_MD5_FN } = vi.hoisted(() => ({ MOCK_CALCULATE_MD5_FN: vi.fn() }));

// Mock modules
vi.mock('@/lib/md5', () => ({ calculateMD5: MOCK_CALCULATE_MD5_FN }));

// Helper to create a mock File with webkitRelativePath
function mockFile(name: string, webkitRelativePath?: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: webkitRelativePath,
      writable: false,
      configurable: true,
      enumerable: true
    });
  }
  return file;
}

// Helper to create a mock FileList from an array of Files
function mockFileList(files: File[]): FileList {
  // FileList is not constructible, so we fake it as closely as possible
  // Create an object for our mock FileList that doesn't include the array's own properties
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i];
      }
    }
  };
  
  // Add numeric indices manually
  files.forEach((file, index) => {
    Object.defineProperty(fileList, index, {
      value: file,
      enumerable: true
    });
  });
  return fileList;
}

describe('Browser File Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setTestEnvironment('browser');
    MOCK_CALCULATE_MD5_FN.mockResolvedValue({ md5: 'mocked-md5-for-file-utils' });
  });

  afterEach(() => {
    __setTestEnvironment(null);
  });

  describe('processFilesForBrowser', () => {
    it('should process FileList and call calculateMD5', async () => {
      const files = [ mockFile('img.png', 'folder/img.png') ];
      const fileList = mockFileList(files);
      const result = await processFilesForBrowser(fileList);
      expect(result[0].path).toBe('folder/img.png');
      expect(MOCK_CALCULATE_MD5_FN).toHaveBeenCalledWith(files[0]);
    });

    it('should process File[]', async () => {
      const files = [
        mockFile('file1.txt', 'path/to/file1.txt'),
        mockFile('file2.txt', 'path/to/file2.txt')
      ];
      const result = await processFilesForBrowser(files);
      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('path/to/file1.txt');
      expect(result[1].path).toBe('path/to/file2.txt');
    });

    it('should throw ShipClientError if called in non-browser env', async () => {
      __setTestEnvironment('node');
      await expect(processFilesForBrowser(mockFileList([]))).rejects.toThrow(
        ShipError.business('processFilesForBrowser can only be called in a browser environment.')
      );
    });
    
    it('should respect internal basePath implementation if provided', async () => {
      __setTestEnvironment('browser');
      const mockFiles = [
        mockFile('orig/path/file1.txt', 'orig/path/file1.txt'),
        mockFile('orig/path/dir/file2.txt', 'orig/path/dir/file2.txt')
      ];
      // Path stripping using basePath is now handled automatically when processing browser files
      // Using stripCommonPrefix: true to enable path stripping
      const result = await processFilesForBrowser(mockFiles, { stripCommonPrefix: true });
      // basePath is used to strip matching path prefixes
      expect(result[0].path).toBe('file1.txt');
      expect(result[1].path).toBe('dir/file2.txt');
    });
  });

  describe('findBrowserCommonParentDirectory', () => {
  it('returns common parent when all files are from the same folder', () => {
    const files = [
      mockFile('a.txt', 'my-folder/a.txt'),
      mockFile('b.txt', 'my-folder/b.txt'),
      mockFile('c.txt', 'my-folder/c.txt'),
    ];
    const fileList = mockFileList(files);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('my-folder');
  });

  it('returns empty string when files come from different folders', () => {
    const files = [
      mockFile('a.txt', 'folder1/a.txt'),
      mockFile('b.txt', 'folder2/b.txt'),
    ];
    const fileList = mockFileList(files);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('');
  });

  it('returns empty string when files are in the root (no directory)', () => {
    // Multiple files in root
    const files = [
      mockFile('a.txt', 'a.txt'),
      mockFile('b.txt', 'b.txt'),
    ];
    const fileList = mockFileList(files);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('');
  });

  it('returns full path for a single file with directory path', () => {
    // Single file in a directory
    const singleFile = mockFile('a.txt', 'my-folder/a.txt');
    const fileList = mockFileList([singleFile]);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('my-folder/a.txt');
  });
  
  it('returns full path for a single file in root (no directory)', () => {
    // Single file with no directory
    const singleFile = mockFile('a.txt', 'a.txt');
    const fileList = mockFileList([singleFile]);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('a.txt');
  });

  it('returns empty string if any file is missing webkitRelativePath', () => {
    const files = [
      mockFile('a.txt', 'my-folder/a.txt'),
      mockFile('b.txt'), // no webkitRelativePath
    ];
    const fileList = mockFileList(files);
    expect(findBrowserCommonParentDirectory(fileList)).toBe('');
  });
  
  it('throws ShipClientError if called in non-browser env', () => {
    __setTestEnvironment('node');
    expect(() => findBrowserCommonParentDirectory(mockFileList([]))).toThrow(
      ShipError.business('findBrowserCommonParentDirectory can only be called in a browser environment.')
    );
  });
});
});
