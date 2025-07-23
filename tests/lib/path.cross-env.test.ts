import { describe, it, expect } from 'vitest';
import { findCommonParentDirectory } from '../../src/lib/path';

/**
 * This test file specifically validates that the stripCommonPrefix logic works identically
 * in both browser and Node.js environments by testing the findCommonParentDirectory function
 * with different path formats and separator characters.
 */
describe('Path utilities - Cross-environment consistency', () => {
  describe('findCommonParentDirectory', () => {
    // Test consistent behavior with browser paths (forward slash)
    describe('browser environment (forward slash separator)', () => {
      const separator = '/';
      
      it('should return empty string for empty or invalid inputs', () => {
        expect(findCommonParentDirectory([], separator)).toBe('');
        expect(findCommonParentDirectory([''], separator)).toBe('');
        expect(findCommonParentDirectory([null as any], separator)).toBe('');
        expect(findCommonParentDirectory([undefined as any], separator)).toBe('');
      });
      
      it('should handle single directory input by returning the full path', () => {
        expect(findCommonParentDirectory(['/app/public'], separator)).toBe('app/public');
      });
      
      it('should find common parent for multiple files in same directory', () => {
        const paths = [
          '/app/public/index.html',
          '/app/public/styles.css',
          '/app/public/script.js'
        ];
        expect(findCommonParentDirectory(paths, separator)).toBe('app/public');
      });
      
      it('should find common parent for nested directories', () => {
        const paths = [
          '/app/public/css/styles.css',
          '/app/public/js/script.js',
          '/app/public/images/logo.png'
        ];
        expect(findCommonParentDirectory(paths, separator)).toBe('app/public');
      });
      
      it('should find longest common prefix even for complex nested paths', () => {
        const paths = [
          '/app/public/css/vendor/bootstrap.css',
          '/app/public/css/styles.css',
          '/app/public/css/themes/dark.css'
        ];
        expect(findCommonParentDirectory(paths, separator)).toBe('app/public/css');
      });
      
      it('should handle paths with no common parent', () => {
        const paths = [
          '/app/public/index.html',
          '/var/log/app.log'
        ];
        expect(findCommonParentDirectory(paths, separator)).toBe('');
      });
    });
    
    // Test consistent behavior with Node.js paths (OS-specific separator)
    describe('Node.js environment (OS-specific separator)', () => {
      const separator = '\\'; // Windows-style for testing
      
      it('should return empty string for empty or invalid inputs', () => {
        expect(findCommonParentDirectory([], separator)).toBe('');
        expect(findCommonParentDirectory([''], separator)).toBe('');
        expect(findCommonParentDirectory([null as any], separator)).toBe('');
        expect(findCommonParentDirectory([undefined as any], separator)).toBe('');
      });
      
      it('should handle single directory input by returning the full path', () => {
        // With normalization, Windows paths will be converted to forward slashes without leading slash
        expect(findCommonParentDirectory(['C:\\app\\public'], separator)).toBe('C:/app/public');
      });
      
      it('should find common parent for multiple files in same directory', () => {
        const paths = [
          'C:\\app\\public\\index.html',
          'C:\\app\\public\\styles.css',
          'C:\\app\\public\\script.js'
        ];
        // Windows paths will be normalized to forward slashes
        expect(findCommonParentDirectory(paths, separator)).toBe('C:/app/public');
      });
      
      it('should find common parent for nested directories', () => {
        const paths = [
          'C:\\app\\public\\css\\styles.css',
          'C:\\app\\public\\js\\script.js',
          'C:\\app\\public\\images\\logo.png'
        ];
        // Windows paths will be normalized to forward slashes
        expect(findCommonParentDirectory(paths, separator)).toBe('C:/app/public');
      });
      
      it('should find longest common prefix even for complex nested paths', () => {
        const paths = [
          'C:\\app\\public\\css\\vendor\\bootstrap.css',
          'C:\\app\\public\\css\\styles.css',
          'C:\\app\\public\\css\\themes\\dark.css'
        ];
        // Windows paths will be normalized to forward slashes
        expect(findCommonParentDirectory(paths, separator)).toBe('C:/app/public/css');
      });
      
      it('should handle paths with no common parent', () => {
        const paths = [
          'C:\\app\\public\\index.html',
          'D:\\logs\\app.log'
        ];
        expect(findCommonParentDirectory(paths, separator)).toBe('');
      });
    });
    
    // Real-world test cases that verify the bug is fixed
    describe('regression tests for reported bugs', () => {
      it('should correctly strip top-level directory for single directory deploy with Node.js paths', () => {
        const paths = [
          '/Users/constantin/Downloads/netlify-drop-demo-site-master/index.html',
          '/Users/constantin/Downloads/netlify-drop-demo-site-master/styles.css',
          '/Users/constantin/Downloads/netlify-drop-demo-site-master/images/logo.png'
        ];
        
        const commonParent = findCommonParentDirectory(paths, '/');
        expect(commonParent).toBe('Users/constantin/Downloads/netlify-drop-demo-site-master');
        
        // Verify stripping works by simulating path relativity
        // The length of the common parent + 1 for the trailing separator that was removed during normalization
        const strippedPaths = paths.map(p => {
          // First normalize the path to match our function's behavior
          const normalizedPath = p.replace(/^\/+/, '');
          return normalizedPath.substring(commonParent.length + (normalizedPath.charAt(commonParent.length) === '/' ? 1 : 0));
        });
        
        expect(strippedPaths).toEqual([
          'index.html',
          'styles.css',
          'images/logo.png'
        ]);
      });
      
      it('should correctly strip top-level directory for single directory deploy with browser paths', () => {
        const paths = [
          'netlify-drop-demo-site-master/index.html',
          'netlify-drop-demo-site-master/styles.css',
          'netlify-drop-demo-site-master/images/logo.png'
        ];
        
        const commonParent = findCommonParentDirectory(paths, '/');
        expect(commonParent).toBe('netlify-drop-demo-site-master');
        
        // Verify stripping works by simulating path relativity
        const strippedPaths = paths.map(p => {
          // Since the common parent doesn't have a leading slash, we can just strip it directly
          return p.substring(commonParent.length + (p.charAt(commonParent.length) === '/' ? 1 : 0));
        });
        
        expect(strippedPaths).toEqual([
          'index.html',
          'styles.css',
          'images/logo.png'
        ]);
      });
    });
  });
});
