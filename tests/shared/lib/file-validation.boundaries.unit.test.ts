/**
 * Boundary and edge case tests for file validation
 * These tests verify behavior at exact limits and boundary conditions
 */
import { describe, it, expect } from 'vitest';
import {
  validateFiles,
  FILE_VALIDATION_STATUS,
  type ValidatableFile,
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

describe('File Validation - Boundary Tests', () => {
  const config: ConfigResponse = {
    maxFileSize: 5 * 1024 * 1024, // 5MB
    maxTotalSize: 25 * 1024 * 1024, // 25MB
    maxFilesCount: 100,
    allowedMimeTypes: ['text/', 'image/', 'application/json'],
  };

  describe('File Size Boundaries', () => {
    it('should accept file exactly at size limit', () => {
      const files = [createMockFile('at-limit.txt', config.maxFileSize)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(1);
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.READY);
    });

    it('should reject file 1 byte over size limit (atomic)', () => {
      const files = [
        createMockFile('over-limit.txt', config.maxFileSize + 1),
        createMockFile('valid.txt', 100),
      ];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('exceeds limit');
      expect(result.validFiles).toHaveLength(0);

      // ATOMIC: All files marked as failed
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });

    it('should accept file 1 byte under size limit', () => {
      const files = [createMockFile('under-limit.txt', config.maxFileSize - 1)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(1);
    });
  });

  describe('Total Size Boundaries', () => {
    it('should accept files with total exactly at limit', () => {
      // Need files under individual maxFileSize (5MB) but total at 25MB
      const largeConfig: ConfigResponse = {
        ...config,
        maxFileSize: 10 * 1024 * 1024, // 10MB per file
      };

      const files = [
        createMockFile('file1.txt', 10 * 1024 * 1024),
        createMockFile('file2.txt', 10 * 1024 * 1024),
        createMockFile('file3.txt', 5 * 1024 * 1024),
      ];
      const result = validateFiles(files, largeConfig);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(3);
    });

    it('should reject when total exceeds by 1 byte (atomic)', () => {
      const largeConfig: ConfigResponse = {
        ...config,
        maxFileSize: 10 * 1024 * 1024, // 10MB per file
      };

      const files = [
        createMockFile('file1.txt', 10 * 1024 * 1024),
        createMockFile('file2.txt', 10 * 1024 * 1024),
        createMockFile('file3.txt', 5 * 1024 * 1024 + 1), // 1 byte over total
      ];
      const result = validateFiles(files, largeConfig);

      expect(result.canDeploy).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Find total size error
      const totalSizeError = result.errors.find(e => e.message.includes('Total size'));
      expect(totalSizeError).toBeDefined();
      expect(totalSizeError!.file).toBe('file3.txt');
      expect(result.validFiles).toHaveLength(0);

      // ATOMIC: All files marked as failed
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });

    it('should detect total size overflow mid-validation', () => {
      const largeConfig: ConfigResponse = {
        ...config,
        maxFileSize: 15 * 1024 * 1024, // 15MB per file
      };

      // Running total: 12MB → 22MB → 28MB (exceeds 25MB on 3rd file)
      const files = [
        createMockFile('file1.txt', 12 * 1024 * 1024), // Total: 12MB ✓
        createMockFile('file2.txt', 10 * 1024 * 1024), // Total: 22MB ✓
        createMockFile('file3.txt', 6 * 1024 * 1024),  // Total: 28MB ✗ (exceeds)
      ];
      const result = validateFiles(files, largeConfig);

      expect(result.canDeploy).toBe(false);
      const totalSizeError = result.errors.find(e => e.message.includes('Total size'));
      expect(totalSizeError).toBeDefined();
      expect(totalSizeError!.file).toBe('file3.txt');

      // ATOMIC: All files marked as failed (even files 1 & 2 that individually passed)
      expect(result.validFiles).toHaveLength(0);
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });
  });

  describe('File Count Boundaries', () => {
    it('should accept exactly at file count limit', () => {
      const files = Array.from({ length: config.maxFilesCount }, (_, i) =>
        createMockFile(`file${i}.txt`, 100)
      );
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(config.maxFilesCount);
    });

    it('should reject 1 file over count limit (atomic)', () => {
      const files = Array.from({ length: config.maxFilesCount + 1 }, (_, i) =>
        createMockFile(`file${i}.txt`, 100)
      );
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('File count');
      expect(result.errors[0].message).toContain(`${config.maxFilesCount + 1}`);
      expect(result.validFiles).toHaveLength(0);

      // ALL files marked as failed
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });
  });

  describe('MIME Type Edge Cases', () => {
    it('should reject MIME types with parameters (not in mime-db)', () => {
      // MIME types with parameters are checked against mime-db
      // 'text/html; charset=utf-8' is not a valid mime-db entry
      // The validation checks: isAllowed && (explicitly allowed || in mime-db)
      const files = [
        createMockFile('page.html', 100, 'text/html; charset=utf-8'),
        createMockFile('data.json', 100, 'application/json; charset=utf-8'),
      ];
      const result = validateFiles(files, config);

      // These will fail because the full string with parameters isn't in mime-db
      expect(result.canDeploy).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept MIME types without parameters', () => {
      const files = [
        createMockFile('page.html', 100, 'text/html'),
        createMockFile('data.json', 100, 'application/json'),
      ];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validFiles).toHaveLength(2);
    });
  });

  describe('Empty File Edge Cases', () => {
    it('should exclude only empty file (warnings but allow deployment)', () => {
      const files = [createMockFile('empty.txt', 0)];
      const result = validateFiles(files, config);

      // CRITICAL: canDeploy should be TRUE (warnings don't block)
      // But validFiles is empty, so UI should disable deploy button
      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.validFiles).toHaveLength(0); // No files to deploy
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.EXCLUDED);
    });

    it('should exclude multiple empty files without blocking deployment', () => {
      const files = [
        createMockFile('empty1.txt', 0),
        createMockFile('empty2.txt', 0),
        createMockFile('valid.txt', 100),
      ];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.validFiles).toHaveLength(1);
      expect(result.validFiles[0].name).toBe('valid.txt');
    });

    it('should keep empty files EXCLUDED during atomic failure', () => {
      const files = [
        createMockFile('empty.txt', 0),                    // EXCLUDED
        createMockFile('valid.txt', 100),                   // Will become FAILED
        createMockFile('toobig.txt', config.maxFileSize + 1), // FAILED
      ];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1); // Only toobig error
      expect(result.warnings).toHaveLength(1); // Empty file warning
      expect(result.validFiles).toHaveLength(0);

      // CRITICAL: Empty file stays EXCLUDED (not marked FAILED)
      expect(result.files[0].status).toBe(FILE_VALIDATION_STATUS.EXCLUDED);
      expect(result.files[1].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      expect(result.files[2].status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
    });
  });

  describe('Negative Size Edge Cases', () => {
    it('should reject file with size -1', () => {
      const files = [{ ...createMockFile('negative.txt', -1), size: -1 }];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('must be positive');
    });

    it('should reject file with very large negative size', () => {
      const files = [{ ...createMockFile('negative.txt', -999999), size: -999999 }];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Filename Length Boundaries', () => {
    it('should accept very long but valid filename', () => {
      // 255 characters is typical filesystem limit
      const longName = 'a'.repeat(200) + '.txt';
      const files = [createMockFile(longName, 100)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.validFiles).toHaveLength(1);
    });

    it('should accept single character filename', () => {
      const files = [createMockFile('a', 100)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.validFiles).toHaveLength(1);
    });
  });

  describe('Path Traversal Variations', () => {
    it('should reject Windows-style path traversal', () => {
      const files = [createMockFile('..\\..\\windows\\system32\\config', 100)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      // Backslash is caught by unsafe characters check (not path traversal check)
      expect(result.errors[0].message).toBeDefined();
    });

    it('should reject mixed path separators with traversal', () => {
      const files = [createMockFile('../folder\\..\\file.txt', 100)];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(false);
      // Has both .. and \ which are both invalid
      expect(result.errors[0].message).toBeDefined();
    });

    it('should accept paths without traversal', () => {
      const files = [
        createMockFile('folder/subfolder/file.txt', 100),
        createMockFile('assets/images/logo.png', 100, 'image/png'),
      ];
      const result = validateFiles(files, config);

      expect(result.canDeploy).toBe(true);
      expect(result.validFiles).toHaveLength(2);
    });
  });

  describe('Multiple Validation Errors', () => {
    it('should collect all errors before atomic enforcement', () => {
      const files = [
        createMockFile('toobig1.txt', config.maxFileSize + 1),  // Error 1
        createMockFile('toobig2.txt', config.maxFileSize + 1),  // Error 2
        createMockFile('valid.txt', 100),
      ];
      const result = validateFiles(files, config);

      // Should have 2 distinct errors (one per failing file)
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].file).toBe('toobig1.txt');
      expect(result.errors[1].file).toBe('toobig2.txt');

      // ATOMIC: All files marked as failed
      expect(result.validFiles).toHaveLength(0);
      result.files.forEach(f => {
        expect(f.status).toBe(FILE_VALIDATION_STATUS.VALIDATION_FAILED);
      });
    });

    it('should report different types of errors', () => {
      const files = [
        createMockFile('toobig.txt', config.maxFileSize + 1),  // Size error
        createMockFile('invalid.exe', 100, 'application/x-msdownload'), // MIME error
        createMockFile('valid.txt', 100),
      ];
      const result = validateFiles(files, config);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toContain('exceeds limit');
      expect(result.errors[1].message).toContain('not allowed');

      // All failed atomically
      expect(result.validFiles).toHaveLength(0);
    });
  });
});
