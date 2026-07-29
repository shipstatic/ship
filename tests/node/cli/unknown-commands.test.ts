/**
 * @file The CLI's error surface for input it cannot act on: unknown commands,
 * unknown options, missing arguments — and the format law every one of those
 * messages obeys.
 *
 * Feature axis, not mirror: the behaviour is a collaboration between
 * Commander's parser, `handleUnknownSubcommand`, and the `[error]` writer in
 * `utils.ts`, so it has no single subject module. Recorded as an exception in
 * the naming fence.
 *
 * IN-PROCESS via `buildProgram()`. The colour on/off pair lives in the smoke
 * tier: colour support is decided by the terminal environment at process
 * launch, which only a spawned binary genuinely has.
 *
 * The exact-output assertions below were snapshots until 2026-07-27. Snapshots
 * hid two things: that several of them held byte-identical text, and that they
 * were only ever as correct as the last `-u`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorType } from '@shipstatic/types';
import { describe, expect, it } from 'vitest';
import { runProgram } from './harness';

const ANSI = /\u001b\[[0-9;]*m/g;

/** Strips ANSI so an assertion reads the way the user's eye sees it. */
const plain = (s: string) => s.replace(ANSI, '');

describe('unknown commands', () => {
  describe('top level', () => {
    it('names the command and prints the full help', async () => {
      const result = await runProgram(['badcommand']);

      expect(result.exitCode).toBe(1);
      expect(plain(result.stderr)).toBe("[error] unknown command 'badcommand'\n\n");
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('COMMANDS');
      expect(result.stdout).toContain('FLAGS');
    });

    it('names only the first token when several unknown args follow', async () => {
      const result = await runProgram(['xyz', 'arg1', 'arg2']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'xyz'");
      expect(result.stdout).toContain('USAGE');
    });

    it('treats a path-shaped argument as a path, not a command', async () => {
      const result = await runProgram(['./nonexistent/path']);

      expect(result.exitCode).toBe(1);
      expect(plain(result.stderr)).toBe('[error] ./nonexistent/path path does not exist\n\n');
    });

    it('treats a bare word as a command, not a path', async () => {
      const result = await runProgram(['notapath']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'notapath'");
      expect(result.stdout).toContain('USAGE');
    });

    it('reports a flag-shaped argument as an unknown option', async () => {
      const result = await runProgram(['--badcommand']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
      expect(result.stdout).toContain('USAGE');
    });

    it('unknown command wins over a broken config file', async () => {
      // The check runs BEFORE any client (and thus any config file) is
      // resolved. It used to live inside the client-creating wrapper, so a
      // machine with a legacy `.shiprc` answered every mistyped command with
      // a config error instead of naming the command.
      const dir = mkdtempSync(join(tmpdir(), 'ship-badcfg-'));
      const badConfig = join(dir, 'shiprc.json');
      writeFileSync(badConfig, '{"apiKey": "legacy-key-shape"}\n');
      try {
        const result = await runProgram(['frobnicate', '--config', badConfig]);
        expect(result.exitCode).toBe(1);
        expect(plain(result.stderr)).toBe("[error] unknown command 'frobnicate'\n\n");
        expect(result.stdout).toContain('USAGE');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('subcommand level', () => {
    // Scoped usage, not the full help: the user already picked the group.
    const groups: Array<[string, string[]]> = [
      ['deployments', ['list', 'upload', 'get', 'set', 'remove']],
      [
        'domains',
        ['list', 'get', 'set', 'validate', 'records', 'dns', 'share', 'verify', 'remove'],
      ],
      ['account', ['get']],
      ['completion', ['install', 'uninstall']],
    ];

    it.each(groups)('shows scoped usage for an unknown %s subcommand', async (group, expected) => {
      const result = await runProgram([group, 'bad']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'bad'");
      expect(result.stdout).toContain(`usage: ship ${group}`);
      for (const sub of expected) expect(result.stdout).toContain(sub);
    });

    it('names only the first unknown subcommand token', async () => {
      const result = await runProgram(['deployments', 'bad1', 'bad2']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command 'bad1'");
      expect(result.stdout).toContain('usage: ship deployments');
    });

    it('shows scoped usage for a bare group — and calls it no error', async () => {
      const result = await runProgram(['deployments']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('usage: ship deployments');
      expect(result.stderr).not.toContain('unknown command');
    });
  });
});

describe('CLI error format law', () => {
  // Each of these is a property of the `[error]` writer in utils.ts, so one
  // violation anywhere is a violation everywhere.
  const cases: Array<[string, string[], string]> = [
    ['unknown command', ['invalidcommand'], "unknown command 'invalidcommand'"],
    ['unknown option', ['deployments', '--invalid-flag'], "unknown option '--invalid-flag'"],
    ['missing argument', ['deployments', 'upload'], "missing required argument 'path'"],
  ];

  it.each(cases)(
    '%s: anchored [error] prefix, lowercase, no trailing period',
    async (_name, args, message) => {
      const result = await runProgram(args);
      const stderr = plain(result.stderr);

      expect(result.exitCode).not.toBe(0);
      expect(stderr).toBe(`[error] ${message}\n\n`);
      // Restated as properties, so a future rewording still has to satisfy the
      // law rather than only the literal above.
      expect(stderr).toMatch(/^\[error] [a-z]/);
      expect(stderr.trimEnd()).not.toMatch(/\.$/);
    },
  );

  it('--json emits the wire ErrorResponse and suppresses the help', async () => {
    const result = await runProgram(['--json', 'invalidcommand']);

    expect(result.exitCode).not.toBe(0);
    // No status: `ErrorResponse.status` is an HTTP fact "(API contexts)", and
    // no API ever sees `ship invalidcommand`.
    expect(JSON.parse(result.stderr)).toEqual({
      error: ErrorType.Validation,
      message: "unknown command 'invalidcommand'",
    });
    expect(result.stdout).not.toContain('USAGE');
  });

  it('--json suppresses scoped usage too', async () => {
    const result = await runProgram(['deployments', 'bad', '--json']);

    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stderr);
    expect(parsed.error).toBe(ErrorType.Validation);
    expect(parsed.message).toBe("unknown command 'bad'");
    expect(result.stdout).not.toContain('usage:');
  });
});
