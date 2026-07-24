import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const fixtureTemplate = path.join(here, 'fixtures', 'template');
// Resolve tsx's actual JS entry point rather than the node_modules/.bin shim: the
// shim is a POSIX shell script on macOS/Linux and a .cmd/.ps1 wrapper on Windows,
// neither of which `spawnSync('node', [shim, ...])` can execute directly.
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-midnight-it-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [tsxCli, path.join(packageRoot, 'src', 'cli.ts'), ...args], {
    cwd: workDir,
    env: {
      ...process.env,
      CREATE_MIDNIGHT_LOCAL_TEMPLATE: fixtureTemplate,
      // Force plain output so stdout assertions are deterministic across platforms —
      // some CI runners (e.g. windows-latest) set FORCE_COLOR, which would otherwise
      // inject ANSI codes between labels and values and break the \s+ matchers below.
      NO_COLOR: '1',
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

  it('announces the detected/forced package manager and shows it on the success screen', () => {
    const result = runCli(['pm-app', '--yes', '--no-install', '--no-setup', '--no-git', '--use-npm']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Using npm');
    expect(result.stdout).toMatch(/Package Manager\s+npm/);
  });

  it('lets an override flag take precedence over auto-detection', () => {
    const result = runCli(['pm-override-app', '--yes', '--no-install', '--no-setup', '--no-git', '--use-pnpm']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Using pnpm');
    expect(result.stdout).toMatch(/Package Manager\s+pnpm/);
  });

  it('rejects an unknown --template', () => {
    const result = runCli(['bad-template-app', '--yes', '--no-install', '--no-setup', '--no-git', '--template', 'nonexistent']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown template/);
  });
});

describe('create-midnight CLI (real GitHub download)', () => {
  const shouldRun = process.env.CREATE_MIDNIGHT_TEST_NETWORK === '1';

  function runReal(args: string[]) {
    return spawnSync(
      'node',
      [tsxCli, path.join(packageRoot, 'src', 'cli.ts'), ...args],
      { cwd: workDir, env: process.env, encoding: 'utf8' }
    );
  }

  it.skipIf(!shouldRun)('downloads, extracts, and configures the real starter template from GitHub via --ref main', () => {
    // The upstream repo has no version tags yet (see the version-locking test below),
    // so the real-network happy path is exercised via an explicit --ref override.
    const result = runReal(['network-app', '--yes', '--no-install', '--no-setup', '--no-git', '--ref', 'main']);

    expect(result.status).toBe(0);
    const projectDir = path.join(workDir, 'network-app');
    expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'web', '.env.local'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(false);
  });

  it.skipIf(!shouldRun)('shows the friendly "compatible template version not found" error against the real repo (no matching tag exists yet)', () => {
    const result = runReal(['no-tag-app', '--yes', '--no-install', '--no-setup', '--no-git']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Compatible template version not found');
    expect(result.stderr).toContain('Repository: wolf1276/Midnight-starter-template');
    expect(result.stderr).not.toContain('at CLIError');
  });
});
