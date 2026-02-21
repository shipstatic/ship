import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeployBody } from '../../../src/browser/core/deploy-body';
import { ShipError } from '@shipstatic/types';
import type { StaticFile } from '../../../src/shared/types';

describe('createDeployBody (browser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockFile(path: string, content: string, md5: string): StaticFile {
    const blob = new Blob([content], { type: 'text/plain' });
    return {
      path,
      content: new File([blob], path, { type: 'text/plain' }),
      size: content.length,
      md5
    };
  }

  describe('basic functionality', () => {
    it('should create FormData with files and checksums', async () => {
      const files: StaticFile[] = [
        createMockFile('index.html', '<html></html>', 'abc123'),
        createMockFile('style.css', 'body {}', 'def456')
      ];

      const result = await createDeployBody(files);

      expect(result.body).toBeInstanceOf(FormData);
      expect(result.headers).toEqual({});

      const formData = result.body as FormData;
      const fileEntries = formData.getAll('files[]');
      expect(fileEntries).toHaveLength(2);

      const checksums = formData.get('checksums');
      expect(checksums).toBe(JSON.stringify(['abc123', 'def456']));
    });

    it('should preserve file paths in FormData', async () => {
      const files: StaticFile[] = [
        createMockFile('src/components/Button.tsx', 'export default Button', 'hash1')
      ];

      const result = await createDeployBody(files);
      const formData = result.body as FormData;
      const fileEntry = formData.get('files[]') as File;

      expect(fileEntry.name).toBe('src/components/Button.tsx');
    });
  });

  describe('labels handling', () => {
    it('should add labels when provided', async () => {
      const files: StaticFile[] = [createMockFile('index.html', '<html></html>', 'abc123')];

      const result = await createDeployBody(files, ['production', 'v1.0.0']);

      const formData = result.body as FormData;
      const labels = formData.get('labels');
      expect(labels).toBe(JSON.stringify(['production', 'v1.0.0']));
    });

    it('should not add labels field when labels array is empty', async () => {
      const files: StaticFile[] = [createMockFile('index.html', '<html></html>', 'abc123')];

      const result = await createDeployBody(files, []);

      const formData = result.body as FormData;
      expect(formData.get('labels')).toBeNull();
    });

    it('should not add labels field when labels is undefined', async () => {
      const files: StaticFile[] = [createMockFile('index.html', '<html></html>', 'abc123')];

      const result = await createDeployBody(files);

      const formData = result.body as FormData;
      expect(formData.get('labels')).toBeNull();
    });
  });

  describe('via handling', () => {
    it('should add via when provided', async () => {
      const files: StaticFile[] = [createMockFile('index.html', '<html></html>', 'abc123')];

      const result = await createDeployBody(files, undefined, 'sdk');

      const formData = result.body as FormData;
      expect(formData.get('via')).toBe('sdk');
    });

    it('should not add via field when via is undefined', async () => {
      const files: StaticFile[] = [createMockFile('index.html', '<html></html>', 'abc123')];

      const result = await createDeployBody(files);

      const formData = result.body as FormData;
      expect(formData.get('via')).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should throw for non-File/Blob content', async () => {
      const files: StaticFile[] = [{
        path: 'test.txt',
        content: Buffer.from('test') as any,
        size: 4,
        md5: 'abc123'
      }];

      await expect(createDeployBody(files)).rejects.toThrow(ShipError);
      await expect(createDeployBody(files)).rejects.toThrow('Unsupported file.content type for browser');
    });

    it('should throw for missing md5', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const files: StaticFile[] = [{
        path: 'test.txt',
        content: new File([blob], 'test.txt', { type: 'text/plain' }),
        size: 4,
        md5: undefined as any
      }];

      await expect(createDeployBody(files)).rejects.toThrow(ShipError);
      await expect(createDeployBody(files)).rejects.toThrow('File missing md5 checksum');
    });
  });

  describe('content type handling', () => {
    it('should use application/octet-stream for all files (API derives Content-Type from extension)', async () => {
      const blob = new Blob(['test'], { type: 'application/json' });
      const files: StaticFile[] = [{
        path: 'data.json',
        content: new File([blob], 'data.json', { type: 'application/json' }),
        size: 4,
        md5: 'abc123'
      }];

      const result = await createDeployBody(files);
      const formData = result.body as FormData;
      const fileEntry = formData.get('files[]') as File;

      expect(fileEntry.type).toBe('application/octet-stream');
    });

    it('should handle Blob content', async () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const files: StaticFile[] = [{
        path: 'test.txt',
        content: blob,
        size: 4,
        md5: 'abc123'
      }];

      const result = await createDeployBody(files);
      const formData = result.body as FormData;
      const fileEntry = formData.get('files[]') as File;

      expect(fileEntry).toBeInstanceOf(File);
      expect(fileEntry.name).toBe('test.txt');
    });
  });
});
