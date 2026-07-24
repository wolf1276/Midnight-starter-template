#!/usr/bin/env node
// Runs a single expensive command (npm install, docker compose pull/up, etc.) on behalf of
// setup.sh, capturing its output so a raw failure never reaches the terminal unformatted.
//
// Usage: node scripts/setup/run-step.mjs "<label>" -- <command> [args...]
//
// On success: silent (setup.sh prints its own ✓ line). On failure: prints a classified
// CLIError panel (unless --verbose/SETUP_VERBOSE, which also dumps the raw output) and exits
// with the child's exit code.
import { spawnSync } from 'node:child_process';
import { classifyError, printCliError } from '../lib/errors.mjs';

const args = process.argv.slice(2);
const sepIndex = args.indexOf('--');
if (sepIndex === -1) {
  console.error('Usage: run-step.mjs "<label>" -- <command> [args...]');
  process.exit(2);
}
const label = args[0];
const command = args.slice(sepIndex + 1);
const verbose = process.env.SETUP_VERBOSE === '1' || args.includes('--verbose');

const result = spawnSync(command[0], command.slice(1), {
  stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  shell: false,
});

if (result.status === 0) process.exit(0);

const stderrText = (result.stderr ?? '').toString();
const stdoutText = (result.stdout ?? '').toString();
const rawOutput = [stdoutText, stderrText].filter(Boolean).join('\n').trim();

const err = classifyError(new Error(rawOutput || `${label} failed (exit code ${result.status ?? 'unknown'})`, { cause: result.error }));
printCliError(err, verbose);
process.exit(result.status ?? 1);
