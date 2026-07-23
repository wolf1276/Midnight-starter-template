#!/usr/bin/env node
// Runs the pre-flight checks that setup.sh's own bash logic doesn't already cover natively
// (disk space, filesystem permissions, internet connectivity, Docker memory, required files).
// Fail-fast: stops and prints the first failure so expensive work never starts on a broken
// environment. setup.sh calls this once near the top, after Node/Docker/Compact are confirmed
// present by its own bash checks.
import { runPreflight } from '../lib/preflight.mjs';
import * as ui from '../lib/ui.mjs';

const verbose = process.env.SETUP_VERBOSE === '1' || process.argv.includes('--verbose');

// Docker memory allocation is worth flagging but not worth blocking setup over — some CI/sandbox
// environments under-report it. Run it separately as a warning.
const memory = runPreflight(['dockerMemory'], { failFast: false, verbose });
if (memory.failed.length) {
  ui.warn(memory.failed[0].error.whatHappened.replace(/\n\n.*/s, ''));
  ui.info(`  Fix: ${memory.failed[0].error.howToFix}`);
} else {
  ui.success(`Docker memory allocation: ${memory.passed[0].detail}`);
}

const { stoppedEarly } = runPreflight(['internet', 'diskSpace', 'fsPermissions', 'requiredFiles'], {
  failFast: true,
  verbose,
});

process.exit(stoppedEarly ? 1 : 0);
