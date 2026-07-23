import { CLIError } from './errors.js';
import { commandExists, run, type PackageManager } from './utils.js';

const INSTALL_ARGS: Record<PackageManager, string[]> = {
  npm: ['install'],
  pnpm: ['install'],
  yarn: ['install']
};

export async function installDependencies(targetDir: string, pm: PackageManager): Promise<void> {
  const hasPm = await commandExists(pm);
  if (!hasPm) {
    if (pm === 'npm') {
      throw new CLIError('NPM_MISSING', 'npm is not installed or not on your PATH.');
    }
    throw new CLIError('NPM_MISSING', `${pm} is not installed or not on your PATH.`);
  }

  const result = await run(pm, INSTALL_ARGS[pm], { cwd: targetDir, captureOutput: true });
  if (result.code !== 0) {
    if (/ENOSPC|no space left/i.test(result.stderr)) {
      throw new CLIError('DISK_FULL', 'Ran out of disk space while installing dependencies.', result.stderr);
    }
    if (/EACCES|permission denied/i.test(result.stderr)) {
      throw new CLIError('PERMISSION_DENIED', 'Permission denied while installing dependencies.', result.stderr);
    }
    if (/ENOTFOUND|network|ETIMEDOUT|ECONNRESET/i.test(result.stderr)) {
      throw new CLIError('NETWORK_FAILURE', 'Network error while installing dependencies.', result.stderr);
    }
    throw new CLIError('INSTALL_FAILED', 'Dependency installation failed.', result.stderr);
  }
}
