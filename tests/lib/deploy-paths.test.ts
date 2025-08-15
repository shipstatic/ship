import { describe, it, expect } from 'vitest';
import { optimizeDeployPaths } from '@/lib/deploy-paths';

describe('Deploy Path Optimization', () => {
  describe('Default behavior (flattening enabled)', () => {
    it('should create clean deployment paths from build outputs', () => {
      const filePaths = [
        'dist/index.html',
        'dist/vite.svg',
        'dist/assets/browser-SQEQcwkt.js',
        'dist/assets/index-BaplGdt4.js',
        'dist/assets/style-CuqkljXd.css'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'vite.svg', 
        'assets/browser-SQEQcwkt.js',
        'assets/index-BaplGdt4.js',
        'assets/style-CuqkljXd.css'
      ]);
    });

    it('should handle React build structure', () => {
      const filePaths = [
        'build/index.html',
        'build/static/css/main.abc123.css',
        'build/static/js/main.def456.js',
        'build/static/media/logo.789xyz.png'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'static/css/main.abc123.css',
        'static/js/main.def456.js',
        'static/media/logo.789xyz.png'
      ]);
    });

    it('should handle nested project structure', () => {
      const filePaths = [
        'project/src/components/Header.tsx',
        'project/src/components/Footer.tsx',
        'project/src/utils/helpers.ts',
        'project/public/favicon.ico'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'src/components/Header.tsx',
        'src/components/Footer.tsx',
        'src/utils/helpers.ts',
        'public/favicon.ico'
      ]);
    });

    it('should handle flat directory structure', () => {
      const filePaths = [
        'site/index.html',
        'site/style.css',
        'site/script.js'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'style.css',
        'script.js'
      ]);
    });

    it('should preserve structure when no common directory exists', () => {
      const filePaths = [
        'app/index.html',
        'docs/readme.md',
        'tests/unit.js'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'app/index.html',
        'docs/readme.md', 
        'tests/unit.js'
      ]);
    });

    it('should handle mixed depth files', () => {
      const filePaths = [
        'src/index.html',
        'src/deep/nested/component.tsx'
      ];

      const result = optimizeDeployPaths(filePaths);
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'index.html',
        'deep/nested/component.tsx'
      ]);
    });

    it('should extract correct filenames', () => {
      const filePaths = [
        'dist/assets/browser-SQEQcwkt.js',
        'dist/index.html'
      ];

      const result = optimizeDeployPaths(filePaths);

      expect(result[0].name).toBe('browser-SQEQcwkt.js');
      expect(result[1].name).toBe('index.html');
    });
  });

  describe('Flattening disabled', () => {
    it('should preserve original directory structure', () => {
      const filePaths = [
        'dist/index.html',
        'dist/assets/browser-SQEQcwkt.js',
        'dist/assets/style.css'
      ];

      const result = optimizeDeployPaths(filePaths, { flatten: false });
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'dist/index.html',
        'dist/assets/browser-SQEQcwkt.js', 
        'dist/assets/style.css'
      ]);
    });

    it('should normalize paths even when not flattening', () => {
      const filePaths = [
        '\\Windows\\path\\file.txt',
        '/unix/path/file.txt'
      ];

      const result = optimizeDeployPaths(filePaths, { flatten: false });
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual([
        'Windows/path/file.txt',
        'unix/path/file.txt'
      ]);
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
      const deployPaths = result.map(f => f.path);

      expect(deployPaths).toEqual(['LICENSE', 'README']);
    });

    it('should handle complex file extensions', () => {
      const filePaths = [
        'dist/app.config.js',
        'dist/package.json.backup'
      ];
      const result = optimizeDeployPaths(filePaths);
      
      expect(result[0].name).toBe('app.config.js');
      expect(result[1].name).toBe('package.json.backup');
    });
  });
});