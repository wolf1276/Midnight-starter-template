import pc from 'picocolors';
import logSymbols from 'log-symbols';

export type ErrorCode =
  | 'PROJECT_EXISTS'
  | 'INVALID_NAME'
  | 'GIT_MISSING'
  | 'NPM_MISSING'
  | 'NETWORK_FAILURE'
  | 'INSTALL_FAILED'
  | 'SETUP_FAILED'
  | 'PERMISSION_DENIED'
  | 'DISK_FULL'
  | 'GIT_INIT_FAILED'
  | 'UNKNOWN';

const RECOVERY: Record<ErrorCode, string[]> = {
  PROJECT_EXISTS: [
    'Choose a different project name, or',
    'Remove/rename the existing directory and try again.'
  ],
  INVALID_NAME: [
    'Use lowercase letters, numbers, and dashes only (a valid npm package name).'
  ],
  GIT_MISSING: [
    'Install Git from https://git-scm.com/downloads, or',
    'Re-run with --skip-git to scaffold without a repository.'
  ],
  NPM_MISSING: [
    'Install Node.js (which bundles npm) from https://nodejs.org, or',
    'Re-run with --skip-install and install dependencies manually.'
  ],
  NETWORK_FAILURE: [
    'Check your internet connection and try again.',
    'If you are behind a proxy, ensure npm/git are configured to use it.'
  ],
  INSTALL_FAILED: [
    `Try running the install manually inside the project: ${pc.cyan('npm install')}`,
    'Delete node_modules and any lockfile conflicts, then retry.'
  ],
  SETUP_FAILED: [
    `Run setup manually inside the project: ${pc.cyan('npm run setup')}`,
    'Re-run with --verbose for the full setup log.'
  ],
  PERMISSION_DENIED: [
    'Check that you have write access to the target directory.',
    'Avoid running as a different user (e.g. sudo) than the one who owns the folder.'
  ],
  DISK_FULL: ['Free up disk space and try again.'],
  GIT_INIT_FAILED: [
    'The project was created successfully; Git initialization just did not complete.',
    `You can initialize it later with: ${pc.cyan('git init')}`
  ],
  UNKNOWN: ['Re-run with --verbose for more detail.']
};

export class CLIError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CLIError';
    this.code = code;
    this.cause = cause;
  }
}

export function printError(error: unknown, verbose: boolean): void {
  const isCliError = error instanceof CLIError;
  const code: ErrorCode = isCliError ? error.code : 'UNKNOWN';
  const message = error instanceof Error ? error.message : String(error);

  console.error('');
  console.error(`${logSymbols.error} ${pc.bold(pc.red('Something went wrong'))}`);
  console.error(`  ${message}`);

  const recovery = RECOVERY[code];
  if (recovery?.length) {
    console.error('');
    console.error(pc.bold('  What you can try:'));
    for (const line of recovery) {
      console.error(`  ${pc.dim('-')} ${line}`);
    }
  }

  if (verbose) {
    console.error('');
    console.error(pc.dim('  Verbose details:'));
    const cause = isCliError ? error.cause : undefined;
    console.error(pc.dim(String((cause as Error)?.stack ?? (error as Error)?.stack ?? error)));
  } else {
    console.error('');
    console.error(pc.dim('  Re-run with --verbose to see the full error output.'));
  }
  console.error('');
}
