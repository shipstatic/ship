/**
 * @file Shared security validation for the deploy pipeline.
 * Used by both Node.js and browser file processing pipelines.
 */
import type { PlatformLimits } from '@shipstatic/types';
import { ShipError } from '@shipstatic/types';
import { type FileRuleInput, firstBrokenRule } from './file-rules.js';

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
 * The THROWING renderer of `FILE_RULES` — the deploy pipelines' shape.
 *
 * It raises the first rule the file breaks and nothing else: the rules, their
 * order and their sentences all live in `file-rules.ts`, so this function
 * cannot re-order, skip or reword one. That is what makes node/browser parity
 * structural — both pipelines call this, and this calls the one table.
 *
 * Its counterpart is the collecting renderer in `file-validation.ts`
 * (`validateFiles`), which reaches the same verdict and reports it as a list
 * instead of a throw.
 *
 * @param input - The file and the deploy so far (`totalSize` INCLUDES it)
 * @param limits - The platform's limits, from `/limits`
 * @throws {ShipError} The first broken rule's sentence
 */
export function validateDeployFile(input: FileRuleInput, limits: PlatformLimits): void {
  const broken = firstBrokenRule(input, limits);
  if (broken) {
    throw ShipError.business(broken.sentence(input, limits));
  }
}
