/**
 * @file Subject: `src/shared/core/deploy-files.ts` — the one deploy pipeline.
 *
 * This is the merged mirror of an orchestration that used to be stated twice,
 * in `node-files.ts` and `browser-files.ts`: optimize the paths, drop the
 * junk, refuse what the platform's rules refuse, checksum what survives. The
 * two platform mirrors keep what is genuinely theirs — a real filesystem walk
 * with symlink cycles on one side, `webkitRelativePath` on the other — and
 * every row below is a fact neither of them can state alone.
 *
 * The sources here are synthetic on purpose. A `DeploySource` is a path, an
 * origin, a size and a `read()`, and nothing in this file needs a disk or a
 * browser to produce one — which is itself the evidence that the seam landed
 * in the right place.
 */

import type { PlatformLimits } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { type DeploySource, processDeployFiles } from '../../../src/shared/core/deploy-files';
import { FREE_PLAN_LIMITS, LIMITS_WITHOUT_BLOCKLIST } from '../../fixtures/builders';

/** The md5 of `hello` — a digest a truncated or skipped read cannot produce. */
const HELLO_MD5 = '5d41402abc4b2a76b9719d911017c592';

/**
 * A path injection the junk filter does NOT catch, so it reaches
 * `validateDeployPath` — see "lets the junk filter reach traversal segments
 * first" below for why this is the only one that does.
 */
const NULL_BYTE_PATH = 'logo\0.png';

interface TrackedSource extends DeploySource {
  /** How many times the pipeline asked for this file's bytes. */
  readCount: number;
}

/**
 * A source carrying `content`, counting its reads.
 *
 * `size` defaults to the content's byte length and can be overridden — the
 * two are separable BY DESIGN, because Node fills `size` from the stat its
 * directory walk already performed and never opens a file to learn it.
 */
function src(path: string, content = 'x', size?: number): TrackedSource {
  const source: TrackedSource = {
    path,
    origin: `/abs/${path}`,
    size: size ?? Buffer.byteLength(content),
    readCount: 0,
    read: async () => {
      source.readCount += 1;
      return Buffer.from(content);
    },
  };
  return source;
}

const pathsOf = (files: Array<{ path: string }>) => files.map((f) => f.path);

/** `FREE_PLAN_LIMITS` with one cap moved, so a rule can be reached in a test. */
const limitsWith = (overrides: Partial<PlatformLimits>): PlatformLimits => ({
  ...FREE_PLAN_LIMITS,
  ...overrides,
});

describe('processDeployFiles', () => {
  describe('paths', () => {
    it('strips the common directory by default', async () => {
      const result = await processDeployFiles(
        [src('dist/index.html'), src('dist/assets/app.js')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html', 'assets/app.js']);
    });

    it('preserves structure verbatim when pathDetect is false', async () => {
      const result = await processDeployFiles(
        [src('dist/index.html'), src('dist/assets/app.js')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['dist/index.html', 'dist/assets/app.js']);
    });
  });

  describe('junk', () => {
    it('drops junk and keeps each survivor paired with its own source', async () => {
      // The pairing is by INDEX against the optimized paths, so a filtered
      // entry in the middle is the case that catches an off-by-one: `app.js`
      // must come back carrying `app.js`'s bytes, not the ones after it.
      const result = await processDeployFiles(
        [
          src('site/index.html', 'index'),
          src('site/.DS_Store', 'junk'),
          src('site/app.js', 'hello'),
        ],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html', 'app.js']);
      expect(result[1].md5).toBe(HELLO_MD5);
    });

    it('never reads a file it filtered out', async () => {
      const junk = src('site/.DS_Store', 'junk');
      await processDeployFiles([src('site/index.html'), junk], {}, FREE_PLAN_LIMITS);

      expect(junk.readCount).toBe(0);
    });

    it('resolves empty — without demanding limits — when everything is junk', async () => {
      // Nothing to deploy is not a failure, and the answer is reached before
      // the rules are asked for: this call passes none and must not throw.
      const result = await processDeployFiles([src('.DS_Store'), src('.git/config')], {});

      expect(result).toEqual([]);
    });
  });

  describe('reading is earned', () => {
    it('skips a zero-size file without opening it', async () => {
      const empty = src('empty.txt', '');
      const result = await processDeployFiles([src('index.html'), empty], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['index.html']);
      expect(empty.readCount).toBe(0);
    });

    it('trusts the SOURCE for size, which is what keeps the skip free', async () => {
      // Node reports size from the stat its walk already performed. A pipeline
      // that learned size by reading would have opened this file to discover
      // it was empty — the exact cost the seam exists to avoid.
      const lying = src('claims-empty.txt', 'real bytes', 0);
      const result = await processDeployFiles([lying], {}, FREE_PLAN_LIMITS);

      expect(result).toEqual([]);
      expect(lying.readCount).toBe(0);
    });

    it('stops reading at the first refusal', async () => {
      // A deploy refused at file two must not open files three and four. The
      // security check runs before any I/O, on the strength of the path alone.
      const later = [src('c.txt'), src('d.txt')];
      await expect(
        processDeployFiles([src('a.txt'), src(NULL_BYTE_PATH), ...later], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow('Unsafe file path');

      expect(later.map((s) => s.readCount)).toEqual([0, 0]);
    });

    it('reads exactly once per file it keeps', async () => {
      const sources = [src('a.txt'), src('b.txt')];
      await processDeployFiles(sources, {}, FREE_PLAN_LIMITS);

      expect(sources.map((s) => s.readCount)).toEqual([1, 1]);
    });
  });

  describe('the platform rules', () => {
    it('refuses an unsafe deploy path, naming the source it came from', async () => {
      // The refusal quotes the ORIGIN, not the deploy path: the deploy path is
      // what went wrong, and the origin is the only thing that says which file
      // on the caller's machine produced it.
      await expect(processDeployFiles([src(NULL_BYTE_PATH)], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        `/abs/${NULL_BYTE_PATH}`,
      );
    });

    it('lets the junk filter reach traversal segments first', async () => {
      // `validateDeployPath` refuses four patterns; the junk filter runs ahead
      // of it and drops ANY dot-prefixed segment, so `..` never survives to be
      // refused — it is simply not deployed. Defence in depth, and the null
      // byte above is the one arm this pipeline can actually reach. True of
      // both pipelines before they were merged; recorded here because the
      // merge is what made it visible in one place.
      const result = await processDeployFiles(
        [src('dist/index.html'), src('dist/../../escape.txt')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html']);
    });

    it('refuses an extension the DELIVERED list names', async () => {
      await expect(processDeployFiles([src('virus.exe')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'File extension not allowed: "virus.exe"',
      );
    });

    it('checks no extension when the API sent no list — fail open, never guess', async () => {
      const result = await processDeployFiles([src('virus.exe')], {}, LIMITS_WITHOUT_BLOCKLIST);

      expect(pathsOf(result)).toEqual(['virus.exe']);
    });

    it('refuses a file over maxFileSize', async () => {
      await expect(
        processDeployFiles([src('big.txt', 'aaaa')], {}, limitsWith({ maxFileSize: 3 })),
      ).rejects.toThrow('File "big.txt" too large.');
    });

    it('refuses a cumulative size over maxTotalSize, accumulating across files', async () => {
      // Neither file breaks the per-file cap; together they break the total.
      // `totalSize` INCLUDES the file being judged, which is the arithmetic
      // the rule relies on and the reason it is the pipeline that accumulates.
      await expect(
        processDeployFiles(
          [src('a.txt', 'aa'), src('b.txt', 'aa')],
          {},
          limitsWith({ maxTotalSize: 3 }),
        ),
      ).rejects.toThrow('Total upload size too large.');
    });

    it('counts the file cap over RESULTS, not candidates', async () => {
      // Empty files were skipped, so they are not files this deploy will send
      // and must not push it over the cap.
      const result = await processDeployFiles(
        [src('a.txt'), src('empty.txt', ''), src('b.txt')],
        {},
        limitsWith({ maxFilesCount: 2 }),
      );

      expect(pathsOf(result)).toEqual(['a.txt', 'b.txt']);
    });

    it('refuses more results than maxFilesCount', async () => {
      await expect(
        processDeployFiles(
          [src('a.txt'), src('b.txt'), src('c.txt')],
          {},
          limitsWith({ maxFilesCount: 2 }),
        ),
      ).rejects.toThrow('Too many files to deploy. Maximum allowed is 2 files.');
    });

    it('refuses to validate against rules it was not given', async () => {
      await expect(processDeployFiles([src('index.html')], {})).rejects.toThrow(
        'Platform limits not provided',
      );
    });
  });

  describe('server-processed uploads (build / prerender)', () => {
    // `build` and `prerender` upload SOURCE files for the build service to
    // compile. The deploy rules describe its OUTPUT, so this pipeline applies
    // none of them — and the unbuilt refusal would reject exactly the input
    // the flags exist to accept.
    it.each([{ build: true }, { prerender: true }])(
      'keeps an unbuilt project under %o',
      async (flags) => {
        const result = await processDeployFiles(
          [src('src/index.js'), src('package.json')],
          flags,
          FREE_PLAN_LIMITS,
        );

        expect(pathsOf(result)).toEqual(['src/index.js', 'package.json']);
      },
    );

    it('still refuses an unbuilt project on the ordinary deploy path', async () => {
      await expect(
        processDeployFiles([src('src/index.js'), src('package.json')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow('Unbuilt project detected');
    });

    it('applies no deploy rule, and needs no limits to say so', async () => {
      const result = await processDeployFiles([src('virus.exe'), src('huge.txt', 'aaaaaaaaaa')], {
        build: true,
      });

      expect(pathsOf(result)).toEqual(['virus.exe', 'huge.txt']);
    });

    it('still filters junk and still skips empties', async () => {
      const empty = src('empty.txt', '');
      const result = await processDeployFiles(
        [src('index.html', 'hello'), src('.DS_Store'), empty],
        { build: true },
      );

      expect(pathsOf(result)).toEqual(['index.html']);
      expect(empty.readCount).toBe(0);
    });

    it('still checksums what it keeps', async () => {
      const result = await processDeployFiles([src('index.html', 'hello')], { prerender: true });

      expect(result[0].md5).toBe(HELLO_MD5);
    });
  });

  describe('the StaticFile it produces', () => {
    it('carries the deploy path, the source size, the bytes and a real digest', async () => {
      const [file] = await processDeployFiles(
        [src('dist/index.html', 'hello')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(file).toEqual({
        path: 'index.html',
        content: Buffer.from('hello'),
        size: 5,
        md5: HELLO_MD5,
      });
    });

    it('resolves empty for no sources at all', async () => {
      expect(await processDeployFiles([], {}, FREE_PLAN_LIMITS)).toEqual([]);
    });
  });
});
