import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import validateNpmName from 'validate-npm-package-name';
import { CLIError } from './errors.js';
import { verbose } from './logger.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  command: string,
  args: string[],
  options: { cwd?: string; captureOutput?: boolean } = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    verbose(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    if (options.captureOutput) {
      child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await run(probe, [command], { captureOutput: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export const PACKAGE_MANAGER_LABELS: Record<PackageManager, string> = {
  bun: 'Bun',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  npm: 'npm'
};

// Preference order when nothing is forced via --use-*: the fastest available
// runtime wins. npm ships with Node, so it's the guaranteed fallback.
const DETECTION_PRIORITY: PackageManager[] = ['bun', 'pnpm', 'yarn', 'npm'];

/**
 * Detects the best available package manager by probing for the executable on
 * PATH (not lockfiles — the project doesn't exist yet). `checkCommand` is
 * injectable for tests.
 */
export async function detectPackageManager(
  override?: PackageManager,
  checkCommand: (command: string) => Promise<boolean> = commandExists
): Promise<PackageManager> {
  if (override) return override;

  for (const pm of DETECTION_PRIORITY) {
    if (pm === 'npm') return 'npm';
    if (await checkCommand(pm)) return pm;
  }
  return 'npm';
}

/** The generated project's package.json scripts, or {} if unreadable. */
export function readPackageScripts(targetDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(path.join(targetDir, 'package.json'), 'utf8'));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export interface ProjectNameValidation {
  valid: boolean;
  problems?: string[];
}

export function validateProjectName(rawName: string): ProjectNameValidation {
  const name = rawName.trim();
  if (!name) {
    return { valid: false, problems: ['Project name cannot be empty.'] };
  }

  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return {
      valid: false,
      problems: ['Project name cannot contain path separators or be "." or "..".']
    };
  }

  const result = validateNpmName(name);
  if (!result.validForNewPackages) {
    return {
      valid: false,
      problems: [...(result.errors ?? []), ...(result.warnings ?? [])]
    };
  }

  return { valid: true };
}

export function assertTargetAvailable(targetDir: string): void {
  if (existsSync(targetDir)) {
    throw new CLIError(
      'PROJECT_EXISTS',
      `A file or directory already exists at "${targetDir}".`
    );
  }
}

export function toPackageName(projectName: string): string {
  const result = validateNpmName(projectName);
  if (result.validForNewPackages) return projectName;
  return projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-~]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '') || 'my-midnight-app';
}
