import path from 'node:path';
import { existsSync } from 'node:fs';
import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { CLIError } from './errors.js';
import { toPackageName, validateProjectName } from './utils.js';

export type Network = 'preview' | 'preprod';

export interface CliFlags {
  projectName?: string;
  template: string;
  network?: Network;
  git?: boolean;
  install?: boolean;
  setup?: boolean;
  yes: boolean;
  verbose: boolean;
}

export interface ProjectAnswers {
  projectName: string;
  packageName: string;
  targetDir: string;
  template: string;
  network: Network;
  initGit: boolean;
  installDeps: boolean;
  runSetup: boolean;
}

function handleCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel('Operation cancelled.');
    process.exit(0);
  }
  return value as T;
}

export async function collectAnswers(flags: CliFlags): Promise<ProjectAnswers> {
  let projectName = flags.projectName;

  if (!projectName) {
    const answer = await clack.text({
      message: 'Project name',
      placeholder: 'my-app',
      defaultValue: 'my-app',
      validate: (value) => {
        const name = value?.trim() || 'my-app';
        const { valid, problems } = validateProjectName(name);
        if (!valid) return problems?.[0] ?? 'Invalid project name.';
        const targetDir = path.resolve(process.cwd(), name);
        if (existsSync(targetDir)) return `Directory "${name}" already exists.`;
        return undefined;
      }
    });
    projectName = handleCancel(answer) as string;
  } else {
    const { valid, problems } = validateProjectName(projectName);
    if (!valid) {
      throw new CLIError('INVALID_NAME', problems?.[0] ?? `Invalid project name: ${projectName}`);
    }
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  let network = flags.network;
  if (!network) {
    if (flags.yes) {
      network = 'preview';
    } else {
      const answer = await clack.select({
        message: 'Default Network',
        options: [
          { value: 'preview', label: 'Preview', hint: 'Recommended - fast iteration and development' },
          { value: 'preprod', label: 'Preprod', hint: 'Closer to production testing' }
        ],
        initialValue: 'preview'
      });
      network = handleCancel(answer) as Network;
    }
  }

  // Everything past project name and network is automatic — no prompts.
  // Flags remain available for scripts/tests/CI to override the defaults.
  const initGit = flags.git ?? true;
  const installDeps = flags.install ?? true;
  const runSetup = flags.setup ?? true;

  return {
    projectName,
    packageName: toPackageName(projectName),
    targetDir,
    template: flags.template,
    network,
    initGit,
    installDeps,
    runSetup
  };
}

export function printBanner(): void {
  clack.intro(pc.bold(pc.magenta('✨ Welcome to Create Midnight')));
}
