import { describe, expect, it } from 'vitest';
import { selectWorkingPackageManager, type PmSelectionDeps } from '../src/pmSelect.js';

function fakeDeps(overrides: Partial<PmSelectionDeps> = {}): PmSelectionDeps {
  return {
    checkCommand: async () => true,
    install: async () => {},
    runScript: async () => {},
    clean: async () => {},
    ...overrides
  };
}

describe('selectWorkingPackageManager', () => {
  it('picks the first candidate that installs and sets up cleanly', async () => {
    const result = await selectWorkingPackageManager('/tmp/proj', { runSetup: true }, fakeDeps());
    expect(result.pm).toBe('bun');
    expect(result.attempts).toEqual([]);
  });

  it('falls back to the next package manager when install fails', async () => {
    const cleaned: string[] = [];
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: true },
      fakeDeps({
        install: async (_dir, pm) => {
          if (pm === 'bun') throw new Error('bun install exploded');
        },
        clean: async (_dir, pm) => {
          cleaned.push(pm);
        }
      })
    );
    expect(result.pm).toBe('pnpm');
    expect(result.attempts).toEqual([{ pm: 'bun', stage: 'install', detail: 'bun install exploded' }]);
    expect(cleaned).toEqual(['bun']);
  });

  it('falls back when the setup script fails, not just install', async () => {
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: true },
      fakeDeps({
        runScript: async (_dir, pm, script) => {
          if (pm === 'bun' && script === 'setup') throw new Error('setup broke');
        }
      })
    );
    expect(result.pm).toBe('pnpm');
    expect(result.attempts).toEqual([{ pm: 'bun', stage: 'setup', detail: 'setup broke' }]);
  });

  it('falls back when the verify script fails', async () => {
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: true, verifyScript: 'verify' },
      fakeDeps({
        runScript: async (_dir, pm, script) => {
          if (pm === 'bun' && script === 'verify') throw new Error('scripts broken under bun');
        }
      })
    );
    expect(result.pm).toBe('pnpm');
    expect(result.attempts).toEqual([{ pm: 'bun', stage: 'verify', detail: 'scripts broken under bun' }]);
  });

  it('skips package managers that are not installed', async () => {
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: true },
      fakeDeps({ checkCommand: async (cmd) => cmd !== 'bun' })
    );
    expect(result.pm).toBe('pnpm');
    expect(result.attempts).toEqual([{ pm: 'bun', stage: 'not-installed' }]);
  });

  it('reports every failure and returns null when all package managers fail', async () => {
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: true },
      fakeDeps({
        install: async () => {
          throw new Error('always fails');
        }
      })
    );
    expect(result.pm).toBeNull();
    expect(result.attempts.map((a) => a.pm)).toEqual(['bun', 'pnpm', 'yarn', 'npm']);
    expect(result.attempts.every((a) => a.stage === 'install')).toBe(true);
  });

  it('does not run setup or verify when runSetup is false', async () => {
    let scriptCalls = 0;
    const result = await selectWorkingPackageManager(
      '/tmp/proj',
      { runSetup: false },
      fakeDeps({ runScript: async () => { scriptCalls++; } })
    );
    expect(result.pm).toBe('bun');
    expect(scriptCalls).toBe(0);
  });
});
