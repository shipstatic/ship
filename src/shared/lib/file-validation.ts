/**
 * @file File validation utilities for Ship SDK
 * Provides client-side validation for file uploads before deployment
 */

import type {
  ConfigResponse,
  FileValidationResult,
  ValidatableFile,
  ValidationIssue,
  FileValidationStatusType
} from '@shipstatic/types';
import {
  FileValidationStatus as FILE_VALIDATION_STATUS,
  isBlockedExtension,
} from '@shipstatic/types';

export { FILE_VALIDATION_STATUS };

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
export function validateFileName(filename: string): { valid: boolean; reason?: string } {
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
 * Validate files against configuration limits with severity-based reporting
 *
 * Validation categorizes issues by severity:
 * - **Errors**: Block deployment (file too large, blocked extension, etc.)
 * - **Warnings**: Exclude files but allow deployment (empty files, etc.)
 *
 * @param files - Array of files to validate
 * @param config - Validation configuration from ship.getConfig()
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const config = await ship.getConfig();
 * const result = validateFiles(files, config);
 *
 * if (!result.canDeploy) {
 *   // Has errors - deployment blocked
 *   console.error('Deployment blocked:', result.errors);
 * } else if (result.warnings.length > 0) {
 *   // Has warnings - deployment proceeds, some files excluded
 *   console.warn('Files excluded:', result.warnings);
 *   await ship.deploy(result.validFiles);
 * } else {
 *   // All files valid
 *   await ship.deploy(result.validFiles);
 * }
 * ```
 */
export function validateFiles<T extends ValidatableFile>(
  files: T[],
  config: ConfigResponse
): FileValidationResult<T> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fileStatuses: T[] = [];  // Use 'let' for atomic enforcement later

  // Check at least 1 file required
  if (files.length === 0) {
    const issue: ValidationIssue = {
      file: '(no files)',
      message: 'At least one file must be provided'
    };
    errors.push(issue);

    return {
      files: [],
      validFiles: [],
      errors,
      warnings: [],
      canDeploy: false,
    };
  }

  // Check file count limit
  if (files.length > config.maxFilesCount) {
    const issue: ValidationIssue = {
      file: `(${files.length} files)`,
      message: `File count (${files.length}) exceeds limit of ${config.maxFilesCount}`
    };
    errors.push(issue);

    return {
      files: files.map(f => ({
        ...f,
        status: FILE_VALIDATION_STATUS.VALIDATION_FAILED,
        statusMessage: issue.message,
      })),
      validFiles: [],
      errors,
      warnings: [],
      canDeploy: false,
    };
  }

  // Validate each file
  let totalSize = 0;

  for (const file of files) {
    let fileStatus: FileValidationStatusType = FILE_VALIDATION_STATUS.READY;
    let statusMessage = 'Ready for upload';

    // Pre-compute filename validation
    const nameValidation = file.name ? validateFileName(file.name) : { valid: false, reason: 'File name cannot be empty' };

    // Check for processing errors
    if (file.status === FILE_VALIDATION_STATUS.PROCESSING_ERROR) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = file.statusMessage || 'File failed during processing';
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }

    // EMPTY FILE - Warning (not error)
    else if (file.size === 0) {
      fileStatus = FILE_VALIDATION_STATUS.EXCLUDED;
      statusMessage = 'File is empty (0 bytes) and cannot be deployed due to storage limitations';
      warnings.push({
        file: file.name,
        message: statusMessage
      });
      // Skip other validations for excluded files
      fileStatuses.push({
        ...file,
        status: fileStatus,
        statusMessage,
      });
      continue;
    }

    // Negative file size - Error
    else if (file.size < 0) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File size must be positive';
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }

    // File name validation
    else if (!file.name || file.name.trim().length === 0) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File name cannot be empty';
      errors.push({
        file: file.name || '(empty)',
        message: statusMessage
      });
    }
    else if (file.name.includes('\0')) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = 'File name contains invalid characters (null byte)';
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }
    else if (!nameValidation.valid) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = nameValidation.reason || 'Invalid file name';
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }

    // Blocked extension check
    else if (isBlockedExtension(file.name)) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = `File extension not allowed: "${file.name}"`;
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }

    // File size validation
    else if (file.size > config.maxFileSize) {
      fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
      statusMessage = `File size (${formatFileSize(file.size)}) exceeds limit of ${formatFileSize(config.maxFileSize)}`;
      errors.push({
        file: file.name,
        message: statusMessage
      });
    }

    // Total size validation
    else {
      totalSize += file.size;
      if (totalSize > config.maxTotalSize) {
        fileStatus = FILE_VALIDATION_STATUS.VALIDATION_FAILED;
        statusMessage = `Total size would exceed limit of ${formatFileSize(config.maxTotalSize)}`;
        errors.push({
          file: file.name,
          message: statusMessage
        });
      }
    }

    fileStatuses.push({
      ...file,
      status: fileStatus,
      statusMessage,
    });
  }

  // ATOMIC ENFORCEMENT: Two-phase validation for optimal UX + atomic semantics
  // Phase 1 (above): Validate files individually to collect ALL errors
  // Phase 2 (below): Mark all files as failed if any errors exist
  //
  // Why two phases? We validate individually for better UX (users see all problems
  // at once and can fix everything in one pass), then enforce atomicity to maintain
  // deployment transaction semantics (all-or-nothing).
  if (errors.length > 0) {
    fileStatuses = fileStatuses.map(file => {
      // Keep EXCLUDED files as-is (they're warnings, not errors)
      if (file.status === FILE_VALIDATION_STATUS.EXCLUDED) {
        return file;
      }

      // Mark ALL other files as VALIDATION_FAILED (atomic deployment)
      return {
        ...file,
        status: FILE_VALIDATION_STATUS.VALIDATION_FAILED,
        statusMessage: file.status === FILE_VALIDATION_STATUS.VALIDATION_FAILED
          ? file.statusMessage  // Keep original error message for the file that actually failed
          : 'Deployment failed due to validation errors in bundle'
      };
    });
  }

  // Build atomic result
  // validFiles is empty if ANY errors exist (all-or-nothing)
  const validFiles = errors.length === 0
    ? fileStatuses.filter(f => f.status === FILE_VALIDATION_STATUS.READY)
    : [];
  const canDeploy = errors.length === 0;

  return {
    files: fileStatuses,
    validFiles,
    errors,
    warnings,
    canDeploy,
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
