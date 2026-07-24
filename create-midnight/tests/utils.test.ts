import { describe, expect, it } from 'vitest';
import { detectPackageManager, formatRunCommand, toPackageName, validateProjectName } from '../src/utils.js';
import type { PackageManager } from '../src/utils.js';

describe('detectPackageManager', () => {
  it('defaults to npm when no override is given', () => {
    expect(detectPackageManager()).toBe('npm');
  });

  it('honors each override flag', () => {
    expect(detectPackageManager('npm')).toBe('npm');
    expect(detectPackageManager('bun')).toBe('bun');
    expect(detectPackageManager('pnpm')).toBe('pnpm');
    expect(detectPackageManager('yarn')).toBe('yarn');
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
