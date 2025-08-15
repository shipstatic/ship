import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { optimizeDeployPaths } from '@/lib/deploy-paths';

describe('Path Handling Cross-Environment Integration', () => {
  describe('Core Algorithm Consistency', () => {
    it('should produce identical results for real-world scenarios', () => {
      // Test scenarios that represent actual user workflows
      const scenarios = [
        {
          name: 'Vite build output',
          paths: [
            'dist/index.html',
            'dist/vite.svg',
            'dist/assets/browser-SQEQcwkt.js',
            'dist/assets/index-BaplGdt4.js',
            'dist/assets/style-CuqkljXd.css'
          ],
          expectedOptimized: [
            'index.html',
            'vite.svg',
            'assets/browser-SQEQcwkt.js',
            'assets/index-BaplGdt4.js',
            'assets/style-CuqkljXd.css'
          ],
          expectedPreserved: [
            'dist/index.html',
            'dist/vite.svg',
            'dist/assets/browser-SQEQcwkt.js',
            'dist/assets/index-BaplGdt4.js',
            'dist/assets/style-CuqkljXd.css'
          ]
        },
        {
          name: 'Mixed directory structure (no common root)',
          paths: [
            'index.html',
            'assets/js/app.js',
            'assets/css/styles.css',
            'images/logo.png'
          ],
          expectedOptimized: [
            'index.html',
            'assets/js/app.js',
            'assets/css/styles.css',
            'images/logo.png'
          ],
          expectedPreserved: [
            'index.html',
            'assets/js/app.js',
            'assets/css/styles.css',
            'images/logo.png'
          ]
        },
        {
          name: 'React build structure',
          paths: [
            'build/index.html',
            'build/static/css/main.abc123.css',
            'build/static/js/main.def456.js',
            'build/manifest.json'
          ],
          expectedOptimized: [
            'index.html',
            'static/css/main.abc123.css',
            'static/js/main.def456.js',
            'manifest.json'
          ],
          expectedPreserved: [
            'build/index.html',
            'build/static/css/main.abc123.css',
            'build/static/js/main.def456.js',
            'build/manifest.json'
          ]
        }
      ];

      scenarios.forEach(scenario => {
        // Test with optimization enabled (default)
        const optimized = optimizeDeployPaths(scenario.paths, { flatten: true });
        const optimizedPaths = optimized.map(f => f.path);
        
        expect(optimizedPaths).toEqual(scenario.expectedOptimized);
        
        // Test with optimization disabled
        const preserved = optimizeDeployPaths(scenario.paths, { flatten: false });
        const preservedPaths = preserved.map(f => f.path);
        
        expect(preservedPaths).toEqual(scenario.expectedPreserved);
        
        // Verify filenames are correctly extracted
        optimized.forEach((file, index) => {
          const expectedName = scenario.paths[index].split('/').pop();
          expect(file.name).toBe(expectedName);
        });
      });
    });

    it('should handle the original regression scenario correctly', () => {
      // This is the exact scenario that was reported as broken
      const distFiles = [
        'dist/index.html',
        'dist/vite.svg',
        'dist/assets/browser-SQEQcwkt.js'
      ];

      const result = optimizeDeployPaths(distFiles, { flatten: true });
      const paths = result.map(f => f.path);

      // Should strip 'dist/' but preserve 'assets/' subdirectory
      expect(paths).toEqual([
        'index.html',
        'vite.svg', 
        'assets/browser-SQEQcwkt.js'
      ]);

      // Should NOT be completely flattened to root level
      expect(paths).not.toContain('browser-SQEQcwkt.js');
      
      // The assets folder should be preserved in the deployment URL
      expect(paths.find(p => p.includes('assets/'))).toBe('assets/browser-SQEQcwkt.js');
    });

    it('should demonstrate the elegance of the algorithm', () => {
      // Show how the algorithm gracefully handles various edge cases
      const testCases = [
        {
          input: ['file.txt'],
          expected: ['file.txt'],
          description: 'Single file - no optimization needed'
        },
        {
          input: ['dir/file1.txt', 'dir/file2.txt'],
          expected: ['file1.txt', 'file2.txt'],
          description: 'Flat directory - strips common parent'
        },
        {
          input: ['dir/sub1/file1.txt', 'dir/sub2/file2.txt'],
          expected: ['sub1/file1.txt', 'sub2/file2.txt'],
          description: 'Parallel subdirectories - preserves structure'
        },
        {
          input: ['app/index.html', 'docs/readme.md'],
          expected: ['app/index.html', 'docs/readme.md'],
          description: 'Different roots - no common parent'
        }
      ];

      testCases.forEach(testCase => {
        const result = optimizeDeployPaths(testCase.input, { flatten: true });
        const paths = result.map(f => f.path);
        
        expect(paths).toEqual(testCase.expected);
      });
    });

    it('should maintain consistency regardless of path separators', () => {
      // Test that the algorithm works with mixed path separators
      const mixedPaths = [
        'dist\\index.html',      // Windows-style
        'dist/vite.svg',         // Unix-style
        'dist\\assets/app.js'    // Mixed style
      ];

      const result = optimizeDeployPaths(mixedPaths, { flatten: true });
      const paths = result.map(f => f.path);

      // Should normalize all to forward slashes and optimize correctly
      expect(paths).toEqual([
        'index.html',
        'vite.svg',
        'assets/app.js'
      ]);

      // Should not contain any backslashes
      paths.forEach(path => {
        expect(path).not.toContain('\\');
      });
    });
  });
});