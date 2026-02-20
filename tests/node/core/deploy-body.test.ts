import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeployBody } from '../../../src/node/core/deploy-body';
import { ShipError } from '@shipstatic/types';
import type { StaticFile } from '../../../src/shared/types';

// Mock formdata-node and form-data-encoder
const mockFormDataAppend = vi.fn();
const mockFormDataInstance = {
  append: mockFormDataAppend
};

const mockEncoderEncode = vi.fn();
const mockEncoderInstance = {
  encode: mockEncoderEncode,
  contentType: 'multipart/form-data; boundary=----test-boundary'
};

vi.mock('formdata-node', () => ({
  FormData: vi.fn(() => mockFormDataInstance),
  File: vi.fn((content: any[], name: string, options: any) => ({
    content,
    name,
    type: options?.type
  }))
}));

vi.mock('form-data-encoder', () => ({
  FormDataEncoder: vi.fn(() => mockEncoderInstance)
}));

describe('Node.js Deploy Body Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default encoder mock - returns chunks that form a simple body
    mockEncoderEncode.mockImplementation(async function* () {
      yield Buffer.from('--boundary\r\n');
      yield Buffer.from('Content-Disposition: form-data; name="files[]"\r\n\r\n');
      yield Buffer.from('file-content');
      yield Buffer.from('\r\n--boundary--\r\n');
    });
  });

  describe('basic functionality', () => {
    it('should create deploy body from files with Buffer content', async () => {
      const files: StaticFile[] = [
        {
          path: 'index.html',
          content: Buffer.from('<html></html>'),
          size: 13,
          md5: 'abc123def456'
        }
      ];

      const result = await createDeployBody(files);

      expect(result).toBeDefined();
      expect(result.body).toBeInstanceOf(ArrayBuffer);
      expect(result.headers).toBeDefined();
      expect(result.headers['Content-Type']).toContain('multipart/form-data');
      expect(result.headers['Content-Length']).toBeDefined();
    });

    it('should append files to FormData with file path as name', async () => {
      const files: StaticFile[] = [
        {
          path: 'assets/style.css',
          content: Buffer.from('body {}'),
          size: 7,
          md5: 'css123'
        }
      ];

      await createDeployBody(files);

      // Check FormData.append was called with files[] (no third arg — File name is the path)
      expect(mockFormDataAppend).toHaveBeenCalledWith(
        'files[]',
        expect.objectContaining({ name: 'assets/style.css' })
      );
    });
  });

  describe('checksum handling', () => {
    it('should append checksums as JSON array', async () => {
      const files: StaticFile[] = [
        { path: 'file1.txt', content: Buffer.from('a'), size: 1, md5: 'md5-1' },
        { path: 'file2.txt', content: Buffer.from('b'), size: 1, md5: 'md5-2' },
        { path: 'file3.txt', content: Buffer.from('c'), size: 1, md5: 'md5-3' }
      ];

      await createDeployBody(files);

      expect(mockFormDataAppend).toHaveBeenCalledWith(
        'checksums',
        JSON.stringify(['md5-1', 'md5-2', 'md5-3'])
      );
    });

    it('should throw ShipError.file when md5 is missing', async () => {
      const files: StaticFile[] = [
        {
          path: 'missing-md5.txt',
          content: Buffer.from('content'),
          size: 7,
          md5: undefined as any // Simulate missing md5
        }
      ];

      await expect(createDeployBody(files)).rejects.toThrow(ShipError);
      await expect(createDeployBody(files)).rejects.toThrow('File missing md5 checksum');
    });
  });

  describe('labels handling', () => {
    it('should append labels as JSON when provided', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];
      const labels = ['production', 'v1.0.0', 'release'];

      await createDeployBody(files, labels);

      expect(mockFormDataAppend).toHaveBeenCalledWith(
        'labels',
        JSON.stringify(['production', 'v1.0.0', 'release'])
      );
    });

    it('should not append labels when array is empty', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];

      await createDeployBody(files, []);

      const tagsCall = mockFormDataAppend.mock.calls.find(
        (call: any[]) => call[0] === 'labels'
      );
      expect(tagsCall).toBeUndefined();
    });

    it('should not append labels when undefined', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];

      await createDeployBody(files);

      const tagsCall = mockFormDataAppend.mock.calls.find(
        (call: any[]) => call[0] === 'labels'
      );
      expect(tagsCall).toBeUndefined();
    });
  });

  describe('via field handling', () => {
    it('should append via field when provided', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];

      await createDeployBody(files, undefined, 'cli');

      expect(mockFormDataAppend).toHaveBeenCalledWith('via', 'cli');
    });

    it('should append via field with labels', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];

      await createDeployBody(files, ['tag1'], 'sdk');

      expect(mockFormDataAppend).toHaveBeenCalledWith('via', 'sdk');
      expect(mockFormDataAppend).toHaveBeenCalledWith(
        'labels',
        JSON.stringify(['tag1'])
      );
    });

    it('should not append via when undefined', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('x'), size: 1, md5: 'md5' }
      ];

      await createDeployBody(files);

      const viaCall = mockFormDataAppend.mock.calls.find(
        (call: any[]) => call[0] === 'via'
      );
      expect(viaCall).toBeUndefined();
    });
  });

  describe('content type handling', () => {
    it('should use correct MIME type from getMimeType', async () => {
      const files: StaticFile[] = [
        { path: 'script.js', content: Buffer.from('code'), size: 4, md5: 'js1' },
        { path: 'style.css', content: Buffer.from('css'), size: 3, md5: 'css1' },
        { path: 'page.html', content: Buffer.from('html'), size: 4, md5: 'html1' }
      ];

      await createDeployBody(files);

      // File constructor should be called with appropriate types
      const { File } = await import('formdata-node');
      expect(File).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling', () => {
    it('should throw ShipError.file for unsupported content type', async () => {
      const files: StaticFile[] = [
        {
          path: 'weird.txt',
          content: 'string-content' as any, // Not Buffer or Blob
          size: 14,
          md5: 'md5'
        }
      ];

      await expect(createDeployBody(files)).rejects.toThrow(ShipError);
      await expect(createDeployBody(files)).rejects.toThrow('Unsupported file.content type');
    });

    it('should include file path in error message for unsupported content', async () => {
      const files: StaticFile[] = [
        {
          path: 'specific/path/file.txt',
          content: { invalid: 'object' } as any,
          size: 10,
          md5: 'md5'
        }
      ];

      await expect(createDeployBody(files)).rejects.toThrow('specific/path/file.txt');
    });
  });

  describe('FormDataEncoder output', () => {
    it('should return correct headers from encoder', async () => {
      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('test'), size: 4, md5: 'md5' }
      ];

      const result = await createDeployBody(files);

      expect(result.headers['Content-Type']).toBe('multipart/form-data; boundary=----test-boundary');
    });

    it('should calculate Content-Length from encoded body', async () => {
      // Set up encoder to return known chunks
      mockEncoderEncode.mockImplementation(async function* () {
        yield Buffer.from('1234567890'); // 10 bytes
        yield Buffer.from('abcdefghij'); // 10 bytes
      });

      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('test'), size: 4, md5: 'md5' }
      ];

      const result = await createDeployBody(files);

      expect(result.headers['Content-Length']).toBe('20');
    });

    it('should concatenate all chunks into ArrayBuffer body', async () => {
      mockEncoderEncode.mockImplementation(async function* () {
        yield Buffer.from('chunk1');
        yield Buffer.from('chunk2');
        yield Buffer.from('chunk3');
      });

      const files: StaticFile[] = [
        { path: 'file.txt', content: Buffer.from('test'), size: 4, md5: 'md5' }
      ];

      const result = await createDeployBody(files);

      // Verify body is an ArrayBuffer with combined content
      expect(result.body).toBeInstanceOf(ArrayBuffer);
      const bodyText = Buffer.from(result.body).toString();
      expect(bodyText).toBe('chunk1chunk2chunk3');
    });
  });

  describe('multiple files', () => {
    it('should handle multiple files correctly', async () => {
      const files: StaticFile[] = [
        { path: 'file1.txt', content: Buffer.from('content1'), size: 8, md5: 'md5-1' },
        { path: 'file2.js', content: Buffer.from('content2'), size: 8, md5: 'md5-2' },
        { path: 'dir/file3.css', content: Buffer.from('content3'), size: 8, md5: 'md5-3' }
      ];

      await createDeployBody(files, ['tag1', 'tag2'], 'cli');

      // Should have 3 files[] appends, 1 checksums, 1 labels, 1 via
      const filesAppends = mockFormDataAppend.mock.calls.filter(
        (call: any[]) => call[0] === 'files[]'
      );
      expect(filesAppends).toHaveLength(3);

      // Verify file names match paths (no leading slash — aligned with browser)
      expect(filesAppends[0][1]).toEqual(expect.objectContaining({ name: 'file1.txt' }));
      expect(filesAppends[1][1]).toEqual(expect.objectContaining({ name: 'file2.js' }));
      expect(filesAppends[2][1]).toEqual(expect.objectContaining({ name: 'dir/file3.css' }));
    });

    it('should maintain order of files in checksums array', async () => {
      const files: StaticFile[] = [
        { path: 'a.txt', content: Buffer.from('a'), size: 1, md5: 'first' },
        { path: 'b.txt', content: Buffer.from('b'), size: 1, md5: 'second' },
        { path: 'c.txt', content: Buffer.from('c'), size: 1, md5: 'third' }
      ];

      await createDeployBody(files);

      const checksumsCall = mockFormDataAppend.mock.calls.find(
        (call: any[]) => call[0] === 'checksums'
      );
      expect(checksumsCall).toBeDefined();
      expect(JSON.parse(checksumsCall[1])).toEqual(['first', 'second', 'third']);
    });
  });

  describe('empty scenarios', () => {
    it('should handle empty files array', async () => {
      const files: StaticFile[] = [];

      const result = await createDeployBody(files);

      // Should still create valid body structure
      expect(result.body).toBeInstanceOf(ArrayBuffer);
      expect(result.headers['Content-Type']).toBeDefined();

      // Checksums should be empty array
      expect(mockFormDataAppend).toHaveBeenCalledWith('checksums', '[]');
    });
  });
});
