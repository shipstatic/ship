/**
 * Shell completion install/uninstall logic.
 * Handles bash, zsh, and fish shells.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { success, error, info, warn } from './utils.js';

export interface CompletionOptions {
  isJson?: boolean;
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
        scriptName: 'ship.bash'
      };
    case 'zsh':
      return {
        completionFile: path.join(homeDir, '.ship_completion.zsh'),
        profileFile: path.join(homeDir, '.zshrc'),
        scriptName: 'ship.zsh'
      };
    case 'fish':
      return {
        completionFile: path.join(homeDir, '.config/fish/completions/ship.fish'),
        profileFile: null, // fish doesn't need profile sourcing
        scriptName: 'ship.fish'
      };
  }
}

/**
 * Install shell completion script
 */
export function installCompletion(scriptDir: string, options: CompletionOptions = {}): void {
  const { isJson, noColor } = options;
  const shell = detectShell();
  const homeDir = os.homedir();

  if (!shell) {
    error(`unsupported shell: ${process.env.SHELL}. supported: bash, zsh, fish`, isJson, noColor);
    return;
  }

  const paths = getShellPaths(shell, homeDir);
  const sourceScript = path.join(scriptDir, paths.scriptName);

  try {
    // Fish has a different installation pattern
    if (shell === 'fish') {
      const fishDir = path.dirname(paths.completionFile);
      if (!fs.existsSync(fishDir)) {
        fs.mkdirSync(fishDir, { recursive: true });
      }
      fs.copyFileSync(sourceScript, paths.completionFile);
      success('fish completion installed successfully', isJson, noColor);
      info('please restart your shell to apply the changes', isJson, noColor);
      return;
    }

    // Bash and zsh: copy script and add sourcing to profile
    fs.copyFileSync(sourceScript, paths.completionFile);
    const sourceLine = `# ship\nsource '${paths.completionFile}'\n# ship end`;

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

      success(`completion script installed for ${shell}`, isJson, noColor);
      warn(`run "source ${paths.profileFile}" or restart your shell`, isJson, noColor);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    error(`could not install completion script: ${message}`, isJson, noColor);
  }
}

/**
 * Uninstall shell completion script
 */
export function uninstallCompletion(options: CompletionOptions = {}): void {
  const { isJson, noColor } = options;
  const shell = detectShell();
  const homeDir = os.homedir();

  if (!shell) {
    error(`unsupported shell: ${process.env.SHELL}. supported: bash, zsh, fish`, isJson, noColor);
    return;
  }

  const paths = getShellPaths(shell, homeDir);

  try {
    // Fish: just remove the file
    if (shell === 'fish') {
      if (fs.existsSync(paths.completionFile)) {
        fs.unlinkSync(paths.completionFile);
        success('fish completion uninstalled successfully', isJson, noColor);
      } else {
        warn('fish completion was not installed', isJson, noColor);
      }
      info('please restart your shell to apply the changes', isJson, noColor);
      return;
    }

    // Bash and zsh: remove file and clean profile
    if (fs.existsSync(paths.completionFile)) {
      fs.unlinkSync(paths.completionFile);
    }

    if (!paths.profileFile) return;

    if (!fs.existsSync(paths.profileFile)) {
      error('profile file not found', isJson, noColor);
      return;
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
      const endsWithNewline = content.endsWith('\n');
      const newContent = filtered.length === 0
        ? ''
        : filtered.join('\n') + (endsWithNewline ? '\n' : '');
      fs.writeFileSync(paths.profileFile, newContent);
      success(`completion script uninstalled for ${shell}`, isJson, noColor);
      warn(`run "source ${paths.profileFile}" or restart your shell`, isJson, noColor);
    } else {
      error('completion was not found in profile', isJson, noColor);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    error(`could not uninstall completion script: ${message}`, isJson, noColor);
  }
}
