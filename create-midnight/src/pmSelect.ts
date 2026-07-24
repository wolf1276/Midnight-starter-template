import { rm } from 'node:fs/promises';
import path from 'node:path';

import { CLIError } from './errors.js';
import { installDependencies } from './installer.js';
import { runProjectScript } from './setup.js';
import { commandExists, readPackageScripts, type PackageManager } from './utils.js';

/** Fastest-first: only committed to once it has proven it can do the job. */
export const PM_PRIORITY: PackageManager[] = ['bun', 'pnpm', 'yarn', 'npm'];

const LOCKFILES: Record<PackageManager, string[]> = {
  npm: ['package-lock.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  bun: ['bun.lock', 'bun.lockb']
};

export type PmAttemptStage = 'not-installed' | 'install' | 'setup' | 'verify';

export interface PmAttempt {
  pm: PackageManager;
  stage: PmAttemptStage;
  detail?: string;
}

export interface PmSelectionResult {
  pm: PackageManager | null;
  attempts: PmAttempt[];
}

export interface PmSelectionDeps {
  checkCommand: (command: string) => Promise<boolean>;
  install: (targetDir: string, pm: PackageManager) => Promise<void>;
  runScript: (targetDir: string, pm: PackageManager, script: string) => Promise<void>;
  clean: (targetDir: string, pm: PackageManager) => Promise<void>;
}

const defaultDeps: PmSelectionDeps = {
  checkCommand: commandExists,
  install: installDependencies,
  runScript: runProjectScript,
  clean: async (targetDir, pm) => {
    await rm(path.join(targetDir, 'node_modules'), { recursive: true, force: true });
    await Promise.all(
      LOCKFILES[pm].map((file) => rm(path.join(targetDir, file), { force: true }))
    );
  }
};

/**
 * Tries each package manager in priority order against the *real* generated
 * project until one installs, runs setup, and runs the project's scripts
 * successfully. A candidate's install/setup artifacts are wiped before the
 * next candidate is tried, so the caller never ends up with a half-finished
 * project from an abandoned package manager.
 */
export async function selectWorkingPackageManager(
  targetDir: string,
  options: { runSetup: boolean; verifyScript?: string },
  deps: PmSelectionDeps = defaultDeps
): Promise<PmSelectionResult> {
  const attempts: PmAttempt[] = [];

  for (const pm of PM_PRIORITY) {
    if (!(await deps.checkCommand(pm))) {
      attempts.push({ pm, stage: 'not-installed' });
      continue;
    }

    try {
      await deps.install(targetDir, pm);
    } catch (error) {
      attempts.push({ pm, stage: 'install', detail: detailOf(error) });
      await deps.clean(targetDir, pm);
      continue;
    }

    if (options.runSetup) {
      try {
        await deps.runScript(targetDir, pm, 'setup');
      } catch (error) {
        attempts.push({ pm, stage: 'setup', detail: detailOf(error) });
        await deps.clean(targetDir, pm);
        continue;
      }

      if (options.verifyScript) {
        try {
          await deps.runScript(targetDir, pm, options.verifyScript);
        } catch (error) {
          attempts.push({ pm, stage: 'verify', detail: detailOf(error) });
          await deps.clean(targetDir, pm);
          continue;
        }
      }
    }

    return { pm, attempts };
  }

  return { pm: null, attempts };
}

/** The generated project's own "verify" script, if the template ships one. */
export function detectVerifyScript(targetDir: string): string | undefined {
  return 'verify' in readPackageScripts(targetDir) ? 'verify' : undefined;
}

function detailOf(error: unknown): string {
  if (error instanceof CLIError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
