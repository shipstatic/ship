import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { optimizeDeployPaths } from '../../../src/shared/lib/deploy-paths';
import { findCommonParent } from '../../../src/shared/lib/path';

describe('Deploy Path Optimization', () => {
  describe('Default behavior (flattening enabled)', () => {
    it('should create clean deployment paths from build outputs', () => {
      const filePaths = [
        'dist/index.html',
        'dist/vite.svg',
        'dist/assets/browser-SQEQcwkt',
        'dist/assets/index-BaplGdt4',
        'dist/assets/style-CuqkljXd.css',
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'vite.svg',
        'assets/browser-SQEQcwkt',
        'assets/index-BaplGdt4',
        'assets/style-CuqkljXd.css',
      ]);
    });

    it('should handle React build structure', () => {
      const filePaths = [
        'build/index.html',
        'build/static/css/main.abc123.css',
        'build/static/js/main.def456',
        'build/static/media/logo.789xyz.png',
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'static/css/main.abc123.css',
        'static/js/main.def456',
        'static/media/logo.789xyz.png',
      ]);
    });

    it('should handle nested project structure', () => {
      const filePaths = [
        'project/src/components/Header.tsx',
        'project/src/components/Footer.tsx',
        'project/src/utils/helpers.ts',
        'project/public/favicon.ico',
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual([
        'src/components/Header.tsx',
        'src/components/Footer.tsx',
        'src/utils/helpers.ts',
        'public/favicon.ico',
      ]);
    });

    it('should handle flat directory structure', () => {
      const filePaths = ['site/index.html', 'site/style.css', 'site/script'];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['index.html', 'style.css', 'script']);
    });

    it('should preserve structure when no common directory exists', () => {
      const filePaths = ['app/index.html', 'docs/readme.md', 'tests/unit'];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['app/index.html', 'docs/readme.md', 'tests/unit']);
    });

    it('should handle mixed depth files', () => {
      const filePaths = ['src/index.html', 'src/deep/nested/component.tsx'];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['index.html', 'deep/nested/component.tsx']);
    });

    it('should extract correct filenames', () => {
      const filePaths = ['dist/assets/browser-SQEQcwkt', 'dist/index.html'];

      const result = optimizeDeployPaths(filePaths);

      expect(result[0].name).toBe('browser-SQEQcwkt');
      expect(result[1].name).toBe('index.html');
    });
  });

  describe('Flattening disabled', () => {
    it('should preserve original directory structure', () => {
      const filePaths = [
        'dist/index.html',
        'dist/assets/browser-SQEQcwkt',
        'dist/assets/style.css',
      ];

      const result = optimizeDeployPaths(filePaths, { flatten: false });
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual([
        'dist/index.html',
        'dist/assets/browser-SQEQcwkt',
        'dist/assets/style.css',
      ]);
    });

    it('should normalize paths even when not flattening', () => {
      const filePaths = ['\\Windows\\path\\file.txt', '/unix/path/file.txt'];

      const result = optimizeDeployPaths(filePaths, { flatten: false });
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['Windows/path/file.txt', 'unix/path/file.txt']);
    });

    it('should normalize separators mixed WITHIN a single path', () => {
      // Not the same case as the pure-Windows/pure-Unix pair above: a Windows
      // caller can produce `dist\assets/app` when a config value with forward
      // slashes is joined onto an OS path. The common parent must still be
      // found across the two spellings.
      const filePaths = ['dist\\index.html', 'dist/vite.svg', 'dist\\assets/app'];

      const result = optimizeDeployPaths(filePaths, { flatten: true });
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['index.html', 'vite.svg', 'assets/app']);
    });
  });

  describe('Edge cases', () => {
    it('should handle single file', () => {
      const result = optimizeDeployPaths(['index.html']);
      expect(result[0].path).toBe('index.html');
      expect(result[0].name).toBe('index.html');
    });

    it('should handle empty array', () => {
      const result = optimizeDeployPaths([]);
      expect(result).toEqual([]);
    });

    it('should handle files with no extension', () => {
      const filePaths = ['dist/LICENSE', 'dist/README'];
      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map((f) => f.path);

      expect(deployPaths).toEqual(['LICENSE', 'README']);
    });

    it('should handle complex file extensions', () => {
      const filePaths = ['dist/app.config', 'dist/package.json.backup'];
      const result = optimizeDeployPaths(filePaths);

      expect(result[0].name).toBe('app.config');
      expect(result[1].name).toBe('package.json.backup');
    });
  });
});

// ---------------------------------------------------------------------------
// Properties. `optimizeDeployPaths` decides what every deployed URL looks like,
// so the interesting failures are the inputs nobody thought to write down.
// Example-based tests above pin the cases we know; these bound the whole space.
// ---------------------------------------------------------------------------

/** A path segment that is safe on every platform and never a dot-file. */
const segment = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,7}$/);

/** 1–4 segments joined — i.e. a plausible relative deploy path. */
const relPath = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join('/'));

describe('optimizeDeployPaths properties', () => {
  it('is idempotent — optimizing twice equals optimizing once', () => {
    // The CLI and the SDK both call it, and a caller cannot know whether the
    // paths it holds have already been through it.
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 8 }), (paths) => {
        const once = optimizeDeployPaths(paths).map((f) => f.path);
        const twice = optimizeDeployPaths(once).map((f) => f.path);
        expect(twice).toEqual(once);
      }),
    );
  });

  it('never loses or invents a file', () => {
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 8 }), (paths) => {
        expect(optimizeDeployPaths(paths)).toHaveLength(paths.length);
      }),
    );
  });

  it('emits no path that escapes the deployment root', () => {
    // A leading `/` or a `..` segment would address something outside the
    // deployment — the API refuses both, so producing one is a client bug.
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 8 }), (paths) => {
        for (const { path } of optimizeDeployPaths(paths)) {
          expect(path.startsWith('/')).toBe(false);
          expect(path.split('/')).not.toContain('..');
          expect(path).not.toContain('\\');
        }
      }),
    );
  });

  it('preserves each file’s basename', () => {
    // Only the shared PREFIX may be stripped. Losing a basename means serving
    // a file at the wrong URL.
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 8 }), (paths) => {
        const before = paths.map((p) => p.split('/').pop()).sort();
        const after = optimizeDeployPaths(paths)
          .map((f) => f.path.split('/').pop())
          .sort();
        expect(after).toEqual(before);
      }),
    );
  });
});

describe('findCommonParent properties', () => {
  it('answers identically whether the input uses posix or Windows separators', () => {
    // The one property the old "cross-environment" file was written to check
    // and structurally could not — it passed a separator argument that does
    // not exist, so both of its describes ran the same code path.
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 6 }), (paths) => {
        const posix = findCommonParent(paths);
        const windows = findCommonParent(paths.map((p) => p.replace(/\//g, '\\')));
        expect(windows).toEqual(posix);
      }),
    );
  });

  it('always returns a prefix of every input path', () => {
    fc.assert(
      fc.property(fc.array(relPath, { minLength: 1, maxLength: 6 }), (paths) => {
        const parent = findCommonParent(paths);
        if (parent === '') return;
        for (const p of paths) expect(p.startsWith(parent)).toBe(true);
      }),
    );
  });
});
