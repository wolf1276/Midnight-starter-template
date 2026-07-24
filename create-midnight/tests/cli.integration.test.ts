import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const fixtureTemplate = path.join(here, 'fixtures', 'template');

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-midnight-it-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [path.join(packageRoot, 'node_modules', '.bin', 'tsx'), path.join(packageRoot, 'src', 'cli.ts'), ...args], {
    cwd: workDir,
    env: {
      ...process.env,
      CREATE_MIDNIGHT_LOCAL_TEMPLATE: fixtureTemplate,
      ...env
    },
    encoding: 'utf8'
  });
}

describe('create-midnight CLI (local template fixture)', () => {
  it('scaffolds a project: package.json rewritten, .env.local generated, git initialized', () => {
    const result = runCli([
      'test-app',
      '--yes',
      '--no-install',
      '--no-setup',
      '--network',
      'preview'
    ]);

    expect(result.status).toBe(0);

    const projectDir = path.join(workDir, 'test-app');
    expect(fs.existsSync(projectDir)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'README.md'))).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('test-app');
    expect(pkg.repository).toBeUndefined();
    expect(pkg.bugs).toBeUndefined();
    expect(pkg.homepage).toBeUndefined();

    const envLocal = fs.readFileSync(path.join(projectDir, 'web', '.env.local'), 'utf8');
    expect(envLocal).toContain('NEXT_PUBLIC_NETWORK_ID=preview');

    expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(true);
  });

  it('runs project setup when --setup is passed (requires --install, per CLI semantics)', () => {
    const result = runCli(['setup-app', '--yes', '--install', '--setup', '--no-git']);
    expect(result.status).toBe(0);
    // ora writes step/spinner status (e.g. "Environment ready") to stderr, not stdout.
    expect(result.stderr).toContain('Environment ready');
  });

  it('warns and skips setup when --setup is passed without --install', () => {
    const result = runCli(['setup-skip-app', '--yes', '--no-install', '--setup', '--no-git']);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Environment ready');
    expect(result.stdout).toContain('Skipping setup');
  });

  it('skips git initialization with --no-git', () => {
    const result = runCli(['no-git-app', '--yes', '--no-install', '--no-setup', '--no-git']);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(workDir, 'no-git-app', '.git'))).toBe(false);
  });

  it('fails with a friendly error (no stack trace) when the target directory already exists', () => {
    fs.mkdirSync(path.join(workDir, 'existing-app'));
    const result = runCli(['existing-app', '--yes', '--no-install', '--no-setup', '--no-git']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already exists');
    expect(result.stderr).not.toContain('at CLIError');
    expect(result.stderr).not.toContain('.ts:');
  });

  it('fails with a friendly error for an invalid project name', () => {
    const result = runCli(['Invalid Name!!', '--yes', '--no-install', '--no-setup', '--no-git']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/invalid|name/);
  });

  it('prints the full stack trace only with --verbose', () => {
    fs.mkdirSync(path.join(workDir, 'dup-app'));
    const quiet = runCli(['dup-app', '--yes', '--no-install', '--no-setup', '--no-git']);
    const verboseResult = runCli(['dup-app', '--yes', '--no-install', '--no-setup', '--no-git', '--verbose']);

    expect(quiet.stderr).not.toContain('Verbose details');
    expect(verboseResult.stderr).toContain('Verbose details');
  });

  it('rejects an invalid --network value', () => {
    const result = runCli(['bad-network-app', '--yes', '--no-install', '--no-setup', '--no-git', '--network', 'mainnet']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--network must be "preview" or "preprod"/);
  });

  it('rejects an unknown --template', () => {
    const result = runCli(['bad-template-app', '--yes', '--no-install', '--no-setup', '--no-git', '--template', 'nonexistent']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown template/);
  });
});

describe('create-midnight CLI (real GitHub download)', () => {
  const shouldRun = process.env.CREATE_MIDNIGHT_TEST_NETWORK === '1';

  it.skipIf(!shouldRun)('downloads, extracts, and configures the real starter template from GitHub', () => {
    const result = spawnSync(
      'node',
      [path.join(packageRoot, 'node_modules', '.bin', 'tsx'), path.join(packageRoot, 'src', 'cli.ts'), 'network-app', '--yes', '--no-install', '--no-setup', '--no-git'],
      { cwd: workDir, env: process.env, encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    const projectDir = path.join(workDir, 'network-app');
    expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'web', '.env.local'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(false);
  });
});
