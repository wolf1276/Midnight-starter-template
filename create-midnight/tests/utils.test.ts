import { describe, expect, it } from 'vitest';
import { detectPackageManager, formatRunCommand, toPackageName, validateProjectName } from '../src/utils.js';
import type { PackageManager } from '../src/utils.js';

/** Simulates only the given executables being present on PATH. */
function checkerFor(available: string[]) {
  return async (command: string) => available.includes(command);
}

describe('detectPackageManager', () => {
  it('prefers bun when everything is available', async () => {
    expect(await detectPackageManager(undefined, checkerFor(['bun', 'pnpm', 'yarn']))).toBe('bun');
  });

  it('falls back to pnpm when bun is missing', async () => {
    expect(await detectPackageManager(undefined, checkerFor(['pnpm', 'yarn']))).toBe('pnpm');
  });

  it('falls back to yarn when bun and pnpm are missing', async () => {
    expect(await detectPackageManager(undefined, checkerFor(['yarn']))).toBe('yarn');
  });

  it('falls back to npm when nothing else is found', async () => {
    expect(await detectPackageManager(undefined, checkerFor([]))).toBe('npm');
  });

  it('returns the explicit override regardless of what is installed', async () => {
    expect(await detectPackageManager('npm', checkerFor(['bun', 'pnpm', 'yarn']))).toBe('npm');
  });

  it('honors each override flag', async () => {
    const checker = checkerFor(['bun', 'pnpm', 'yarn']);
    expect(await detectPackageManager('bun', checker)).toBe('bun');
    expect(await detectPackageManager('pnpm', checker)).toBe('pnpm');
    expect(await detectPackageManager('yarn', checker)).toBe('yarn');
  });
});

describe('validateProjectName', () => {
  it('accepts a valid lowercase-dash name', () => {
    expect(validateProjectName('my-midnight-app').valid).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = validateProjectName('   ');
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('Project name cannot be empty.');
  });

  it('rejects a name with spaces and special characters', () => {
    const result = validateProjectName('Invalid Name!!');
    expect(result.valid).toBe(false);
    expect(result.problems?.length).toBeGreaterThan(0);
  });

  it('rejects a name starting with a dot or underscore', () => {
    expect(validateProjectName('.hidden-app').valid).toBe(false);
    expect(validateProjectName('_private-app').valid).toBe(false);
  });

  it('rejects names containing path separators to prevent scaffolding outside the target directory', () => {
    expect(validateProjectName('../evil').valid).toBe(false);
    expect(validateProjectName('../../etc/foo').valid).toBe(false);
    expect(validateProjectName('foo/bar').valid).toBe(false);
    expect(validateProjectName('foo\\bar').valid).toBe(false);
    expect(validateProjectName('.').valid).toBe(false);
    expect(validateProjectName('..').valid).toBe(false);
  });
});

describe('toPackageName', () => {
  it('passes through an already-valid npm name', () => {
    expect(toPackageName('my-app')).toBe('my-app');
  });

  it('slugifies an invalid name into a valid npm package name', () => {
    expect(toPackageName('My Cool App!!')).toBe('my-cool-app');
  });

  it('falls back to a default name when slugification yields nothing usable', () => {
    expect(toPackageName('!!!')).toBe('my-midnight-app');
  });
});

describe('formatRunCommand', () => {
  const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

  it('never hardcodes bun for the other package managers', () => {
    for (const pm of managers) {
      expect(formatRunCommand(pm, 'dev')).toBe(`${pm} run dev`);
    }
  });

  it('prints the correct command for each package manager', () => {
    expect(formatRunCommand('npm', 'deploy')).toBe('npm run deploy');
    expect(formatRunCommand('pnpm', 'deploy')).toBe('pnpm run deploy');
    expect(formatRunCommand('yarn', 'deploy')).toBe('yarn run deploy');
    expect(formatRunCommand('bun', 'deploy')).toBe('bun run deploy');
  });
});
