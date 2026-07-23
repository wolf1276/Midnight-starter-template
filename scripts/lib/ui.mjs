// Small, dependency-free terminal UI helpers for plain-JS scripts (outside cli/src, which
// can't import TypeScript). Mirrors the visual language of cli/src/ui.ts (rule character,
// ✓/✗/⚠ symbols, dim/bold colors, NO_COLOR support) so doctor.mjs and deploy.mjs look like
// the same tool as the deploy CLI.

const isTTY = Boolean(process.stdout.isTTY);
const colorEnabled = isTTY && !process.env.NO_COLOR;

const wrap = (code) => (text) => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);

export const color = {
  dim: wrap('2'),
  bold: wrap('1'),
  green: wrap('32'),
  red: wrap('31'),
  yellow: wrap('33'),
  cyan: wrap('36'),
  magenta: wrap('35'),
};

const RULE = '━'.repeat(36);

const out = (line = '') => console.log(line);

/** Print a section header, e.g. "🚀 Midnight Contract Deployment". */
export const section = (title) => {
  out();
  out(color.dim(RULE));
  out(color.bold(title));
  out(color.dim(RULE));
  out();
};

export const info = (msg) => out(msg);
export const success = (msg) => out(`${color.green('✓')} ${msg}`);
export const warn = (msg) => out(`${color.yellow('⚠')} ${msg}`);
export const fail = (msg) => out(`${color.red('✗')} ${msg}`);

/** Aligned key: value summary block. */
export const summary = (rows) => {
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    out(`${color.dim(`${k}:`.padEnd(width + 2))}${v}`);
  }
};

/** Print a structured, actionable error instead of a generic failure message. */
export const explainError = ({ what, why, fix, nextCommand }) => {
  out();
  fail(color.bold(what));
  out(`  ${color.dim('Why:')} ${why}`);
  out(`  ${color.dim('Fix:')} ${fix}`);
  if (nextCommand) {
    out(`  ${color.dim('Next:')} ${color.cyan(nextCommand)}`);
  }
  out();
};
