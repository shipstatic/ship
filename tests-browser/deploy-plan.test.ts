/**
 * @file The planner's serialized count on Chromium's REAL `FormData` encoder.
 *
 * The node tier (`tests/shared/core/deploy-plan.test.ts`) holds the same
 * rows against undici's encoder. A browser encodes `FormData` itself, and the
 * console and the public uploader deploy from one, so the count has to be a
 * ceiling here too: two bodies that differ in one value or one filename
 * differ by exactly what the counter says.
 */

import { describe, expect, it } from 'vitest';
import { serializedNameBytes, serializedValueBytes } from '../src/shared/core/deploy-plan';

const serialized = async (fd: FormData) => (await new Response(fd).arrayBuffer()).byteLength;

describe('the serialized count in Chromium', () => {
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
});
