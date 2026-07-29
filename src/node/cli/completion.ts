/**
 * Shell completion install/uninstall logic.
 * Handles bash, zsh, and fish shells.
 *
 * **Failures throw; the caller's error boundary reports them.** These commands
 * make no request, so they cannot use `withErrorHandling` — that builds a
 * `Ship`, which resolves credentials — and they take the same shape `config`
 * does instead: the action wraps the call and hands anything thrown to
 * `handleError`. That is what puts a completion failure on the same footing as
 * every other one: one writer, one exit code. Reporting inline (as this module
 * did until 2026-07-29) printed `[error] …` and then exited **0**, so
 * `ship completion install && …` proceeded after a failure.
 *
 * **Two error types, because no request means no status.** The client-only
 * types (`Network`, `Cancelled`, `File`, `Config`) are exactly the statusless
 * ones in `@shipstatic/types` — a status is an HTTP fact, and nothing here
 * speaks HTTP. So the rule is: an fs call that threw is `File`; everything else
 * is a statement about the user's shell setup, which is `Config`. `Validation`
 * and `Business` are deliberately absent — both stamp a 400 on a failure that
 * never made a request, which is a plausible lie rather than an obvious one.
 * Neither command takes an argument, so there is no input here to validate.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isShipError, ShipError } from '@shipstatic/types';
import type { Command } from 'commander';
import { renderCompletion } from './completions.js';
import { info, success, warn } from './utils.js';

export interface CompletionOptions {
  json?: boolean;
  noColor?: boolean;
}

/**
 * Detect current shell from environment
 */
function detectShell(): 'bash' | 'zsh' | 'fish' | null {
  const shell = process.env.SHELL || '';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  return null;
}

/**
 * Get shell-specific paths
 */
function getShellPaths(shell: 'bash' | 'zsh' | 'fish', homeDir: string) {
  switch (shell) {
    case 'bash':
      return {
        completionFile: path.join(homeDir, '.ship_completion.bash'),
        profileFile: path.join(homeDir, '.bash_profile'),
      };
    case 'zsh':
      return {
        completionFile: path.join(homeDir, '.ship_completion.zsh'),
        profileFile: path.join(homeDir, '.zshrc'),
      };
    case 'fish':
      return {
        completionFile: path.join(homeDir, '.config/fish/completions/ship.fish'),
        profileFile: null, // fish doesn't need profile sourcing
      };
  }
}

/**
 * Install shell completion script
 */
export function installCompletion(program: Command, options: CompletionOptions = {}): void {
  const { json, noColor } = options;
  const shell = detectShell();
  const homeDir = os.homedir();

  if (!shell) {
    throw ShipError.config(`unsupported shell: ${process.env.SHELL}. supported: bash, zsh, fish`);
  }

  const paths = getShellPaths(shell, homeDir);
  // Rendered from the tree at THIS moment, so what lands on disk always matches
  // the binary that wrote it — see `./completions.ts`.
  const script = renderCompletion(program, shell);

  try {
    // Fish has a different installation pattern
    if (shell === 'fish') {
      const fishDir = path.dirname(paths.completionFile);
      if (!fs.existsSync(fishDir)) {
        fs.mkdirSync(fishDir, { recursive: true });
      }
      fs.writeFileSync(paths.completionFile, script);
      success('fish completion installed successfully', json, noColor);
      info('please restart your shell to apply the changes', json, noColor);
      return;
    }

    // Bash and zsh: copy script and add sourcing to profile.
    // The block is newline-TERMINATED so uninstall can restore the profile
    // byte-for-byte: without it, an appended block swallowed the file's
    // original trailing newline and the round trip was lossy.
    fs.writeFileSync(paths.completionFile, script);
    const sourceLine = `# ship\nsource '${paths.completionFile}'\n# ship end\n`;

    if (paths.profileFile) {
      if (fs.existsSync(paths.profileFile)) {
        const content = fs.readFileSync(paths.profileFile, 'utf-8');
        if (!content.includes('# ship') || !content.includes('# ship end')) {
          const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
          fs.appendFileSync(paths.profileFile, prefix + sourceLine);
        }
      } else {
        fs.writeFileSync(paths.profileFile, sourceLine);
      }

      success(`completion script installed for ${shell}`, json, noColor);
      warn(`run "source ${paths.profileFile}" or restart your shell`, json, noColor);
    }
  } catch (e) {
    if (isShipError(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw ShipError.file(`could not install completion script: ${message}`);
  }
}

/**
 * Uninstall shell completion script
 */
export function uninstallCompletion(options: CompletionOptions = {}): void {
  const { json, noColor } = options;
  const shell = detectShell();
  const homeDir = os.homedir();

  if (!shell) {
    throw ShipError.config(`unsupported shell: ${process.env.SHELL}. supported: bash, zsh, fish`);
  }

  const paths = getShellPaths(shell, homeDir);

  try {
    // Fish: just remove the file
    if (shell === 'fish') {
      if (fs.existsSync(paths.completionFile)) {
        fs.unlinkSync(paths.completionFile);
        success('fish completion uninstalled successfully', json, noColor);
      } else {
        warn('fish completion was not installed', json, noColor);
      }
      info('please restart your shell to apply the changes', json, noColor);
      return;
    }

    // Bash and zsh: remove file and clean profile
    if (fs.existsSync(paths.completionFile)) {
      fs.unlinkSync(paths.completionFile);
    }

    if (!paths.profileFile) return;

    if (!fs.existsSync(paths.profileFile)) {
      throw ShipError.config('profile file not found');
    }

    const content = fs.readFileSync(paths.profileFile, 'utf-8');
    const lines = content.split('\n');

    // Remove ship block (between "# ship" and "# ship end")
    const filtered: string[] = [];
    let i = 0;
    let removed = false;

    while (i < lines.length) {
      if (lines[i].trim() === '# ship') {
        removed = true;
        i++;
        while (i < lines.length && lines[i].trim() !== '# ship end') i++;
        if (i < lines.length) i++; // skip "# ship end"
      } else {
        filtered.push(lines[i]);
        i++;
      }
    }

    if (removed) {
      // `split('\n')` / `join('\n')` round-trips newlines exactly — a trailing
      // newline survives as a final empty element. Re-appending one here (as an
      // earlier revision did) double-counts it and leaves a stray blank line.
      fs.writeFileSync(paths.profileFile, filtered.join('\n'));
      success(`completion script uninstalled for ${shell}`, json, noColor);
      warn(`run "source ${paths.profileFile}" or restart your shell`, json, noColor);
    } else {
      throw ShipError.config('completion was not found in profile');
    }
  } catch (e) {
    if (isShipError(e)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw ShipError.file(`could not uninstall completion script: ${message}`);
  }
}
