import { CLIError } from './errors.js';
import { run } from './utils.js';
import type { PackageManager } from './utils.js';

const SETUP_ARGS: Record<PackageManager, string[]> = {
  npm: ['run', 'setup'],
  pnpm: ['run', 'setup'],
  yarn: ['setup'],
  bun: ['run', 'setup']
};

export async function runProjectSetup(targetDir: string, pm: PackageManager): Promise<void> {
  const result = await run(pm, SETUP_ARGS[pm], { cwd: targetDir, captureOutput: true });
  if (result.code !== 0) {
    throw new CLIError(
      'SETUP_FAILED',
      'The project setup script (npm run setup) reported an error.',
      `${result.stdout}\n${result.stderr}`
    );
  }
}
