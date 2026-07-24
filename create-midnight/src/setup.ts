import { CLIError } from './errors.js';
import { run } from './utils.js';
import type { PackageManager } from './utils.js';

// yarn runs package scripts directly (`yarn setup`); the others need `run`.
const SCRIPT_RUN_PREFIX: Record<PackageManager, string[]> = {
  npm: ['run'],
  pnpm: ['run'],
  yarn: [],
  bun: ['run']
};

export async function runProjectScript(targetDir: string, pm: PackageManager, script: string): Promise<void> {
  const result = await run(pm, [...SCRIPT_RUN_PREFIX[pm], script], { cwd: targetDir, captureOutput: true });
  if (result.code !== 0) {
    throw new CLIError(
      'SETUP_FAILED',
      `The project's "${script}" script reported an error.`,
      `${result.stdout}\n${result.stderr}`
    );
  }
}

export function runProjectSetup(targetDir: string, pm: PackageManager): Promise<void> {
  return runProjectScript(targetDir, pm, 'setup');
}
