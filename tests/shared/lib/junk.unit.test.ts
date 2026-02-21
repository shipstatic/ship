import { filterJunk } from '../../../src/shared/lib/junk';
// We don't need to import 'junk' here directly for tests unless we are comparing its behavior for some reason.
// The filterJunk function itself uses it internally.

describe('filterJunk', () => {
  it('should return an empty array if input is empty or null', () => {
    expect(filterJunk([])).toEqual([]);
    // @ts-expect-error testing null explicitly
    expect(filterJunk(null)).toEqual([]);
    // @ts-expect-error testing undefined explicitly
    expect(filterJunk(undefined)).toEqual([]);
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
      'valid/file.md'
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
    const files = [
      'src/component',
      'README.md',
      'assets/logo.svg',
      'package.json',
    ];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should return an empty array if all input paths are junk', () => {
    const files = [
      '.DS_Store',
      '__MACOSX/a.txt',
      'foo/.Trashes/b.txt',
      'bar/Thumbs.db',
    ];
    expect(filterJunk(files)).toEqual([]);
  });

  it('should handle paths with leading/trailing slashes and normalize separators', () => {
    const files = [
      '/valid/path/to/file.txt',
      'another\\valid\\path',
      '/junk_dir_test/__MACOSX/inner/file.doc',
      'nonjunk\\endingwithslash\\',
      'C:\\Users\\name\\.Trashes\\tempfile.tmp'
    ];
    const expected = [
      '/valid/path/to/file.txt',
      'another\\valid\\path',
      'nonjunk\\endingwithslash\\',
    ];
    expect(filterJunk(files)).toEqual(expected);
  });

  it('should not filter files if directory names *contain* junk dir names but are not exact matches', () => {
    const files = [
      'project__MACOSX_backup/file.txt',
      'My.DS_Store_archive/data.zip',
    ];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should correctly filter paths that are themselves junk directory names or junk file names', () => {
    const files = [
      'file.txt',
      '.DS_Store',
      '__MACOSX',
      '.Trashes',
    ];
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

  it('should allow .well-known at root level (RFC 8615)', () => {
    const files = [
      'index.html',
      '.well-known/security.txt',
      '.well-known/acme-challenge/token-12345',
      '.well-known/apple-app-site-association',
      '.well-known/assetlinks.json',
      'app.js',
    ];
    expect(filterJunk(files)).toEqual(files);
  });

  it('should block .well-known at non-root levels', () => {
    const files = [
      'index.html',
      'subdir/.well-known/security.txt',
      'deep/nested/.well-known/file',
    ];
    expect(filterJunk(files)).toEqual(['index.html']);
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
    const files = [
      '.well-known/security.txt',
      '.well-known/.secret',
      '.well-known/.env',
    ];
    expect(filterJunk(files)).toEqual(['.well-known/security.txt']);
  });

  it('should filter path segments exceeding 255 characters', () => {
    // Path segments (directory or filename) are checked individually
    // Each segment must be <= 255 characters
    const okSegment = 'a'.repeat(255);     // 255 chars - OK
    const tooLongSegment = 'b'.repeat(256); // 256 chars - filtered

    const files = [
      'index.html',
      `${okSegment}.txt`,              // Filename "aaa...aaa.txt" = 259 chars - filtered (> 255)
      `dir/${okSegment}/file.txt`,     // Directory "aaa...aaa" = 255 chars - OK
      `dir/${tooLongSegment}/file.txt`, // Directory "bbb...bbb" = 256 chars - filtered
    ];

    const expected = [
      'index.html',
      `dir/${okSegment}/file.txt`,  // Only this passes (all segments <= 255)
    ];
    expect(filterJunk(files)).toEqual(expected);
  });
});
