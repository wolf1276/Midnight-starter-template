import { CLIError } from './errors.js';
import { commandExists, run } from './utils.js';

/**
 * Runs `git init` only, ahead of the project's own setup script — some templates'
 * setup installs Git hooks (e.g. pre-commit) and needs a `.git` dir to target.
 */
export async function initGitDir(targetDir: string): Promise<void> {
  const hasGit = await commandExists('git');
  if (!hasGit) {
    throw new CLIError('GIT_MISSING', 'Git is not installed or not on your PATH.');
  }

  const init = await run('git', ['init'], { cwd: targetDir, captureOutput: true });
  if (init.code !== 0) {
    throw new CLIError('GIT_INIT_FAILED', 'Failed to initialize a Git repository.', init.stderr);
  }
}

export async function commitInitial(targetDir: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: targetDir, captureOutput: true });

  const commit = await run(
    'git',
    ['commit', '-m', 'Initial commit from create-midnight', '--no-verify'],
    { cwd: targetDir, captureOutput: true }
  );
  if (commit.code !== 0) {
    // A missing git identity (user.name/user.email) is common on fresh machines; not fatal.
    throw new CLIError(
      'GIT_INIT_FAILED',
      'Git repository initialized, but the initial commit could not be created (likely missing git user.name/user.email).',
      commit.stderr
    );
  }
}
