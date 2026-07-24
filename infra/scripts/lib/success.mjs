// Rich success screens shown at the end of a long-running flow, replacing plain "done" lines
// with something in the spirit of Vercel/Cargo/Foundry's final summary panels.

import { color } from './ui.mjs';

const RULE = '━'.repeat(36);
const out = (line = '') => process.stdout.write(`${line}\n`);
const checkOrDash = (ok) => (ok === undefined ? color.dim('—') : ok ? color.green('✓') : color.red('✗'));

/**
 * Prints the "environment ready" panel at the end of `npm run setup`.
 * `env` — a map of label -> boolean|undefined (undefined renders as a dash, meaning "not checked").
 */
export function printSetupComplete({ env, frontendUrl }) {
  out();
  out(color.dim(RULE));
  out(color.bold('🎉 Midnight Starter Ready'));
  out(color.dim(RULE));
  out();
  out(color.bold('Environment'));
  for (const [label, ok] of Object.entries(env)) {
    out(`${checkOrDash(ok)} ${label}`);
  }
  out();
  if (frontendUrl) {
    out(color.bold('Frontend'));
    out(color.cyan(frontendUrl));
    out();
  }
  out(color.bold('Next steps'));
  out(color.cyan('npm run dev'));
  out();
  out(color.cyan('cd contracts'));
  out(color.cyan('npm run deploy'));
  out();
  out(color.dim(RULE));
  out();
}

/**
 * Prints the "contract deployed" panel at the end of `npm run deploy`.
 */
export function printDeploymentComplete({ address, explorerUrl, wallet, network, frontendUpdated, nextCommand }) {
  out();
  out(color.dim(RULE));
  out(color.bold('🚀 Contract Deployed'));
  out(color.dim(RULE));
  out();
  out(color.bold('Address'));
  out(address);
  out();
  if (explorerUrl) {
    out(color.bold('Explorer'));
    out(color.cyan(explorerUrl));
    out();
  }
  out(color.bold('Wallet'));
  out(wallet);
  out();
  out(color.bold('Network'));
  out(network);
  out();
  out(color.bold('Frontend'));
  out(frontendUpdated ? `${color.green('✓')} updated with new contract address` : `${color.yellow('⚠')} not updated — update manually`);
  out();
  if (nextCommand) {
    out(color.bold('Next command'));
    out(color.cyan(nextCommand));
    out();
  }
  out(color.dim(RULE));
  out();
}
