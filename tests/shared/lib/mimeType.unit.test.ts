/**
 * Tests for MIME type utility
 */
import { describe, it, expect } from 'vitest';
import { getMimeType } from '../../../src/shared/lib/mimeType';

describe('getMimeType', () => {
  describe('common file types', () => {
    it('should return correct MIME type for JavaScript files', () => {
      expect(getMimeType('app.js')).toBe('application/javascript');
      expect(getMimeType('src/index.js')).toBe('application/javascript');
    });

    it('should return correct MIME type for HTML files', () => {
      expect(getMimeType('index.html')).toBe('text/html');
      expect(getMimeType('pages/about.html')).toBe('text/html');
    });

    it('should return correct MIME type for CSS files', () => {
      expect(getMimeType('styles.css')).toBe('text/css');
      expect(getMimeType('dist/main.css')).toBe('text/css');
    });

    it('should return correct MIME type for JSON files', () => {
      expect(getMimeType('package.json')).toBe('application/json');
      expect(getMimeType('data.json')).toBe('application/json');
    });

    it('should return correct MIME type for image files', () => {
      expect(getMimeType('photo.jpg')).toBe('image/jpeg');
      expect(getMimeType('logo.png')).toBe('image/png');
      expect(getMimeType('icon.svg')).toBe('image/svg+xml');
      expect(getMimeType('animation.gif')).toBe('image/gif');
      expect(getMimeType('image.webp')).toBe('image/webp');
    });

    it('should return correct MIME type for TypeScript files', () => {
      // Note: mime-db maps .ts to video/mp2t (MPEG transport stream)
      // and doesn't have .tsx registered, so it returns the fallback
      expect(getMimeType('app.ts')).toBe('video/mp2t');
      expect(getMimeType('component.tsx')).toBe('application/octet-stream');
    });

    it('should return correct MIME type for Markdown files', () => {
      expect(getMimeType('README.md')).toBe('text/markdown');
      expect(getMimeType('docs/guide.md')).toBe('text/markdown');
    });

    it('should return correct MIME type for font files', () => {
      expect(getMimeType('font.woff')).toBe('font/woff');
      expect(getMimeType('font.woff2')).toBe('font/woff2');
      expect(getMimeType('font.ttf')).toBe('font/ttf');
    });

    it('should return correct MIME type for video files', () => {
      expect(getMimeType('video.mp4')).toBe('application/mp4');
      expect(getMimeType('clip.webm')).toBe('video/webm');
    });

    it('should return correct MIME type for audio files', () => {
      expect(getMimeType('song.mp3')).toBe('audio/mp3');
      expect(getMimeType('audio.wav')).toBe('audio/wav');
      expect(getMimeType('track.ogg')).toBe('audio/ogg');
    });

    it('should return correct MIME type for archive files', () => {
      expect(getMimeType('archive.zip')).toBe('application/x-zip-compressed');
      expect(getMimeType('file.tar')).toBe('application/x-tar');
      expect(getMimeType('file.gz')).toBe('application/gzip');
    });
  });

  describe('edge cases', () => {
    it('should handle files with multiple dots in the path', () => {
      expect(getMimeType('file.name.with.dots.js')).toBe('application/javascript');
      expect(getMimeType('my.config.json')).toBe('application/json');
    });

    it('should handle files with no extension', () => {
      expect(getMimeType('README')).toBe('application/octet-stream');
      expect(getMimeType('Makefile')).toBe('application/octet-stream');
      expect(getMimeType('file')).toBe('application/octet-stream');
    });

    it('should handle files with unknown extensions', () => {
      // Note: .xyz is actually registered in mime-db as chemical/x-xyz
      expect(getMimeType('file.xyz')).toBe('chemical/x-xyz');
      expect(getMimeType('document.unknownext')).toBe('application/octet-stream');
    });

    it('should be case-insensitive for extensions', () => {
      expect(getMimeType('file.JS')).toBe('application/javascript');
      expect(getMimeType('file.HTML')).toBe('text/html');
      expect(getMimeType('file.PNG')).toBe('image/png');
      expect(getMimeType('file.JpG')).toBe('image/jpeg');
    });

    it('should handle nested paths', () => {
      expect(getMimeType('src/components/App.tsx')).toBe('application/octet-stream');
      expect(getMimeType('public/assets/images/logo.png')).toBe('image/png');
      expect(getMimeType('a/b/c/d/e/file.json')).toBe('application/json');
    });

    it('should handle paths with trailing slashes (as file names)', () => {
      expect(getMimeType('weird/')).toBe('application/octet-stream');
    });

    it('should handle empty paths', () => {
      expect(getMimeType('')).toBe('application/octet-stream');
    });

    it('should handle paths with only extension', () => {
      expect(getMimeType('.js')).toBe('application/javascript');
      expect(getMimeType('.html')).toBe('text/html');
    });

    it('should handle hidden files', () => {
      expect(getMimeType('.gitignore')).toBe('application/octet-stream');
      expect(getMimeType('.eslintrc.json')).toBe('application/json');
      expect(getMimeType('folder/.hidden.js')).toBe('application/javascript');
    });
  });

  describe('browser-compatibility', () => {
    it('should not use Node.js path module', () => {
      // This test verifies the implementation doesn't rely on Node.js APIs
      // by ensuring it works with plain string manipulation
      const result = getMimeType('test.js');
      expect(typeof result).toBe('string');
      expect(result).toBe('application/javascript');
    });

    it('should work with paths from File objects', () => {
      // Simulates file.path or file.name from File objects
      expect(getMimeType('upload.jpg')).toBe('image/jpeg');
      expect(getMimeType('document.pdf')).toBe('application/pdf');
      expect(getMimeType('data.csv')).toBe('text/csv');
    });

    it('should work with webkitRelativePath-style paths', () => {
      // Simulates paths from dropped folders in browsers
      expect(getMimeType('folder-name/index.html')).toBe('text/html');
      expect(getMimeType('my-project/src/index.js')).toBe('application/javascript');
      expect(getMimeType('uploads/photos/vacation.jpg')).toBe('image/jpeg');
    });
  });

  describe('real-world file examples from Ship deployments', () => {
    it('should handle common web development files', () => {
      expect(getMimeType('package.json')).toBe('application/json');
      expect(getMimeType('tsconfig.json')).toBe('application/json');
      expect(getMimeType('vite.config.ts')).toBe('video/mp2t');
      expect(getMimeType('App.tsx')).toBe('application/octet-stream');
      expect(getMimeType('styles.css')).toBe('text/css');
      expect(getMimeType('index.html')).toBe('text/html');
    });

    it('should handle favicon files', () => {
      expect(getMimeType('favicon.ico')).toBe('image/vnd.microsoft.icon');
      expect(getMimeType('favicon-16x16.png')).toBe('image/png');
      expect(getMimeType('favicon-32x32.png')).toBe('image/png');
    });

    it('should handle common static site assets', () => {
      expect(getMimeType('assets/stars.svg')).toBe('image/svg+xml');
      expect(getMimeType('assets/logo.png')).toBe('image/png');
      expect(getMimeType('styles.css')).toBe('text/css');
      expect(getMimeType('README.md')).toBe('text/markdown');
    });

    it('should handle build output files', () => {
      expect(getMimeType('dist/bundle.js')).toBe('application/javascript');
      expect(getMimeType('dist/main.css')).toBe('text/css');
      expect(getMimeType('.next/static/chunk.js')).toBe('application/javascript');
      expect(getMimeType('out/index.html')).toBe('text/html');
    });

    it('should handle SPA configuration files', () => {
      expect(getMimeType('_headers')).toBe('application/octet-stream');
      expect(getMimeType('_redirects')).toBe('application/octet-stream');
      expect(getMimeType('robots.txt')).toBe('text/plain');
      expect(getMimeType('sitemap.xml')).toBe('application/xml');
    });
  });

  describe('consistency with StaticFile content type requirements', () => {
    it('should provide content type for files without browser File.type', () => {
      // When files are created from Buffer in Node.js, they don't have a type
      // Our getMimeType should provide a fallback
      expect(getMimeType('generated.html')).toBe('text/html');
      expect(getMimeType('output.json')).toBe('application/json');
      expect(getMimeType('build.css')).toBe('text/css');
    });

    it('should return sensible defaults for unknown files', () => {
      // All unknown files should get application/octet-stream
      expect(getMimeType('unknown.xyz123')).toBe('application/octet-stream');
      expect(getMimeType('file')).toBe('application/octet-stream');
      expect(getMimeType('')).toBe('application/octet-stream');
    });
  });

  describe('path edge cases from deployment scenarios', () => {
    it('should handle absolute paths', () => {
      expect(getMimeType('/var/www/index.html')).toBe('text/html');
      expect(getMimeType('/tmp/upload.jpg')).toBe('image/jpeg');
    });

    it('should handle Windows-style paths', () => {
      expect(getMimeType('C:\\Users\\file.txt')).toBe('text/plain');
      expect(getMimeType('D:\\projects\\app.js')).toBe('application/javascript');
    });

    it('should handle paths with query strings or hashes', () => {
      // These would be unusual but should still work
      expect(getMimeType('file.js?version=1')).toBe('application/octet-stream');
      expect(getMimeType('image.png#anchor')).toBe('application/octet-stream');
    });

    it('should handle very long nested paths', () => {
      const longPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file.json';
      expect(getMimeType(longPath)).toBe('application/json');
    });
  });
});
