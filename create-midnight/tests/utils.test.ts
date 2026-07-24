import { afterEach, describe, expect, it } from 'vitest';
import { detectPackageManager, toPackageName, validateProjectName } from '../src/utils.js';

describe('detectPackageManager', () => {
  const originalUserAgent = process.env.npm_config_user_agent;

  afterEach(() => {
    if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = originalUserAgent;
  });

  it('returns the explicit override regardless of user agent', () => {
    process.env.npm_config_user_agent = 'pnpm/9.0.0 node/v20.0.0';
    expect(detectPackageManager('bun')).toBe('bun');
  });

  it('detects pnpm from npm_config_user_agent', () => {
    process.env.npm_config_user_agent = 'pnpm/9.0.0 node/v20.0.0 linux x64';
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects yarn from npm_config_user_agent', () => {
    process.env.npm_config_user_agent = 'yarn/4.0.0 npm/? node/v20.0.0 linux x64';
    expect(detectPackageManager()).toBe('yarn');
  });

  it('detects bun from npm_config_user_agent', () => {
    process.env.npm_config_user_agent = 'bun/1.1.0 npm/? node/v20.0.0 linux x64';
    expect(detectPackageManager()).toBe('bun');
  });

  it('falls back to npm when no user agent is set', () => {
    delete process.env.npm_config_user_agent;
    expect(detectPackageManager()).toBe('npm');
  });

  it('falls back to npm for an unrecognized user agent', () => {
    process.env.npm_config_user_agent = 'some-other-tool/1.0.0';
    expect(detectPackageManager()).toBe('npm');
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
