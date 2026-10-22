/**
 * @file Subject: `src/shared/core/deploy-plan.ts`, how a deploy is split.
 *
 * The planner counts; it never measures. Two properties hold it: every
 * request it plans fits `MAX_BYTES` by its own count, and its count is a
 * ceiling on what a real `FormData` serializes to, so the server's count can
 * never exceed it. The second is checked against the runtime's own encoder,
 * here on node and in `tests-browser/deploy-plan.test.ts` on Chromium, over
 * the inputs where the encoding differs from the raw value: line breaks in a
 * text field, quotes and line breaks in a filename, a long non-ASCII path, and
 * the largest manifest a plan allows.
 */

import { DEPLOY_REQUEST_CONSTRAINTS } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import {
  createDeployBody,
  deployFields,
  deployManifest,
} from '../../../src/shared/core/deploy-body';
import {
  bodyBytes,
  planDeploy,
  serializedNameBytes,
  serializedValueBytes,
} from '../../../src/shared/core/deploy-plan';
import type { StaticFile } from '../../../src/shared/types';

const { MAX_BYTES } = DEPLOY_REQUEST_CONSTRAINTS;
const MiB = 1024 * 1024;
const MD5 = 'c83301425b2ad1d496473a5ff3d9ecca';

/** A file the planner sees: it reads the path and the size, never the bytes. */
const sized = (path: string, size: number): StaticFile => ({
  path,
  content: Buffer.alloc(0),
  size,
  md5: MD5,
});

/** A file whose bytes are real, for the serialized fixture. */
const real = (path: string, text: string): StaticFile => ({
  path,
  content: Buffer.from(text),
  size: Buffer.byteLength(text),
  md5: MD5,
});

describe('planDeploy', () => {
  it('sends a deploy that fits as one request, the declaration carrying every file', () => {
    const files = [sized('index.html', 10), sized('a.png', 20 * MiB), sized('ship.json', 20)];
    const plan = planDeploy(files, deployFields(deployManifest(files)));

    expect(plan).toEqual({ declaration: files, fills: [] });
  });

  it('declares a deploy that does not fit bare, with the files that configure it, then fills it in order', () => {
    const files = [
      sized('a.png', 30 * MiB),
      sized('index.html', 10),
      sized('b.png', 30 * MiB),
      sized('ship.json', 20),
      sized('blog/index.html', 10),
      sized('c.png', 30 * MiB),
      sized('docs/ship.json', 20),
    ];

    // The same with or without the opt-out: the rule has no condition.
    for (const context of [{}, { spa: false }]) {
      const plan = planDeploy(files, deployFields(deployManifest(files), context));

      expect(plan.declaration.map((f) => f.path)).toEqual(['index.html', 'ship.json']);
      // Every other file exactly once, in the order given; a nested page or
      // ship.json is ordinary content.
      expect(plan.fills.flat().map((f) => f.path)).toEqual([
        'a.png',
        'b.png',
        'blog/index.html',
        'c.png',
        'docs/ship.json',
      ]);
      for (const fill of plan.fills) expect(bodyBytes(fill, [])).toBeLessThanOrEqual(MAX_BYTES);
      expect(plan.fills).toHaveLength(2);
    }
  });

  it('refuses a prerender that does not fit one request, as it refuses a build', () => {
    const files = [sized('src/a.ts', 40 * MiB), sized('src/b.ts', 40 * MiB)];
    const fields = deployFields(deployManifest(files), { flags: { prerender: true } });

    expect(() => planDeploy(files, fields)).toThrow('We can build projects up to 64 MB.');
  });

  it('lets one request carry a file at the largest size a plan sells', () => {
    const files = [sized('a.png', 50 * MiB), sized('b.png', 50 * MiB)];
    const plan = planDeploy(files, deployFields(deployManifest(files)));

    expect(plan.fills.map((fill) => fill.map((f) => f.path))).toEqual([['a.png'], ['b.png']]);
  });

  it('refuses a build that does not fit one request, before a byte is sent', () => {
    const files = [sized('src/a.ts', 40 * MiB), sized('src/b.ts', 40 * MiB)];

    const fields = deployFields(deployManifest(files), { flags: { build: true } });

    expect(() => planDeploy(files, fields)).toThrow(
      'We can build projects up to 64 MB. Build this one on your computer and upload the built folder instead.',
    );
  });
});

describe('bodyBytes: a ceiling on what the runtime serializes', () => {
  /** The bytes a real `FormData` encodes to, through the runtime's own `fetch` encoder. */
  const serialized = async (fd: FormData) => (await new Response(fd).arrayBuffer()).byteLength;

  it.each([
    [
      'a password with interior line breaks of every kind',
      [real('index.html', '<p>hi</p>')],
      { password: 'first\nsecond\r\nthird\rfourth' },
    ],
    [
      'build source names carrying quotes and line breaks',
      [real('src/"quoted".ts', 'a'), real('src/line\nbreak.ts', 'b'), real('src/cr\rhere.ts', 'c')],
      { flags: { build: true } },
    ],
    [
      'the longest non-ASCII deploy path',
      // 333 three-byte characters and one more byte: 1000 bytes, the path ceiling.
      [real(`${'é'.repeat(499)}x`, 'x'), real(`${'日'.repeat(333)}a`, 'y')],
      { labels: ['env:production', 'team:web'], via: 'cli' as const, ttl: 3600 },
    ],
  ])('holds for %s', async (_case, files, context) => {
    const fields = deployFields(deployManifest(files), context);
    const fd = createDeployBody(files, fields);

    expect(await serialized(fd)).toBeLessThanOrEqual(bodyBytes(files, fields));
  });

  // The rows above leave the framing's slack between the count and the
  // body, so they cannot see a counter that is off by a few bytes. These two
  // can: two bodies that differ in one value or one name differ, on the
  // runtime's own encoder, by exactly what the counter says.
  it.each(['plain', 'first\nsecond\r\nthird\rfourth', 'é日\n'])(
    'counts the text value %j exactly as the encoder sends it',
    async (value) => {
      const with_ = new FormData();
      with_.append('password', value);
      const without = new FormData();
      without.append('password', '');

      expect((await serialized(with_)) - (await serialized(without))).toBe(
        serializedValueBytes(value),
      );
    },
  );

  it.each(['plain.ts', 'src/"quoted".ts', 'line\nbreak.ts', 'cr\rhere.ts', 'é日.html'])(
    'counts the filename %j exactly as the encoder sends it',
    async (name) => {
      const named = (filename: string) => {
        const fd = new FormData();
        fd.append('files[]', new File(['x'], filename));
        return fd;
      };

      expect((await serialized(named(name))) - (await serialized(named('a')))).toBe(
        serializedNameBytes(name) - 1,
      );
    },
  );

  it('holds for the largest manifest a plan allows', async () => {
    // 2000 files, each with a long path, all declared and none carried.
    const files = Array.from({ length: 2000 }, (_, i) =>
      sized(`${'deep/'.repeat(150)}${String(i).padStart(6, '0')}.html`, 1),
    );
    const fields = deployFields(deployManifest(files), { password: 'a\nb' });
    const fd = createDeployBody([], fields);

    expect(await serialized(fd)).toBeLessThanOrEqual(bodyBytes([], fields));
  });
});
