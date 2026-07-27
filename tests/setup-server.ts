/**
 * @file Mock-server lifecycle — loaded by the `integration` project only.
 * Hermeticity (credential scrub, no-network guard) lives in `setup.ts`, which
 * both projects load.
 *
 * One server and one state PER TEST FILE, on an ephemeral port. That is what
 * makes `fileParallelism` safe: no file can observe another's writes, and no
 * two files can contend for a port. Tests read the URL through
 * `getMockServerUrl()` — same worker process, so no side channel is needed.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanupMockServer, resetMockServer, setupMockServer } from './mocks/server';

beforeAll(async () => {
  await setupMockServer();
}, 10000);

afterAll(async () => {
  await cleanupMockServer();
}, 5000);

afterEach(() => {
  resetMockServer();
});
