import { filterJunk } from '../../../src/shared/lib/junk';

// We don't need to import 'junk' here directly for tests unless we are comparing its behavior for some reason.
// The filterJunk function itself uses it internally.

describe('filterJunk', () => {
  it('answers nothing for no paths', () => {
    expect(filterJunk([])).toEqual([]);
  });

  it('should filter files based on junk.isJunk() for basenames', () => {
    const files = [
      'normal.txt',
      '.DS_Store', // junk.isJunk should catch this
      'path/to/Thumbs.db', // junk.isJunk should catch Thumbs.db
      'another/desktop.ini', // junk.isJunk should catch desktop.ini
      'image.jpg',
      '._somefile', // junk.isJunk should catch this prefix
    ];
    const expected = ['normal.txt', 'image.jpg'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should filter files within JUNK_DIRECTORIES (case-insensitive)', () => {
    const files = [
      'project/src/index.ts',
      '__MACOSX/resource.txt', // Junk directory
      'some/path/.Trashes/item', // Junk directory
      'another/.fseventsd/logs', // Junk directory
      'stuff/.Spotlight-V100/db', // Junk directory
      'prefix/__macosx/file.txt', // Case-insensitive junk directory
      'valid/file.md',
      // Note: .DS_Store is always a file on macOS, never a directory
    ];
    const expected = ['project/src/index.ts', 'valid/file.md'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should filter files in nested junk directories', () => {
    const files = [
      'assets/image.png',
      'root/__MACOSX/subfolder/anotherfile.txt', // Nested junk
      'docs/config.json',
      'tmp/.Trashes/user/docs/backup.zip', // Nested junk
    ];
    const expected = ['assets/image.png', 'docs/config.json'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should handle paths with mixed junk and non-junk components', () => {
    const files = [
      '__MACOSX/valid-file-in-junk-dir.txt', // Junk by dir
      'not_junk_dir/.DS_Store', // Junk by filename
      'ok_dir/ok_file.txt',
      'foo/.Trashes/bar/baz.txt', // Junk by dir
    ];
    const expected = ['ok_dir/ok_file.txt'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should return all paths if no junk files or directories are present', () => {
    const files = ['src/component', 'README.md', 'assets/logo.svg', 'config.json'];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should return an empty array if all input paths are junk', () => {
    const files = ['.DS_Store', '__MACOSX/a.txt', 'foo/.Trashes/b.txt', 'bar/Thumbs.db'];
    expect(filterJunk(files)).toEqual([]);
  });

  it('should handle paths with leading/trailing slashes and normalize separators', () => {
    const files = [
      '/valid/path/to/file.txt',
      'another\\valid\\path',
      '/junk_dir_test/__MACOSX/inner/file.doc',
      'nonjunk\\endingwithslash\\',
      'C:\\Users\\name\\.Trashes\\tempfile.tmp',
    ];
    const expected = [
      '/valid/path/to/file.txt',
      'another\\valid\\path',
      'nonjunk\\endingwithslash\\',
    ];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should not filter files if directory names *contain* junk dir names but are not exact matches', () => {
    const files = ['project__MACOSX_backup/file.txt', 'My.DS_Store_archive/data.zip'];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should correctly filter paths that are themselves junk directory names or junk file names', () => {
    const files = ['file.txt', '.DS_Store', '__MACOSX', '.Trashes'];
    const expected = ['file.txt']; // Reverted to original expectation
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should handle null or undefined paths within the input array by filtering them out', () => {
    const files = [
      'file1.txt',
      null as any,
      'folder/file2.png',
      undefined as any,
      '.DS_Store',
      'another.jpg',
    ];
    const expected = ['file1.txt', 'folder/file2.png', 'another.jpg'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should filter all dot files and directories for security', () => {
    const files = [
      'index.html',
      '.env',
      '.gitignore',
      '.gitattributes',
      'src/.htaccess',
      '.config/settings.json',
      'app.js',
    ];
    const expected = ['index.html', 'app.js'];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should allow .well-known directory (RFC 8615)', () => {
    // .well-known is not junk — it's a standard public directory.
    // Works with any path shape: relative, prefixed, absolute.
    // Root-level constraint is enforced at upload (buildFileKey) and serving (isBlockedDotFile).
    const files = [
      '.well-known/security.txt',
      '.well-known/acme-challenge/token-12345',
      '.well-known/apple-app-site-association',
      '.well-known/assetlinks.json',
      'mysite/.well-known/security.txt',
      '/Users/bob/site/.well-known/acme-challenge/token',
    ];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should require exact case for .well-known', () => {
    const files = [
      'index.html',
      '.Well-Known/security.txt',
      '.WELL-KNOWN/security.txt',
      '.Well-known/security.txt',
    ];
    expect(filterJunk(files)).toEqual(['index.html']);
  });

  it('should still block dot files under .well-known', () => {
    const files = ['.well-known/security.txt', '.well-known/.secret', '.well-known/.env'];
    expect(filterJunk(files)).toEqual(['.well-known/security.txt']);
  });

  it('keeps a name that is too long: the deploy rules refuse it in words', () => {
    // Left out here, the site would go live without the file and nobody
    // would be told.
    const tooLong = `${'b'.repeat(256)}.js`;
    expect(filterJunk(['index.html', tooLong, `dir/${tooLong}`])).toEqual([
      'index.html',
      tooLong,
      `dir/${tooLong}`,
    ]);
  });
});

describe("filterJunk — a project's files are not junk", () => {
  // The junk filter judges nothing about a project: it keeps a project's
  // files so the deploy rules refuse them by name ("project",
  // @shipstatic/types). It filters, and never throws.
  it('keeps node_modules and package.json paths for the rules to refuse', () => {
    expect(filterJunk(['index.html', 'node_modules/react/index.js', 'package.json'])).toEqual([
      'index.html',
      'node_modules/react/index.js',
      'package.json',
    ]);
  });

  it('keeps a pnpm store path the dot-file filter would otherwise drop', () => {
    // pnpm keeps a project's packages under node_modules/.pnpm/; dropping
    // them as dot files would take the only sign of an unbuilt project.
    const pnpm = 'demo/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js';
    expect(filterJunk(['demo/index.html', pnpm])).toEqual(['demo/index.html', pnpm]);
  });

  it('reads markers by path segment, never as a substring', () => {
    expect(
      filterJunk([
        'my_node_modules_docs.txt',
        'node_modules_backup.zip',
        'not-node_modules/file.js',
      ]),
    ).toEqual(['my_node_modules_docs.txt', 'node_modules_backup.zip', 'not-node_modules/file.js']);
  });
});
