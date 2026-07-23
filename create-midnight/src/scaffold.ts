import fs from 'node:fs/promises';
import path from 'node:path';
import type { Network } from './prompts.js';
import { verbose } from './logger.js';

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function rewriteRootPackageJson(targetDir: string, packageName: string): Promise<void> {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!(await exists(pkgPath))) return;

  const raw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.name = packageName;
  pkg.version = '0.1.0';
  delete pkg.repository;
  delete pkg.bugs;
  delete pkg.homepage;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/** Removes files that only make sense inside the upstream template repo. */
async function cleanTemplateArtifacts(targetDir: string): Promise<void> {
  const toRemove = ['.git', 'CODEOWNERS', 'renovate.json', 'create-midnight'];
  for (const entry of toRemove) {
    const target = path.join(targetDir, entry);
    if (await exists(target)) {
      verbose(`Removing template artifact: ${entry}`);
      await fs.rm(target, { recursive: true, force: true });
    }
  }
}

async function writeEnvFile(targetDir: string, network: Network): Promise<void> {
  const webDir = path.join(targetDir, 'web');
  const examplePath = path.join(webDir, '.env.example');
  const localPath = path.join(webDir, '.env.local');

  if (!(await exists(examplePath))) return;
  if (await exists(localPath)) return; // don't clobber an existing file from the template

  let contents = await fs.readFile(examplePath, 'utf8');
  contents = contents.replace(
    /NEXT_PUBLIC_NETWORK_ID=.*/,
    `NEXT_PUBLIC_NETWORK_ID=${network}`
  );
  await fs.writeFile(localPath, contents);
}

export interface ScaffoldOptions {
  targetDir: string;
  packageName: string;
  network: Network;
}

/** Configures a freshly-downloaded template so the project is independent and ready to use. */
export async function configureProject(options: ScaffoldOptions): Promise<void> {
  const { targetDir, packageName, network } = options;

  await rewriteRootPackageJson(targetDir, packageName);
  await writeEnvFile(targetDir, network);
  await cleanTemplateArtifacts(targetDir);
}
