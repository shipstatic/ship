/**
 * @file File validation utilities for Ship SDK
 * Provides client-side validation for file uploads before deployment
 */

import type {
  ConfigResponse,
  FileValidationResult,
  ValidatableFile,
  ValidationError,
  FileValidationStatusType
} from '@shipstatic/types';
import {
  FileValidationStatus as FILE_VALIDATION_STATUS
} from '@shipstatic/types';
// @ts-ignore: mime-db uses CommonJS export
import mimeDb from 'mime-db';

interface MimeEntry { extensions?: string[] }

const VALID_MIME_TYPES = new Set(Object.keys(mimeDb));

const MIME_TYPE_EXTENSIONS = new Map(
  Object.entries(mimeDb as Record<string, MimeEntry>)
    .filter(([_, data]) => data.extensions)
    .map(([type, data]) => [type, new Set(data.extensions)])
);

export { FILE_VALIDATION_STATUS };

const ERROR_TYPE_PATTERNS: [RegExp, string][] = [
  [/File name cannot|Invalid file name|File name contains|File name uses|traversal/i, 'Invalid File Name'],
  [/File size must be positive/i, 'Invalid File Size'],
  [/MIME type is required/i, 'Missing MIME Type'],
  [/Invalid MIME type/i, 'Invalid MIME Type'],
  [/not allowed/i, 'Invalid File Type'],
  [/extension does not match/i, 'Extension Mismatch'],
  [/Total size/i, 'Total Size Exceeded'],
  [/exceeds limit/i, 'File Too Large'],
];

function getErrorType(status?: string, message?: string): string {
  if (status === FILE_VALIDATION_STATUS.PROCESSING_ERROR) return 'Processing Error';
  if (status === FILE_VALIDATION_STATUS.EMPTY_FILE) return 'Empty File';
  if (!message) return 'Validation Failed';

  for (const [pattern, errorType] of ERROR_TYPE_PATTERNS) {
    if (pattern.test(message)) return errorType;
  }
  return 'Validation Failed';
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Validate filename for deployment safety
 * Rejects filenames that would cause issues in URLs, filesystems, or shells
 *
 * Rejected patterns:
 * - URL-unsafe: ?, &, #, %, <, >, [, ], {, }, |, \, ^, ~, `
 * - Path traversal: .. (already checked separately)
 * - Shell dangerous: ; $ ( ) ' " *
 * - Control characters: \0, \r, \n, \t
 * - Reserved names: CON, PRN, AUX, NUL, COM1-9, LPT1-9 (Windows)
 * - Leading/trailing dots or spaces
 */
function validateFileName(filename: string): { valid: boolean; reason?: string } {
  const unsafeChars = /[?&#%<>\[\]{}|\\^~`;$()'"*\r\n\t]/;
  if (unsafeChars.test(filename)) {
    return { valid: false, reason: 'File name contains unsafe characters' };
  }

  if (filename.startsWith(' ') || filename.endsWith(' ')) {
    return { valid: false, reason: 'File name cannot start/end with spaces' };
  }

  if (filename.endsWith('.')) {
    return { valid: false, reason: 'File name cannot end with dots' };
  }

  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  const nameWithoutPath = filename.split('/').pop() || filename;
  if (reservedNames.test(nameWithoutPath)) {
    return { valid: false, reason: 'File name uses a reserved system name' };
  }

  if (filename.includes('..')) {
    return { valid: false, reason: 'File name contains path traversal pattern' };
  }

  return { valid: true };
}

/**
 * Validate that file extension matches MIME type
 * Prevents file masquerading (e.g., .exe file with image/png MIME type)
 *
 * Special cases:
 * - Hidden files (starting with dot) like .gitignore, .env are treated as extensionless
 * - Files with no extension like README, Makefile are allowed with any MIME type
 * - Files with multiple dots use the last segment as extension (archive.tar.gz -> gz)
 */
function validateFileExtension(filename: string, mimeType: string): boolean {
  if (filename.startsWith('.')) {
    return true;
  }

  const nameParts = filename.toLowerCase().split('.');
  if (nameParts.length > 1 && nameParts[nameParts.length - 1]) {
    const extension = nameParts[nameParts.length - 1];
    const allowedExtensions = MIME_TYPE_EXTENSIONS.get(mimeType);
    if (allowedExtensions && !allowedExtensions.has(extension)) {
      return false;
    }
  }
  return true;
}

/**
 * Validate files against configuration limits
 *
 * ATOMIC VALIDATION: If ANY file fails validation, ALL files are rejected.
 * This ensures deployments are all-or-nothing for data integrity.
 *
 * @param files - Array of files to validate
 * @param config - Validation configuration from ship.getConfig()
 * @returns Validation result with updated file status
 *
 * @example
 * ```typescript
 * const config = await ship.getConfig();
 * const result = validateFiles(files, config);
 *
 * if (result.error) {
 *   // Validation failed - result.validFiles will be empty
 *   console.error(result.error.details);
 *   // Show individual file errors:
 *   result.files.forEach(f => console.log(`${f.name}: ${f.statusMessage}`));
 * } else {
 *   // All files valid - safe to upload
 *   await ship.deploy(result.validFiles);
 * }
 * ```
 */
export function validateFiles<T extends ValidatableFile>(
  files: T[],
  config: ConfigResponse
): FileValidationResult<T> {
  const errors: string[] = [];
  const fileStatuses: T[] = [];

  // Check at least 1 file required
  if (files.length === 0) {
    const errorMsg = 'At least one file must be provided';
    return {
      files: [],
      validFiles: [],
      error: {
        error: 'No Files Provided',
        details: errorMsg,
        errors: [errorMsg],
        isClientError: true,
      },
    };
  }

  // Check file count limit
  if (files.length > config.maxFilesCount) {
    const errorMsg = `Number of files (${files.length}) exceeds the limit of ${config.maxFilesCount}.`;
    return {
      files: files.map(f => ({
        ...f,
        status: FILE_VALIDATION_STATUS.VALIDATION_FAILED,
        statusMessage: errorMsg,
      })),
      validFiles: [],
      error: {
        error: 'File Count Exceeded',
        details: errorMsg,
        errors: [errorMsg],
        isClientError: true,
      },
    };
  }

  // First pass: Check all files and collect errors
  let totalSize = 0;
  for (const file of files) {
    let fileStatus: string = FILE_VALIDATION_STATUS.READY;
    let statusMessage: string = 'Ready for upload';

    // Pre-compute filename validation result (used in multiple checks)
    const nameValidation = file.name ? validateFileName(file.name) : { valid: false, reason: 'File name cannot be empty' };

    // Check for processing errors (e.g., MD5 calculation failure)
    if (file.status === FILE_VALIDATION_STATUS.PROCESSING_ERROR) {
      fileStatus = FILE_VALIDATION_STATUS.PROCESSING_ERROR;
      statusMessage = file.statusMessage || 'A file failed during processing.';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check file name not empty
    else if (!file.name || file.name.trim().length === 0) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File name cannot be empty';
      errors.push(`${file.name || '(empty)'}: ${statusMessage}`);
    }
    // Check file name for null bytes
    else if (file.name.includes('\0')) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File name contains invalid characters (null byte)';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Comprehensive filename validation (URL-safe, shell-safe, filesystem-safe)
    else if (!nameValidation.valid) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = nameValidation.reason || 'Invalid file name';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check file size positive (not zero or negative)
    else if (file.size <= 0) {
      fileStatus = FILE_VALIDATION_STATUS.EMPTY_FILE;
      statusMessage = file.size === 0 ? 'File is empty (0 bytes)' : 'File size must be positive';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check MIME type required
    else if (!file.type || file.type.trim().length === 0) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File MIME type is required';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check MIME type in allowed categories
    else if (!config.allowedMimeTypes.some((category: string) => file.type.startsWith(category))) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = `File type "${file.type}" is not allowed`;
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check MIME type valid (exists in mime-db)
    else if (!VALID_MIME_TYPES.has(file.type)) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = `Invalid MIME type "${file.type}"`;
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check file extension matches MIME type
    else if (!validateFileExtension(file.name, file.type)) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File extension does not match MIME type';
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check individual file size
    else if (file.size > config.maxFileSize) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = `File size (${formatFileSize(file.size)}) exceeds limit of ${formatFileSize(config.maxFileSize)}`;
      errors.push(`${file.name}: ${statusMessage}`);
    }
    // Check total size (cumulative)
    else {
      totalSize += file.size;
      if (totalSize > config.maxTotalSize) {
        fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
        statusMessage = `Total size would exceed limit of ${formatFileSize(config.maxTotalSize)}`;
        errors.push(`${file.name}: ${statusMessage}`);
      }
    }

    fileStatuses.push({
      ...file,
      status: fileStatus,
      statusMessage,
    });
  }

  // ATOMIC CHECK: If ANY file failed, reject ALL files
  if (errors.length > 0) {
    const firstError = fileStatuses.find(f =>
      f.status !== FILE_VALIDATION_STATUS.READY &&
      f.status !== FILE_VALIDATION_STATUS.PENDING
    );

    const errorType = getErrorType(firstError?.status, firstError?.statusMessage);

    return {
      files: fileStatuses.map(f => ({
        ...f,
        status: FILE_VALIDATION_STATUS.VALIDATION_FAILED,
      })),
      validFiles: [], // ATOMIC: No valid files if any file failed
      error: {
        error: errorType,
        details: errors.length === 1
          ? errors[0]
          : `${errors.length} file(s) failed validation`,
        errors,
        isClientError: true,
      },
    };
  }

  // All files valid - return them all
  return {
    files: fileStatuses,
    validFiles: fileStatuses,
    error: null,
  };
}

/**
 * Get only the valid files from validation results
 */
export function getValidFiles<T extends ValidatableFile>(files: T[]): T[] {
  return files.filter(f => f.status === FILE_VALIDATION_STATUS.READY);
}

/**
 * Check if all valid files have required properties for upload
 * (Can be extended to check for MD5, etc.)
 */
export function allValidFilesReady<T extends ValidatableFile>(files: T[]): boolean {
  const validFiles = getValidFiles(files);
  return validFiles.length > 0;
}
