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

/** A path injection the junk filter does NOT catch, so the name rule refuses it. */
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
        [src('index.html'), src('dist/assets/app.js')],
        { pathDetect: false },
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html', 'dist/assets/app.js']);
    });

    it('keeps a site in its folder when pathDetect is false, so the refusal names that folder', async () => {
      await expect(
        processDeployFiles(
          [src('dist/index.html'), src('dist/assets/app.js')],
          { pathDetect: false },
          FREE_PLAN_LIMITS,
        ),
      ).rejects.toThrow("There's one in dist/. If that's your site, publish that folder instead.");
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

    it('refuses a deploy that is all junk: there is nothing left to publish', async () => {
      await expect(
        processDeployFiles([src('.DS_Store'), src('.git/config')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow('There are no files to publish.');
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
      const result = await processDeployFiles([src('index.html'), lying], {}, FREE_PLAN_LIMITS);

      expect(pathsOf(result)).toEqual(['index.html']);
      expect(lying.readCount).toBe(0);
    });

    it('stops reading at the first refusal', async () => {
      // A deploy refused at file two must not open files three and four. The
      // rules run before any I/O, on the strength of the path and size alone.
      const later = [src('c.txt'), src('d.txt')];
      await expect(
        processDeployFiles(
          [src('index.html'), src(NULL_BYTE_PATH), ...later],
          {},
          FREE_PLAN_LIMITS,
        ),
      ).rejects.toThrow('contains unsafe characters');

      expect(later.map((s) => s.readCount)).toEqual([0, 0]);
    });

    it('reads exactly once per file it keeps', async () => {
      const sources = [src('index.html'), src('b.txt')];
      await processDeployFiles(sources, {}, FREE_PLAN_LIMITS);

      expect(sources.map((s) => s.readCount)).toEqual([1, 1]);
    });
  });

  describe('the platform rules', () => {
    it('refuses a path injection by the name rule, naming the file', async () => {
      await expect(
        processDeployFiles([src('index.html'), src(NULL_BYTE_PATH)], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow(`File name "${NULL_BYTE_PATH}" contains unsafe characters.`);
    });

    it('lets the junk filter reach traversal segments first', async () => {
      // A `..` segment is dot-prefixed, so the junk filter drops it before the
      // rules see it: it is not published, rather than refused.
      const result = await processDeployFiles(
        [src('dist/index.html'), src('dist/../../escape.txt')],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html']);
    });

    it('refuses an extension the DELIVERED list names', async () => {
      await expect(processDeployFiles([src('virus.exe')], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'File "virus.exe" has an extension that is not allowed.',
      );
    });

    it('checks no extension when the API sent no list — fail open, never guess', async () => {
      const result = await processDeployFiles(
        [src('index.html'), src('virus.exe')],
        {},
        LIMITS_WITHOUT_BLOCKLIST,
      );

      expect(pathsOf(result)).toEqual(['index.html', 'virus.exe']);
    });

    it('refuses a file over maxFileSize', async () => {
      await expect(
        processDeployFiles([src('big.txt', 'aaaa')], {}, limitsWith({ maxFileSize: 3 })),
      ).rejects.toThrow('File "big.txt" is too large.');
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
      ).rejects.toThrow('Files add up to');
    });

    it('counts the file cap over RESULTS, not candidates', async () => {
      // Empty files were skipped, so they are not files this deploy will send
      // and must not push it over the cap.
      const result = await processDeployFiles(
        [src('index.html'), src('empty.txt', ''), src('b.txt')],
        {},
        limitsWith({ maxFilesCount: 2 }),
      );

      expect(pathsOf(result)).toEqual(['index.html', 'b.txt']);
    });

    it('refuses more results than maxFilesCount', async () => {
      await expect(
        processDeployFiles(
          [src('a.txt'), src('b.txt'), src('c.txt')],
          {},
          limitsWith({ maxFilesCount: 2 }),
        ),
      ).rejects.toThrow('Too many files (3). Maximum 2 files allowed. Upgrade to Pro for more.');
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
      ).rejects.toThrow(
        'File "package.json" belongs to a project that isn\'t built yet. Build it, then publish the folder the build makes, like dist.',
      );
    });

    it('applies no deploy rule, and needs no limits to say so', async () => {
      const result = await processDeployFiles([src('virus.exe'), src('huge.txt', 'aaaaaaaaaa')], {
        build: true,
      });

      expect(pathsOf(result)).toEqual(['virus.exe', 'huge.txt']);
    });

    it('carries the source as it was given: dot files and empty files included', async () => {
      // Which files a project holds is decided before this pipeline (drop's
      // `projectSource`), so nothing here may take one away: a build reads
      // its dot files and imports its empty ones.
      const result = await processDeployFiles(
        [
          src('package.json', '{}'),
          src('.npmrc', 'legacy-peer-deps=true'),
          src('.vitepress/config.mts', 'export default {}'),
          src('.yarnrc.yml', 'nodeLinker: node-modules'),
          src('src/App.css', ''),
        ],
        { build: true },
      );

      expect(pathsOf(result)).toEqual([
        'package.json',
        '.npmrc',
        '.vitepress/config.mts',
        '.yarnrc.yml',
        'src/App.css',
      ]);
      const empty = result.find((f) => f.path === 'src/App.css');
      expect(empty?.size).toBe(0);
      expect(empty?.md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    it('still filters junk and skips empties on the ordinary deploy path', async () => {
      const empty = src('empty.txt', '');
      const result = await processDeployFiles(
        [src('index.html', 'hello'), src('.DS_Store'), src('.env'), empty],
        {},
        FREE_PLAN_LIMITS,
      );

      expect(pathsOf(result)).toEqual(['index.html']);
      expect(empty.readCount).toBe(0);
    });

    it('still hashes what it keeps', async () => {
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

    it('refuses no sources at all', async () => {
      await expect(processDeployFiles([], {}, FREE_PLAN_LIMITS)).rejects.toThrow(
        'There are no files to publish.',
      );
    });

    it('refuses a deploy with no index.html at its root', async () => {
      await expect(
        processDeployFiles([src('about.html'), src('app.js')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow(
        "There's no index.html at the top of your site. It's the page visitors see first, so your site needs one.",
      );
    });

    it('judges the home page over the files it publishes: an empty one is not one', async () => {
      await expect(
        processDeployFiles([src('index.html', ''), src('app.js')], {}, FREE_PLAN_LIMITS),
      ).rejects.toThrow("There's no index.html at the top of your site.");
    });
  });
});
