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
function createMockFile(name: string, size: number): ValidatableFile {
  return {
    name,
    size,
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
      };

      const result = validateFiles([], config);

      expect(result.validFiles).toHaveLength(0);
      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('At least one file');
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
    };

    it('should mark all files as valid when within limits', () => {
      const files = [
        createMockFile('file1.txt', 1024),
        createMockFile('file2.txt', 2048),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(2);
      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
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
      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('exceeds limit');
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });

    it('should exclude empty files with warning (allow deployment)', () => {
      const files = [
        createMockFile('empty.txt', 0),
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      // Deployment ALLOWED (warnings don't block)
      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);

      // Warning for empty file
      expect(result.warnings[0]).toMatchObject({
        file: 'empty.txt',
      });
      expect(result.warnings[0].message).toContain('empty');
      expect(result.warnings[0].message).toContain('0 bytes');

      // Only valid file in validFiles
      expect(result.validFiles).toHaveLength(1);
      expect(result.validFiles[0].name).toBe('valid.txt');

      // Status check: empty excluded, valid ready
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.EXCLUDED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.READY);
    });

    it('should reject files exceeding individual size limit (atomic)', () => {
      const files = [
        createMockFile('huge.txt', 6 * 1024 * 1024), // 6MB
        createMockFile('ok.txt', 100),
      ];

      const result = validateFiles(files, config);

      // Deployment blocked due to error
      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('exceeds limit');
      expect(result.errors[0].file).toBe('huge.txt');

      // ATOMIC: All files rejected when any file exceeds size limit
      expect(result.validFiles).toHaveLength(0);

      // All files marked as VALIDATION_FAILED (atomic)
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should reject when total size exceeds limit (per-file validation)', () => {
      const largeConfig: ConfigResponse = {
        maxFileSize: 15 * 1024 * 1024, // 15MB per file
        maxTotalSize: 25 * 1024 * 1024, // 25MB total
        maxFilesCount: 100,
      };

      const files = [
        createMockFile('file1.txt', 10 * 1024 * 1024), // 10MB
        createMockFile('file2.txt', 10 * 1024 * 1024), // 10MB - total 20MB (ok individually)
        createMockFile('file3.txt', 6 * 1024 * 1024),  // 6MB - total 26MB (exceeds)
      ];

      const result = validateFiles(files, largeConfig);

      // Deployment blocked due to total size error
      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Total size');
      expect(result.errors[0].file).toBe('file3.txt');

      // ATOMIC: All files rejected when total size exceeded
      expect(result.validFiles).toHaveLength(0);

      // All files marked as VALIDATION_FAILED (atomic)
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
      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toContain('Failed to process');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    describe('Extension blocklist validation', () => {
      it('should accept files with non-blocked extensions', () => {
        const files = [
          createMockFile('doc.txt', 100),
          createMockFile('image.png', 100),
          createMockFile('data.json', 100),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(3);
        expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
        result.files.forEach(f => {
          expect(f.status).toBe(FILE_VALIDATION_STATUS.READY);
        });
      });

      it('should reject files with blocked extensions (atomic)', () => {
        const files = [
          createMockFile('malware.exe', 100),
          createMockFile('valid.txt', 100),
        ];

        const result = validateFiles(files, config);

        // ATOMIC: All files rejected if any has blocked extension
        expect(result.canDeploy).toBe(false);
        expect(result.errors[0].message).toContain('extension not allowed');
        expect(result.validFiles).toHaveLength(0);
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });

      it('should accept unknown file extensions (not in blocklist)', () => {
        const files = [
          createMockFile('doc.html', 100),
          createMockFile('style.css', 100),
          createMockFile('photo.jpg', 100),
          createMockFile('icon.svg', 100),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(4);
        expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
        result.files.forEach(f => {
          expect(f.status).toBe(FILE_VALIDATION_STATUS.READY);
        });
      });

      it('should accept files with unknown/custom extensions', () => {
        const files = [
          createMockFile('data.parquet', 100),
          createMockFile('model.onnx', 100),
          createMockFile('custom.xyz', 100),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(3);
        expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
      });

      it('should reject multiple files with blocked extensions (atomic)', () => {
        const files = [
          createMockFile('valid.txt', 100),
          createMockFile('bad1.exe', 100),
          createMockFile('bad2.msi', 100),
        ];

        const result = validateFiles(files, config);

        // ATOMIC: All files rejected
        expect(result.canDeploy).toBe(false);
        expect(result.validFiles).toHaveLength(0);

        // Verify both errors are in the errors array
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0].message).toContain('extension not allowed');
        expect(result.errors[0].file).toBe('bad1.exe');
        expect(result.errors[1].file).toBe('bad2.msi');

        // All files marked as VALIDATION_FAILED (atomic)
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
        expect(result.files[2].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });

      it('should accept WASM files (web standard)', () => {
        const files = [
          createMockFile('app.wasm', 100),
        ];

        const result = validateFiles(files, config);

        expect(result.validFiles).toHaveLength(1);
        expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.READY);
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
    };

    it('should reject empty file names (atomic)', () => {
      const files = [
        { ...createMockFile('', 100), name: '' },
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
      expect(result.errors[0].message).toContain('File name cannot be empty');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should reject file names with path traversal (atomic)', () => {
      const files = [
        createMockFile('../../../etc/passwd', 100),
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
      expect(result.errors[0].message).toContain('traversal');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should reject file names with null bytes (atomic)', () => {
      const files = [
        createMockFile('file\0.txt', 100),
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
      expect(result.errors[0].message).toContain('null byte');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });
  });

  describe('File Size Validation', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
    };

    it('should reject negative file sizes (atomic)', () => {
      const files = [
        { ...createMockFile('negative.txt', -100), size: -100 },
        createMockFile('valid.txt', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toContain('File size must be positive');
      expect(result.validFiles).toHaveLength(0);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });
  });

  describe('Edge Case File Names', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
    };

    it('should accept files with no extension', () => {
      const files = [
        createMockFile('README', 100),
        createMockFile('Makefile', 100),
        createMockFile('LICENSE', 100),
        createMockFile('Dockerfile', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(4);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept files with multiple dots (handles last extension)', () => {
      const files = [
        createMockFile('bundle.min.js', 100),
        createMockFile('style.2024.css', 100),
        createMockFile('data.min.js', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept hidden files (files starting with dot)', () => {
      const files = [
        createMockFile('.gitignore', 100),
        createMockFile('.env', 100),
        createMockFile('.htaccess', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept hidden files with extensions', () => {
      const files = [
        createMockFile('.env.local', 100),
        createMockFile('.env.production', 100),
        createMockFile('.gitignore.backup', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should handle case-insensitive blocked extensions', () => {
      const files = [
        createMockFile('virus.EXE', 100),
        createMockFile('malware.MSI', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('Uncommon but Valid File Types', () => {
    const config: ConfigResponse = {
      maxFileSize: 10 * 1024 * 1024,
      maxTotalSize: 50 * 1024 * 1024,
      maxFilesCount: 100,
    };

    it('should accept font files', () => {
      const files = [
        createMockFile('font.woff', 100),
        createMockFile('font.woff2', 100),
        createMockFile('font.ttf', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept video files', () => {
      const files = [
        createMockFile('video.mp4', 100),
        createMockFile('video.webm', 100),
        createMockFile('video.mov', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept audio files', () => {
      const files = [
        createMockFile('audio.mp3', 100),
        createMockFile('audio.wav', 100),
        createMockFile('audio.ogg', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
    });

    it('should accept modern image formats', () => {
      const files = [
        createMockFile('image.webp', 100),
        createMockFile('image.svg', 100),
        createMockFile('image.avif', 100),
      ];

      const result = validateFiles(files, config);

      expect(result.validFiles).toHaveLength(3);
      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
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
      expect(FILE_VALIDATION_STATUS.EXCLUDED).toBe('excluded');
      expect(FILE_VALIDATION_STATUS.VALIDATION_FAILED).toBe('validation_failed');
      expect(FILE_VALIDATION_STATUS.READY).toBe('ready');
    });
  });

  describe('validateFiles - Filename Validation', () => {
    const config: ConfigResponse = {
      maxFileSize: 5 * 1024 * 1024,
      maxTotalSize: 25 * 1024 * 1024,
      maxFilesCount: 100,
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
        expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
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
        expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
        expect(result.validFiles).toHaveLength(0);
      });
    });

    it('should reject files with control characters', () => {
      const result1 = validateFiles([createMockFile('file\rcarriage.txt', 100)], config);
      expect(result1.canDeploy).toBe(false);
      expect(result1.errors[0].message).toBeDefined();

      const result2 = validateFiles([createMockFile('file\nline.txt', 100)], config);
      expect(result2.canDeploy).toBe(false);
      expect(result2.errors[0].message).toBeDefined();

      const result3 = validateFiles([createMockFile('file\ttab.txt', 100)], config);
      expect(result3.canDeploy).toBe(false);
      expect(result3.errors[0].message).toBeDefined();
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
        expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
        expect(result.validFiles).toHaveLength(0);
      });
    });

    it('should reject files with leading/trailing spaces', () => {
      const result1 = validateFiles([createMockFile(' leading.txt', 100)], config);
      expect(result1.canDeploy).toBe(false);
      expect(result1.errors[0].message).toBeDefined();

      const result2 = validateFiles([createMockFile('trailing.txt ', 100)], config);
      expect(result2.canDeploy).toBe(false);
      expect(result2.errors[0].message).toBeDefined();
    });

    it('should reject files ending with dots', () => {
      const result = validateFiles([createMockFile('file.txt.', 100)], config);
      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
    });

    it('should reject files with path traversal (..)', () => {
      const result = validateFiles([createMockFile('../../../etc/passwd', 100)], config);
      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
      expect(result.errors[0].message).toContain('traversal');
    });

    it('should accept valid filenames', () => {
      const validFiles = [
        'file.txt',
        'my-file.txt',
        'my_file.txt',
        'file123.txt',
        'FILE.TXT',
        'bundle.min.js',
        'index.html',
        'README.md',
        'package.json',
        '.gitignore', // Hidden files are allowed
        '.env',
        '.htaccess',
      ];

      validFiles.forEach(name => {
        const result = validateFiles([createMockFile(name, 100)], config);
        expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
        expect(result.validFiles).toHaveLength(1);
        expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.READY);
      });
    });

    it('should support nested paths (for subdirectories)', () => {
      const result = validateFiles([
        createMockFile('folder/file.txt', 100),
        createMockFile('folder/subfolder/file.txt', 100),
        createMockFile('assets/images/logo.png', 100),
      ], config);

      expect(result.canDeploy).toBe(true); expect(result.errors).toHaveLength(0);
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
      expect(result.canDeploy).toBe(false);
      expect(result.errors[0].message).toBeDefined();
      expect(result.validFiles).toHaveLength(0);
      expect(result.files).toHaveLength(3);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[2].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });
  });
});
