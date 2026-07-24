#!/usr/bin/env node
// Runs the pre-flight checks that setup.sh's own bash logic doesn't already cover natively
// (disk space, filesystem permissions, internet connectivity, Docker memory, required files).
// Fail-fast: stops and prints the first failure so expensive work never starts on a broken
// environment. setup.sh calls this once near the top, after Node/Docker/Compact are confirmed
// present by its own bash checks.
import { runPreflight } from '../lib/preflight.mjs';
import { isDockerDesktop, tryIncreaseDockerMemory } from '../lib/recovery.mjs';
import * as ui from '../lib/ui.mjs';

const verbose = process.env.SETUP_VERBOSE === '1' || process.argv.includes('--verbose');

// Docker memory allocation is worth flagging but not worth blocking setup over — some CI/sandbox
// environments under-report it. Run it separately as a warning, offering to fix it automatically
// when running under Docker Desktop (the only case where the allocation is actually adjustable).
const memory = runPreflight(['dockerMemory'], { failFast: false, verbose });
if (memory.failed.length) {
  const { whatHappened, howToFix } = memory.failed[0].error;
  ui.warn(whatHappened.replace(/\n\n.*/s, ''));
  if (isDockerDesktop() && (await ui.confirm('Increase Docker Desktop memory to 4GB and restart Docker Desktop now?'))) {
    const { recovered, detail } = await tryIncreaseDockerMemory(4, ui);
    if (recovered) {
      ui.success(`Docker memory allocation: ${detail}`);
    } else {
      ui.warn(`Could not increase Docker memory automatically (${detail}).`);
      ui.info(`  Fix: ${howToFix}`);
    }
  } else {
    ui.info(`  Fix: ${howToFix}`);
  }
} else {
  ui.success(`Docker memory allocation: ${memory.passed[0].detail}`);
}

const { stoppedEarly } = runPreflight(['internet', 'diskSpace', 'fsPermissions', 'requiredFiles'], {
  failFast: true,
  verbose,
});

process.exit(stoppedEarly ? 1 : 0);
