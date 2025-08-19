/**
 * @file CLI spinner behavior tests
 * Tests that spinners are properly disabled in appropriate contexts
 */

import { describe, it, expect, vi } from 'vitest';
import { runCli } from './helpers';

describe('CLI Spinner Behavior', () => {
  describe('Spinner Disabling Conditions', () => {
    it('should not show spinner in JSON mode', async () => {
      // Create a temporary directory for deploy test
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');
      
      const validKey = 'ship-' + 'a'.repeat(64);
      const result = await runCli([
        '--api-key', validKey, 
        '--json', 
        'deployments', 'create', tempDir
      ]);
      
      // Should fail due to auth but importantly, output should be JSON-only
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('"error"');
      expect(result.stderr).not.toContain('uploading');
      
      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });

    it('should not show spinner with --no-color flag', async () => {
      // Create a temporary directory for deploy test
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');
      
      const validKey = 'ship-' + 'a'.repeat(64);
      const result = await runCli([
        '--api-key', validKey, 
        '--no-color', 
        'deployments', 'create', tempDir
      ]);
      
      // Should fail due to auth, but no spinner should have been shown
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error');
      expect(result.stderr).not.toContain('uploading');
      
      // Cleanup  
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe('TTY Detection', () => {
    it('should respect TTY detection for spinner display', async () => {
      // When output is piped (non-TTY), no spinner should show
      // This is automatically handled by process.stdout.isTTY
      // The runCli helper simulates non-TTY environment
      
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-test-'));
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test content');
      
      const validKey = 'ship-' + 'a'.repeat(64);
      const result = await runCli([
        '--api-key', validKey,
        'deployments', 'create', tempDir
      ]);
      
      // Should fail due to auth, but no spinner artifacts should be present
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain('uploading');
      
      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });
});