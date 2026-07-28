/**
 * @file The child-process smoke tier — the ONLY file that spawns the real
 * built binary (`dist/cli.cjs`), and one of the integrity fence's two
 * recorded artifact-tier exceptions.
 *
 * Everything behavioural lives in the in-process tier (`index.test.ts` and
 * siblings), where V8 can see it. This file proves what only a real binary can:
 * the packaged entry parses argv and exits with the right codes, stdout
 * survives the pipe intact (the tree never calls `process.exit`, so nothing
 * can truncate it), stdin piping works, colour responds to the launch
 * environment, and the completion fast-path answers before Commander loads.
 */

import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './helpers';

const DEMO_SITE = path.resolve(__dirname, '../../fixtures/demo-site');

const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(ANSI, '');

/**
 * The FRONT PAGE, byte for byte — what `ship`, `ship --help`/`-h`, and
 * `ship help` render (`helpText()` in `src/node/cli/index.ts`, the kept
 * design). Subcommand help is the other scope: Commander-native, knowing
 * each command's exact usage and options.
 */
const HELP = `USAGE
  ship <path>               Deploy static sites with simplicity

COMMANDS
  Deployments
  ship deployments list                 List deployments
  ship deployments upload <path>        Upload deployment from file or directory
  ship deployments get <deployment>     Show deployment information
  ship deployments set <deployment>     Set deployment labels
  ship deployments remove <deployment>  Delete deployment permanently

  Domains
  ship domains list                     List domains
  ship domains set <name> [deployment]  Create domain, link to deployment, or update labels
  ship domains get <name>               Show domain information
  ship domains validate <name>          Check if domain name is valid and available
  ship domains records <name>           Show required DNS records for domain setup
  ship domains dns <name>               Look up DNS provider for a domain
  ship domains share <name>             Get shareable DNS setup link
  ship domains verify <name>            Trigger DNS verification for external domain
  ship domains remove <name>            Delete domain permanently

  Tokens
  ship tokens list                      List deploy tokens
  ship tokens create                    Create a new deploy token
  ship tokens remove <token>            Delete token permanently

  Setup
  ship config                           Save your token
  ship whoami                           Get current account information

  Completion
  ship completion install               Install shell completion script
  ship completion uninstall             Uninstall shell completion script

FLAGS
  --token <token>           Any ship token: API key (ship-…) or deploy token (deploy-…)
  --config <file>           Custom config file path
  --label <label>           Set label (repeatable, replaces all existing)
  --password <password>     Password-protect this deployment
  --no-path-detect          Disable automatic path optimization and flattening
  --no-spa-detect           Disable automatic SPA detection and configuration
  --no-color                Disable colored output
  --json                    Output results in JSON format
  -q, --quiet               Output only the resource identifier
  -V, --version             Show version information

EXAMPLES
  ship ./dist
  ship domains set www.example.com happy-cat-abc1234.shipstatic.com
  ship ./dist -q | ship domains set www.example.com

Please report any issues to https://github.com/shipstatic/ship/issues

`;

describe('true-binary smoke', () => {
  describe('help and version', () => {
    it('prints the help, byte for byte, with no arguments', async () => {
      const result = await runCli([]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(HELP);
    });

    it('prints the same front page for --help, -h, and the help command', async () => {
      for (const args of [['--help'], ['-h'], ['help']]) {
        const result = await runCli(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(HELP);
      }
    });

    it('subcommand help is native and scoped, not the front page', async () => {
      for (const args of [
        ['domains', '--help'],
        ['help', 'domains'],
      ]) {
        const result = await runCli(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toMatch(/^Usage: ship domains/);
        expect(result.stdout).toContain('validate');
        expect(result.stdout).not.toContain('Please report any issues');
      }
    });

    it('prints scoped help rather than a parse error when --help follows a missing argument', async () => {
      const result = await runCli(['deployments', 'upload', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^Usage: ship deployments upload/);
      expect(result.stdout).toContain('--no-spa-detect');
      expect(result.stderr).toBe('');
    });

    it('prints the version for --version and -V', async () => {
      for (const args of [['--version'], ['-V']]) {
        const result = await runCli(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
      }
    });
  });

  describe('deploy round-trip', () => {
    it('deploys through the real binary and the piped stdout is complete JSON', async () => {
      const result = await runCli(['--json', DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      // JSON.parse is the truncation check: the tree ends without
      // `process.exit`, so a pipe reader always receives the full document.
      const output = JSON.parse(result.stdout.trim());
      expect(output.deployment).toMatch(/^mock-deploy-\d{3}\.shipstatic\.com$/);
      expect(output.via).toBe('cli');
    });

    it('quiet deploy prints exactly the hostname — the composable value', async () => {
      const result = await runCli(['-q', DEMO_SITE]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^mock-deploy-\d{3}\.shipstatic\.com$/);
    });

    it('domains set reads the deployment from piped stdin', async () => {
      const result = await runCli(['-q', 'domains', 'set', 'www.stdin-pipe.com'], {
        stdin: ['brave-otter-a1b2c3d.shipstatic.com'],
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('www.stdin-pipe.com');
    });
  });

  describe('exit codes and error stream', () => {
    it('unknown command exits 1 with the [error] line on stderr', async () => {
      const result = await runCli(['definitely-not-a-command']);
      expect(result.exitCode).toBe(1);
      expect(plain(result.stderr)).toBe("[error] unknown command 'definitely-not-a-command'\n\n");
    });

    it('--json errors are machine-readable on stderr', async () => {
      const result = await runCli(['--json', 'definitely-not-a-command']);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        error: "unknown command 'definitely-not-a-command'",
      });
    });
  });

  describe('colour responds to the launch environment', () => {
    // The suite's base environment sets NO_COLOR, so a plain run has no ANSI
    // to suppress and `--no-color` would pass vacuously. These two force
    // colour on so the pair proves the flag does something: colour appears
    // without it, and not with it. Launch-environment behaviour — only a
    // spawned binary genuinely has one, which is why this pair is smoke-tier.
    const coloured = { NO_COLOR: undefined as unknown as string, FORCE_COLOR: '1' };

    it('emits ANSI when the terminal asks for colour', async () => {
      const result = await runCli(['invalidcommand'], { env: coloured });
      expect(result.stderr).toMatch(ANSI);
      expect(plain(result.stderr)).toBe("[error] unknown command 'invalidcommand'\n\n");
    });

    it('--no-color emits no ANSI even then', async () => {
      const result = await runCli(['--no-color', 'invalidcommand'], { env: coloured });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).not.toMatch(ANSI);
      expect(result.stderr).toBe("[error] unknown command 'invalidcommand'\n\n");
    });
  });

  describe('shell completion fast-path', () => {
    // `--comp*` answers before Commander is even constructed (bin fast-path
    // in `src/node/cli/index.ts`) — reachable only through the real binary.
    it('lists command words for bash and zsh, space-separated', async () => {
      for (const flag of ['--compbash', '--compzsh']) {
        const result = await runCli([flag]);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(
          'ping whoami deployments domains tokens account config completion',
        );
      }
    });

    it('lists command words for fish, newline-separated', async () => {
      const result = await runCli(['--compfish']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'ping',
        'whoami',
        'deployments',
        'domains',
        'tokens',
        'account',
        'config',
        'completion',
      ]);
    });
  });
});
