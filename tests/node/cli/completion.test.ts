import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('CLI Completion', () => {
  const CLI_PATH = './dist/cli.cjs';

  it('should return bash completions', () => {
    const result = execSync(`node ${CLI_PATH} --compbash`, { 
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: undefined }
    });
    const completions = result.trim().split(' ');
    
    expect(completions).toContain('ping');
    expect(completions).toContain('whoami');
    expect(completions).toContain('deployments');
    expect(completions).toContain('domains');
    expect(completions).toContain('tokens');
    expect(completions).toContain('account');
    expect(completions).toContain('completion');
  });

  it('should return zsh completions', () => {
    const result = execSync(`node ${CLI_PATH} --compzsh`, {
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: undefined }
    });
    const completions = result.trim().split(' ');

    expect(completions).toContain('ping');
    expect(completions).toContain('whoami');
    expect(completions).toContain('deployments');
    expect(completions).toContain('domains');
    expect(completions).toContain('tokens');
    expect(completions).toContain('account');
    expect(completions).toContain('completion');
  });

  it('should return fish completions (newline separated)', () => {
    const result = execSync(`node ${CLI_PATH} --compfish`, {
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: undefined }
    });
    const completions = result.trim().split('\n');

    expect(completions).toContain('ping');
    expect(completions).toContain('whoami');
    expect(completions).toContain('deployments');
    expect(completions).toContain('domains');
    expect(completions).toContain('tokens');
    expect(completions).toContain('account');
    expect(completions).toContain('completion');
  });

  it('should exit with status 0 for completion requests', () => {
    expect(() => {
      execSync(`node ${CLI_PATH} --compbash`, { 
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: undefined }
      });
    }).not.toThrow();
  });
});