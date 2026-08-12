/**
 * @file Shared security validation for the deploy pipeline.
 * Used by both Node.js and browser file processing pipelines.
 */
import { isBlockedExtension, ShipError } from '@shipstatic/types';
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
    throw ShipError.business(
      `Security error: Unsafe file path "${deployPath}" for file: ${sourceIdentifier}`,
    );
  }
}

/**
 * Validate a deploy file's name and extension.
 * Rejects unsafe filenames (shell/URL-dangerous chars, reserved names)
 * and file extensions the platform refuses to host.
 *
 * **The blocklist is the platform's, delivered — not this package's.** It
 * arrives as `PlatformLimits.blockedExtensions` from `GET /limits`, which the
 * client has already fetched by the time any file is processed. That is what
 * keeps a pinned CLI from enforcing a policy the platform has moved on from,
 * in either direction. Callers pass `[]` when the API sent no list (one that
 * predates the field): the check then does nothing and the API refuses the
 * file at the boundary, which is the correct place for it to be refused.
 *
 * @param deployPath - The deployment path to validate
 * @param sourceIdentifier - Human-readable identifier for error messages
 * @param blockedExtensions - The platform's blocklist, from `/limits`
 * @throws {ShipError} If the filename is unsafe or the extension is blocked
 */
export function validateDeployFile(
  deployPath: string,
  sourceIdentifier: string,
  blockedExtensions: readonly string[],
): void {
  const nameCheck = validateFileName(deployPath);
  if (!nameCheck.valid) {
    throw ShipError.business(nameCheck.reason || 'Invalid file name');
  }

  if (isBlockedExtension(deployPath, blockedExtensions)) {
    throw ShipError.business(`File extension not allowed: "${sourceIdentifier}"`);
  }
}
