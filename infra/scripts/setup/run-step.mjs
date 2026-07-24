#!/usr/bin/env node
// Runs a single expensive command (npm install, docker compose pull/up, etc.) on behalf of
// setup.sh, capturing its output so a raw failure never reaches the terminal unformatted.
//
// Usage: node scripts/setup/run-step.mjs "<label>" -- <command> [args...]
//
// On success: silent (setup.sh prints its own ✓ line). On failure: prints a classified
// CLIError panel (unless --verbose/SETUP_VERBOSE, which also dumps the raw output) and exits
// with the child's exit code.
import { spawn } from 'node:child_process';
import { classifyError, printCliError, CLIError } from '../lib/errors.mjs';

const args = process.argv.slice(2);
const sepIndex = args.indexOf('--');
if (sepIndex === -1) {
  console.error('Usage: run-step.mjs "<label>" -- <command> [args...]');
  process.exit(2);
}
const label = args[0];
const command = args.slice(sepIndex + 1);
const verbose = process.env.SETUP_VERBOSE === '1' || args.includes('--verbose');

// A stuck child (e.g. a dependency's postinstall script hanging on a native-binary
// download/probe) would otherwise block setup.sh forever with no output and no error —
// it looks identical to setup just taking a while. Fail loudly instead.
const timeoutMs = Number(process.env.SETUP_STEP_TIMEOUT_MS) || 15 * 60 * 1000;

const child = spawn(command[0], command.slice(1), {
  stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  shell: false,
  // Own process group so a timeout can reach grandchildren too (e.g. npm waits on a
  // postinstall script it spawned; SIGTERM to npm alone doesn't reach that script, and npm
  // won't exit until it does — spawnSync's built-in `timeout` has this exact gap).
  detached: process.platform !== 'win32',
});

let stdout = '';
let stderr = '';
if (verbose === false) {
  child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
}

let timedOut = false;
const killGroup = (signal) => {
  if (process.platform === 'win32' || !child.pid) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};
const timer = setTimeout(() => {
  timedOut = true;
  killGroup('SIGTERM');
  setTimeout(() => killGroup('SIGKILL'), 5000).unref();
}, timeoutMs);

child.on('close', (status, signal) => {
  clearTimeout(timer);

  if (status === 0) process.exit(0);

  if (timedOut) {
    const err = new CLIError({
      title: 'Setup Step Stalled',
      whatHappened:
        `"${label}" produced no output for ${Math.round(timeoutMs / 1000)}s and was killed. This is ` +
        `usually a dependency's postinstall script hanging on a network fetch or binary probe (a ` +
        `stuck child process, not a network outage).`,
      howToFix:
        'Re-run with SETUP_VERBOSE=1 to see exactly where it stalls, or raise the limit with ' +
        'SETUP_STEP_TIMEOUT_MS=<ms> if the step is just legitimately slow on your machine.',
    });
    printCliError(err, verbose);
    process.exit(1);
  }

  const rawOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
  const err = classifyError(new Error(rawOutput || `${label} failed (exit code ${status ?? `signal ${signal}`})`));
  printCliError(err, verbose);
  process.exit(status ?? 1);
});

child.on('error', (error) => {
  clearTimeout(timer);
  const err = classifyError(error);
  printCliError(err, verbose);
  process.exit(1);
});
