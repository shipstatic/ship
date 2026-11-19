/**
 * @file `validateFiles`: every refusal a set of files would meet, listed
 * before a deploy.
 */

import type {
  FileValidationResult,
  FileValidationStatusType,
  PlatformLimits,
  ValidatableFile,
  ValidationIssue,
} from '@shipstatic/types';
import {
  brokenSetRule,
  FileValidationStatus,
  firstBrokenRule,
  isPublishedFile,
} from '@shipstatic/types';

/**
 * Validate files against the platform's deploy rules, listing every refusal.
 *
 * The rules and their sentences are the platform's one table in
 * `@shipstatic/types` ("Deploy rules"), which the API and the deploy
 * pipelines judge by too, so a refusal listed here reads as it would anywhere.
 * This is the collecting renderer: each file's first broken rule, then the
 * rules about the deployment as a whole (it has files, no more than the plan
 * allows, and a home page at its root), filed under the deployment because
 * they name no one file.
 *
 * - **Errors** block the deployment, and atomically: if any file is refused,
 *   none is valid.
 * - **Warnings** exclude a file and let the deployment go on: an empty file,
 *   which no deployment stores.
 *
 * @param files - The files, each named by its deploy path
 * @param config - The platform's limits, from `ship.getLimits()`
 * @returns Every file with its status, the valid ones, and the issues
 */
export function validateFiles<T extends ValidatableFile>(
  files: T[],
  config: PlatformLimits,
): FileValidationResult<T> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fileStatuses: T[] = [];
  const deployment = `(${files.length} ${files.length === 1 ? 'file' : 'files'})`;

  let totalSize = 0;
  for (const file of files) {
    let fileStatus: FileValidationStatusType = FileValidationStatus.READY;
    let statusMessage = 'Ready for upload';

    if (file.status === FileValidationStatus.PROCESSING_ERROR) {
      fileStatus = FileValidationStatus.VALIDATION_FAILED;
      statusMessage = file.statusMessage || `File "${file.name}" could not be read.`;
      errors.push({ file: file.name, message: statusMessage });
    } else if (!isPublishedFile(file)) {
      // Excluded, not refused: the deployment goes on without it.
      fileStatus = FileValidationStatus.EXCLUDED;
      statusMessage = `File "${file.name}" is empty, so it is excluded.`;
      warnings.push({ file: file.name, message: statusMessage });
    } else {
      const input = { path: file.name, size: file.size, totalSize: totalSize + file.size };
      const broken = firstBrokenRule(input, config);
      if (broken) {
        fileStatus = FileValidationStatus.VALIDATION_FAILED;
        statusMessage = broken.sentence(input, config);
        // The total rule refuses the deployment, not the file that tipped it.
        errors.push({
          file: broken.name === 'totalSize' ? deployment : file.name,
          message: statusMessage,
        });
      } else {
        // Only a file that passed everything counts toward the running total.
        totalSize = input.totalSize;
      }
    }

    fileStatuses.push({ ...file, status: fileStatus, statusMessage });
  }

  // The rules about the deployment as a whole, over the files as sent: they
  // count only what is published, and say when the home page is empty.
  const sent = fileStatuses.map((file) => ({ path: file.name, size: file.size }));
  const broken = brokenSetRule(sent, config);
  if (broken) errors.push({ file: deployment, message: broken.sentence(sent, config) });

  // ATOMIC ENFORCEMENT: Two-phase validation for optimal UX + atomic semantics
  // Phase 1 (above): Validate files individually to collect ALL errors
  // Phase 2 (below): Mark all files as failed if any errors exist
  //
  // Why two phases? We validate individually for better UX (users see all problems
  // at once and can fix everything in one pass), then enforce atomicity to maintain
  // deployment transaction semantics (all-or-nothing).
  if (errors.length > 0) {
    fileStatuses = fileStatuses.map((file) => {
      // Keep EXCLUDED files as-is (they're warnings, not errors)
      if (file.status === FileValidationStatus.EXCLUDED) {
        return file;
      }

      // Mark ALL other files as VALIDATION_FAILED (atomic deployment)
      return {
        ...file,
        status: FileValidationStatus.VALIDATION_FAILED,
        statusMessage:
          file.status === FileValidationStatus.VALIDATION_FAILED
            ? file.statusMessage // Keep original error message for the file that actually failed
            : 'Deployment failed due to validation errors in bundle',
      };
    });
  }

  // Build atomic result
  // validFiles is empty if ANY errors exist (all-or-nothing)
  const validFiles =
    errors.length === 0 ? fileStatuses.filter((f) => f.status === FileValidationStatus.READY) : [];
  const canDeploy = errors.length === 0;

  return {
    files: fileStatuses,
    validFiles,
    errors,
    warnings,
    canDeploy,
  };
}
