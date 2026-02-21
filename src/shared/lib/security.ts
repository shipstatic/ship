/**
 * @file Shared security validation for the deploy pipeline.
 * Used by both Node.js and browser file processing pipelines.
 */
import { ShipError, isBlockedExtension } from '@shipstatic/types';
import { validateFileName } from './file-validation.js';

/**
 * Validate a deploy path for security concerns.
 * Rejects paths containing path traversal patterns or null bytes.
 *
 * Checks for:
 * - Null bytes (\0) — path injection
 * - /../ — directory traversal within path
 * - ../ at start — upward traversal
 * - /.. at end — trailing traversal
 *
 * Does NOT reject double dots in filenames (e.g., "foo..bar.txt" is safe).
 *
 * @param deployPath - The deployment path to validate
 * @param sourceIdentifier - Human-readable identifier for error messages
 * @throws {ShipError} If the path contains unsafe patterns
 */
export function validateDeployPath(deployPath: string, sourceIdentifier: string): void {
  if (
    deployPath.includes('\0') ||
    deployPath.includes('/../') ||
    deployPath.startsWith('../') ||
    deployPath.endsWith('/..')
  ) {
    throw ShipError.business(`Security error: Unsafe file path "${deployPath}" for file: ${sourceIdentifier}`);
  }
}

/**
 * Validate a deploy file's name and extension.
 * Rejects unsafe filenames (shell/URL-dangerous chars, reserved names)
 * and blocked file extensions (.exe, .msi, .dll, etc.).
 *
 * @param deployPath - The deployment path to validate
 * @param sourceIdentifier - Human-readable identifier for error messages
 * @throws {ShipError} If the filename is unsafe or extension is blocked
 */
export function validateDeployFile(deployPath: string, sourceIdentifier: string): void {
  const nameCheck = validateFileName(deployPath);
  if (!nameCheck.valid) {
    throw ShipError.business(nameCheck.reason || 'Invalid file name');
  }

  if (isBlockedExtension(deployPath)) {
    throw ShipError.business(`File extension not allowed: "${sourceIdentifier}"`);
  }
}
