import { describe, it, expect } from 'vitest';
import { runCli } from './helpers';

describe('Commander.js Error Handling', () => {
  it('should format unknown command errors consistently', async () => {
    const result = await runCli(['invalidcommand']);
    
    expect(result.exitCode).not.toBe(0);
    // Should contain our error formatting (strip ANSI for easier testing)
    const cleanError = result.stderr.replace(/\u001b\[[0-9;]*m/g, '');
    expect(cleanError).toMatch(/^\[error\] unknown command 'invalidcommand'/);
    // Should not have trailing period
    expect(cleanError).not.toMatch(/\.$/);
    // Should be lowercase
    expect(cleanError).toMatch(/unknown command/);
  });

  it('should format unknown option errors consistently', async () => {
    const result = await runCli(['deployments', '--invalid-flag']);
    
    expect(result.exitCode).not.toBe(0);
    // Should contain our error formatting (strip ANSI for easier testing)
    const cleanError = result.stderr.replace(/\u001b\[[0-9;]*m/g, '');
    expect(cleanError).toMatch(/^\[error\] unknown option '--invalid-flag'/);
    // Should not have trailing period
    expect(cleanError).not.toMatch(/\.$/);
    // Should be lowercase
    expect(cleanError).toMatch(/unknown option/);
  });

  it('should format missing argument errors consistently', async () => {
    const result = await runCli(['deployments', 'create']);
    
    expect(result.exitCode).not.toBe(0);
    // Should contain our error formatting (strip ANSI for easier testing)
    const cleanError = result.stderr.replace(/\u001b\[[0-9;]*m/g, '');
    expect(cleanError).toMatch(/^\[error\] missing required argument 'path'/);
    // Should not have trailing period
    expect(cleanError).not.toMatch(/\.$/);
    // Should be lowercase
    expect(cleanError).toMatch(/missing required argument/);
  });

  it('should format errors as JSON when --json flag is used', async () => {
    const result = await runCli(['--json', 'invalidcommand']);
    
    expect(result.exitCode).not.toBe(0);
    // Parse as JSON
    const parsed = JSON.parse(result.stderr);
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toBe("unknown command 'invalidcommand'");
    // Should be lowercase and no trailing period
    expect(parsed.error).toMatch(/^[a-z]/);
    expect(parsed.error).not.toMatch(/\.$/);
  });

  it('should format errors without color when --no-color flag is used', async () => {
    const result = await runCli(['--no-color', 'invalidcommand']);
    
    expect(result.exitCode).not.toBe(0);
    // Should not contain ANSI escape sequences
    expect(result.stderr).not.toMatch(/\x1b\[/);
    // Should still have error prefix and message
    expect(result.stderr).toMatch(/^\[error\] unknown command 'invalidcommand'/);
    // Should be lowercase and no trailing period
    expect(result.stderr).toMatch(/^\[error\] [a-z]/);
    expect(result.stderr).not.toMatch(/\.$/);
  });
});