/**
 * @file Default platform limits used by file-processing tests.
 *
 * Tests that exercise `processFilesForBrowser` / `processFilesForNode`
 * directly need to pass platform limits explicitly — they are now an
 * argument to those functions rather than a module-level singleton, so
 * concurrent Ships against different API URLs cannot clobber each other's
 * caps. This fixture provides a sensible default for tests that don't
 * care about specific limit values.
 */

import type { PlatformLimits } from '@shipstatic/types';

export const TEST_PLATFORM_LIMITS: PlatformLimits = {
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  maxFilesCount: 1000,
  maxTotalSize: 100 * 1024 * 1024, // 100 MB
};
