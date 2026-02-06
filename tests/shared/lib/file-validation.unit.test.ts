/**
 * Tests for file validation utilities
 */
import { describe, it, expect } from 'vitest';
import {
  validateFiles,
  formatFileSize,
  getValidFiles,
  allValidFilesReady,
  FILE_VALIDATION_STATUS,
  type ValidatableFile,
  type FileValidationResult,
} from '../../../src/shared/lib/file-validation.js';
import type { ConfigResponse } from '@shipstatic/types';

// Mock file helper
function createMockFile(name: string, size: number, type: string = 'text/plain'): ValidatableFile {
  return {
    name,
    size,
    type,
    status: FILE_VALIDATION_STATUS.PENDING,
  };
}

describe('File Validation', () => {
  describe('validateFiles - At Least 1 File Required', () => {
    it('should reject empty file array', () => {
      const config: ConfigResponse = {
        maxFileSize: 5 * 1024 * 1024,
        maxTotalSize: 25 * 1024 * 1024,
        maxFilesCount: 100,
        allowedMimeTypes: ['text/', 'image/'],
      };

      const result = validateFiles([], config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('No Files Provided');
      expect(result.error?.details).toBe('At least one file must be provided');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 Bytes');
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
      expect(formatFileSize(500)).toBe('500 Bytes');
      expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
    });

    it('should handle decimals parameter', () => {
      expect(formatFileSize(1024 * 1024 * 1.567, 0)).toBe('2 MB');
      expect(formatFileSize(1024 * 1024 * 1.567, 1)).toBe('1.6 MB');
      expect(formatFileSize(1024 * 1024 * 1.567, 3)).toBe('1.567 MB');
    });
  });

  describe('validateFiles', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024, // 5MB
      maxTotalSize: 25 * 1024 * 1024, // 25MB
      maxFilesCount: 100,
      allowedMimeTypes: [
        'text/',
        'image/',
        'application/json',
        'application/pdf',
      ],
    };

    it('should mark all files as valid when within limits', () => {
      const files = [
        createMockFile('file1.txt', 1024),
        createMockFile('file2.txt', 2048),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(2);
      expect(result.error).toBeNull();
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.READY);
        expect(f.statusMessage).toBe('Ready for upload');
      });
    });

    it('should reject when file count exceeds limit', () => {
      const files = Array.from({ length: 101 }, (_, i) =>
        createMockFile(`file${i}.txt`, 100)
      );

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('File Count Exceeded');
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });

    it('should reject empty files (atomic - rejects all)', () => {
      const files = [
        createMockFile('empty.txt', 0),
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      // ATOMIC: If any file fails, all are rejected
      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Empty File');
      expect(result.error?.errors).toHaveLength(1);
      expect(result.error?.errors[0]).toContain('empty.txt');
      expect(result.error?.details).toBe('empty.txt: File is empty (0 bytes)');
      // All files marked as failed
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should reject files exceeding individual size limit (atomic)', () => {
      const files = [
        createMockFile('huge.txt', 6 * 1024 * 1024), // 6MB
        createMockFile('ok.txt', 100),
      ];

      const result = validateFiles(files, config);

      // ATOMIC: All files rejected if any fails
      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('File Too Large');
      // All files marked as failed
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should reject when total size exceeds limit (atomic)', () => {
      const largeConfig: ConfigResponse = {
        maxFileSize: 15 * 1024 * 1024, // 15MB per file
        maxTotalSize: 25 * 1024 * 1024, // 25MB total
        maxFilesCount: 100,
        allowedMimeTypes: config.allowedMimeTypes,
      };

      const files = [
        createMockFile('file1.txt', 10 * 1024 * 1024), // 10MB
        createMockFile('file2.txt', 10 * 1024 * 1024), // 10MB - total 20MB (ok individually)
        createMockFile('file3.txt', 6 * 1024 * 1024),  // 6MB - total 26MB (exceeds)
      ];

      const result = validateFiles(files, largeConfig);

      // ATOMIC: All files rejected if total size exceeded
      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Total Size Exceeded');
      // All files marked as failed
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[2].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should preserve PROCESSING_ERROR status (atomic)', () => {
      const files = [
        {
          ...createMockFile('failed.txt', 100),
          status: FILE_VALIDATION_STATUS.PROCESSING_ERROR,
          statusMessage: 'Failed to process',
        },
        createMockFile('good.txt', 100),
      ];

      const result = validateFiles(files, config);

      // ATOMIC: All files rejected if any has processing error
      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Processing Error');
      // All files marked as failed
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    describe('MIME type validation', () => {
      it('should accept files with allowed MIME types', () => {
        const files = [
          createMockFile('doc.txt', 100, 'text/plain'),
          createMockFile('image.png', 100, 'image/png'),
          createMockFile('data.json', 100, 'application/json'),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(3);
        expect(result.error).toBeNull();
        result.files.forEach(f => {
          expect(f.status).toBe(FILE_VALIDATION_STATUS.READY);
        });
      });

      it('should reject files with disallowed MIME types (atomic)', () => {
        const files = [
          createMockFile('app.wasm', 100, 'application/wasm'),
          createMockFile('valid.txt', 100, 'text/plain'),
        ];

        const result = validateFiles(files, config);

        // ATOMIC: All files rejected if any has invalid MIME type
        expect(result.validFiles).toHaveLength(0);
        expect(result.error?.error).toBe('Invalid File Type');
        expect(result.error?.details).toContain('application/wasm');
        // All files marked as failed
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });

      it('should accept MIME types that match category prefixes', () => {
        const files = [
          createMockFile('doc.html', 100, 'text/html'),
          createMockFile('style.css', 100, 'text/css'),
          createMockFile('photo.jpg', 100, 'image/jpeg'),
          createMockFile('icon.svg', 100, 'image/svg+xml'),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(4);
        expect(result.error).toBeNull();
        result.files.forEach(f => {
          expect(f.status).toBe(FILE_VALIDATION_STATUS.READY);
        });
      });

      it('should reject files with empty MIME type', () => {
        const files = [
          { ...createMockFile('unknown.xyz', 100, ''), type: '' },
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(0);
        expect(result.error?.error).toBe('Missing MIME Type');
      });

      it('should reject multiple files with invalid types (atomic)', () => {
        const files = [
          createMockFile('valid.txt', 100, 'text/plain'),
          createMockFile('bad1.exe', 100, 'application/x-msdownload'),
          createMockFile('bad2.bin', 100, 'application/octet-stream'),
        ];

        const result = validateFiles(files, config);

        // ATOMIC: All files rejected
        expect(result.validFiles).toHaveLength(0);
        expect(result.error?.error).toBe('Invalid File Type');
        expect(result.error?.details).toBe('2 file(s) failed validation');
        // Verify all errors are in the errors array
        expect(result.error?.errors).toHaveLength(2);
        expect(result.error?.errors[0]).toContain('bad1.exe');
        expect(result.error?.errors[0]).toContain('application/x-msdownload');
        expect(result.error?.errors[1]).toContain('bad2.bin');
        expect(result.error?.errors[1]).toContain('application/octet-stream');
        // All files marked as failed
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[2].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });

      it('should not allow wasm files', () => {
        const files = [
          createMockFile('app.wasm', 100, 'application/wasm'),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(0);
        expect(result.error?.error).toBe('Invalid File Type');
      });
    });

    it('should work with generic ValidatableFile interface', () => {
      // Custom file type that extends ValidatableFile
      interface CustomFile extends ValidatableFile {
        customProperty: string;
      }

      const files: CustomFile[] = [
        {
          name: 'test.txt',
          size: 100,
          type: 'text/plain',
          customProperty: 'custom value',
        },
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(1);
      expect(result.validFiles[0].customProperty).toBe('custom value');
    });
  });

  describe('File Name Validation', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['text/'],
    };

    it('should reject empty file names (atomic)', () => {
      const files = [
        { ...createMockFile('', 100, 'text/plain'), name: '' },
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Invalid File Name');
      expect(result.error?.errors[0]).toContain('File name cannot be empty');
    });

    it('should reject file names with path traversal (atomic)', () => {
      const files = [
        createMockFile('../../../etc/passwd', 100, 'text/plain'),
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Invalid File Name');
      expect(result.error?.errors[0]).toContain('traversal');
    });

    it('should reject file names with null bytes (atomic)', () => {
      const files = [
        createMockFile('file\0.txt', 100, 'text/plain'),
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Invalid File Name');
      expect(result.error?.errors[0]).toContain('null byte');
    });
  });

  describe('File Size Validation', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['text/'],
    };

    it('should reject negative file sizes (atomic)', () => {
      const files = [
        { ...createMockFile('negative.txt', -100, 'text/plain'), size: -100 },
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Empty File');
      expect(result.error?.errors[0]).toContain('File size must be positive');
    });
  });

  describe('MIME Type Validation - Advanced', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['text/', 'image/'],
    };

    it('should reject files with empty MIME type (atomic)', () => {
      const files = [
        { ...createMockFile('file.txt', 100, ''), type: '' },
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Missing MIME Type');
      expect(result.error?.errors[0]).toContain('File MIME type is required');
    });

    it('should reject files with invalid MIME type (not in mime-db) (atomic)', () => {
      const files = [
        createMockFile('file.xyz', 100, 'text/invalid-made-up-type'), // In allowed category but not in mime-db
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Invalid MIME Type');
      expect(result.error?.errors[0]).toContain('Invalid MIME type');
    });

    it('should reject files where extension does not match MIME type (atomic)', () => {
      const files = [
        createMockFile('image.txt', 100, 'image/png'), // .txt file claiming to be PNG
        createMockFile('valid.txt', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.error?.error).toBe('Extension Mismatch');
      expect(result.error?.errors[0]).toContain('File extension does not match MIME type');
    });

    it('should accept files where extension matches MIME type', () => {
      const files = [
        createMockFile('document.txt', 100, 'text/plain'),
        createMockFile('image.png', 100, 'image/png'),
        createMockFile('photo.jpg', 100, 'image/jpeg'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });
  });

  describe('Edge Case File Names', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['text/', 'image/', 'application/'],
    };

    it('should accept files with no extension', () => {
      const files = [
        createMockFile('README', 100, 'text/plain'),
        createMockFile('Makefile', 100, 'text/plain'),
        createMockFile('LICENSE', 100, 'text/plain'),
        createMockFile('Dockerfile', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(4);
      expect(result.error).toBeNull();
    });

    it('should accept files with multiple dots (handles last extension)', () => {
      const files = [
        createMockFile('bundle.min.js', 100, 'application/javascript'),
        createMockFile('style.2024.css', 100, 'text/css'),
        createMockFile('data.min.js', 100, 'application/javascript'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should accept hidden files (files starting with dot)', () => {
      const files = [
        createMockFile('.gitignore', 100, 'text/plain'),
        createMockFile('.env', 100, 'text/plain'),
        createMockFile('.htaccess', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should accept hidden files with extensions', () => {
      const files = [
        createMockFile('.env.local', 100, 'text/plain'),
        createMockFile('.env.production', 100, 'text/plain'),
        createMockFile('.gitignore.backup', 100, 'text/plain'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should handle case-insensitive extensions', () => {
      const files = [
        createMockFile('photo.JPG', 100, 'image/jpeg'),
        createMockFile('image.PNG', 100, 'image/png'),
        createMockFile('document.TXT', 100, 'text/plain'),
        createMockFile('script.JS', 100, 'application/javascript'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(4);
      expect(result.error).toBeNull();
    });
  });

  describe('Uncommon but Valid MIME Types', () => {
    const config: ConfigResponse = {
      maxFileSize: 10 * 1024 * 1024,
      maxTotalSize: 50 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['font/', 'video/', 'audio/', 'application/', 'image/'],
    };

    it('should accept font files', () => {
      const files = [
        createMockFile('font.woff', 100, 'font/woff'),
        createMockFile('font.woff2', 100, 'font/woff2'),
        createMockFile('font.ttf', 100, 'font/ttf'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should accept video files', () => {
      const files = [
        createMockFile('video.mp4', 100, 'video/mp4'),
        createMockFile('video.webm', 100, 'video/webm'),
        createMockFile('video.mov', 100, 'video/quicktime'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should accept audio files', () => {
      const files = [
        createMockFile('audio.mp3', 100, 'audio/mpeg'),
        createMockFile('audio.wav', 100, 'audio/wav'),
        createMockFile('audio.ogg', 100, 'audio/ogg'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });

    it('should accept modern image formats', () => {
      const files = [
        createMockFile('image.webp', 100, 'image/webp'),
        createMockFile('image.svg', 100, 'image/svg+xml'),
        createMockFile('image.avif', 100, 'image/avif'),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.error).toBeNull();
    });
  });

  describe('getValidFiles', () => {
    it('should return only files with READY status', () => {
      const files = [
        { ...createMockFile('file1.txt', 100), status: FILE_VALIDATION_STATUS.READY },
        { ...createMockFile('file2.txt', 100), status: FILE_VALIDATION_STATUS.VALIDATION_FAILED },
        { ...createMockFile('file3.txt', 100), status: FILE_VALIDATION_STATUS.READY },
      ];

      const valid = getValidFiles(files);
      expect(valid).toHaveLength(2);
      expect(valid[0].name).toBe('file1.txt');
      expect(valid[1].name).toBe('file3.txt');
    });

    it('should return empty array for empty input', () => {
      const valid = getValidFiles([]);
      expect(valid).toEqual([]);
    });

    it('should return empty array when no files are READY', () => {
      const files = [
        { ...createMockFile('file1.txt', 100), status: FILE_VALIDATION_STATUS.VALIDATION_FAILED },
      ];

      const valid = getValidFiles(files);
      expect(valid).toEqual([]);
    });
  });

  describe('allValidFilesReady', () => {
    it('should return true when valid files exist', () => {
      const files = [
        { ...createMockFile('file1.txt', 100), status: FILE_VALIDATION_STATUS.READY },
      ];

      expect(allValidFilesReady(files)).toBe(true);
    });

    it('should return false when no valid files exist', () => {
      const files = [
        { ...createMockFile('file1.txt', 100), status: FILE_VALIDATION_STATUS.VALIDATION_FAILED },
      ];

      expect(allValidFilesReady(files)).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(allValidFilesReady([])).toBe(false);
    });
  });

  describe('FILE_VALIDATION_STATUS constants', () => {
    it('should export all status constants', () => {
      expect(FILE_VALIDATION_STATUS.PENDING).toBe('pending');
      expect(FILE_VALIDATION_STATUS.PROCESSING_ERROR).toBe('processing_error');
      expect(FILE_VALIDATION_STATUS.EMPTY_FILE).toBe('empty_file');
      expect(FILE_VALIDATION_STATUS.VALIDATION_FAILED).toBe('validation_failed');
      expect(FILE_VALIDATION_STATUS.READY).toBe('ready');
    });
  });

  describe('validateFiles - Filename Validation', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
      allowedMimeTypes: ['text/', 'image/', 'application/'],
    };

    it('should reject files with URL-unsafe characters', () => {
      const unsafeNames = [
        'file?.txt',
        'file&name.txt',
        'file#hash.txt',
        'file%percent.txt',
        'file<less.txt',
        'file>greater.txt',
        'file[bracket.txt',
        'file{brace.txt',
        'file|pipe.txt',
        'file\\backslash.txt',
        'file^caret.txt',
        'file~tilde.txt',
        'file`backtick.txt',
      ];

      unsafeNames.forEach(name => {
        const result = validateFiles([createMockFile(name, 100)], config);
        expect(result.error?.error).toBe('Invalid File Name');
        expect(result.validFiles).toHaveLength(0);
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });

    it('should reject files with shell-dangerous characters', () => {
      const dangerousNames = [
        'file;semicolon.txt',
        'file$dollar.txt',
        'file(paren.txt',
        'file)paren.txt',
        "file'quote.txt",
        'file"doublequote.txt',
        'file*asterisk.txt',
      ];

      dangerousNames.forEach(name => {
        const result = validateFiles([createMockFile(name, 100)], config);
        expect(result.error?.error).toBe('Invalid File Name');
        expect(result.validFiles).toHaveLength(0);
      });
    });

    it('should reject files with control characters', () => {
      const result1 = validateFiles([createMockFile('file\rcarriage.txt', 100)], config);
      expect(result1.error?.error).toBe('Invalid File Name');

      const result2 = validateFiles([createMockFile('file\nline.txt', 100)], config);
      expect(result2.error?.error).toBe('Invalid File Name');

      const result3 = validateFiles([createMockFile('file\ttab.txt', 100)], config);
      expect(result3.error?.error).toBe('Invalid File Name');
    });

    it('should reject files with Windows reserved names', () => {
      const reservedNames = [
        'CON',
        'CON.txt',
        'PRN.log',
        'AUX.dat',
        'NUL.txt',
        'COM1.txt',
        'COM9.txt',
        'LPT1.txt',
        'LPT9.txt',
      ];

      reservedNames.forEach(name => {
        const result = validateFiles([createMockFile(name, 100)], config);
        expect(result.error?.error).toBe('Invalid File Name');
        expect(result.validFiles).toHaveLength(0);
      });
    });

    it('should reject files with leading/trailing spaces', () => {
      const result1 = validateFiles([createMockFile(' leading.txt', 100)], config);
      expect(result1.error?.error).toBe('Invalid File Name');

      const result2 = validateFiles([createMockFile('trailing.txt ', 100)], config);
      expect(result2.error?.error).toBe('Invalid File Name');
    });

    it('should reject files ending with dots', () => {
      const result = validateFiles([createMockFile('file.txt.', 100)], config);
      expect(result.error?.error).toBe('Invalid File Name');
    });

    it('should reject files with path traversal (..)', () => {
      const result = validateFiles([createMockFile('../../../etc/passwd', 100, 'text/plain')], config);
      expect(result.error?.error).toBe('Invalid File Name');
      expect(result.error?.details).toContain('traversal');
    });

    it('should accept valid filenames', () => {
      const validFiles = [
        { name: 'file.txt', type: 'text/plain' },
        { name: 'my-file.txt', type: 'text/plain' },
        { name: 'my_file.txt', type: 'text/plain' },
        { name: 'file123.txt', type: 'text/plain' },
        { name: 'FILE.TXT', type: 'text/plain' },
        { name: 'bundle.min.js', type: 'application/javascript' },
        { name: 'index.html', type: 'text/html' },
        { name: 'README.md', type: 'text/markdown' },
        { name: 'package.json', type: 'application/json' },
        { name: '.gitignore', type: 'text/plain' }, // Hidden files are allowed
        { name: '.env', type: 'text/plain' },
        { name: '.htaccess', type: 'text/plain' },
      ];

      validFiles.forEach(({ name, type }) => {
        const result = validateFiles([createMockFile(name, 100, type)], config);
        expect(result.error).toBeNull();
        expect(result.validFiles).toHaveLength(1);
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.READY);
      });
    });

    it('should support nested paths (for subdirectories)', () => {
      const result = validateFiles([
        createMockFile('folder/file.txt', 100),
        createMockFile('folder/subfolder/file.txt', 100),
        createMockFile('assets/images/logo.png', 100, 'image/png'),
      ], config);

      expect(result.error).toBeNull();
      expect(result.validFiles).toHaveLength(3);
    });

    it('should atomically reject all files if any filename is invalid', () => {
      const files = [
        createMockFile('valid1.txt', 100),
        createMockFile('invalid?.txt', 100), // Invalid
        createMockFile('valid2.txt', 100),
      ];

      const result = validateFiles(files, config);

      // ATOMIC: All files marked as VALIDATION_FAILED
      expect(result.error?.error).toBe('Invalid File Name');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files).toHaveLength(3);
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });
  });
});
