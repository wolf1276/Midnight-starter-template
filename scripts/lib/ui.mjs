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

const realStdoutWrite = process.stdout.write.bind(process.stdout);
const realStderrWrite = process.stderr.write.bind(process.stderr);

const out = (line = '') => realStdoutWrite(`${line}\n`);

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

export const isInteractive = isTTY;

/** A single in-progress step: "⏳ message" that resolves to ✓/✗/⚠ in place. */
export class Step {
  constructor(label) {
    this.label = label;
    this.start = Date.now();
    if (isTTY) {
      realStdoutWrite(`⏳ ${label}...`);
    } else {
      out(`⏳ ${label}...`);
    }
    this.done = false;
  }

  elapsed() {
    const ms = Date.now() - this.start;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  finish(symbol, colorFn, message) {
    if (this.done) return;
    this.done = true;
    const text = `${colorFn(symbol)} ${message ?? this.label} ${color.dim(`(${this.elapsed()})`)}`;
    if (isTTY) {
      realStdoutWrite(`\r\x1b[K${text}\n`);
    } else {
      out(text);
    }
  }

  succeed(message) {
    this.finish('✓', color.green, message);
  }

  fail(message) {
    this.finish('✗', color.red, message);
  }

  warn(message) {
    this.finish('⚠', color.yellow, message);
  }
}

export const step = (label) => new Step(label);

/** Overwrite the current terminal line in place (for continuously-updating values like a polled balance). */
export const liveLine = (text) => {
  if (isTTY) {
    realStdoutWrite(`\r\x1b[K${text}`);
  } else {
    out(text);
  }
};

/** Finish a run of liveLine() updates, moving to a fresh line. */
export const endLiveLine = () => {
  if (isTTY) realStdoutWrite('\n');
};

/** Aligned key: value summary block. */
export const summary = (rows) => {
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    out(`${color.dim(`${k}:`.padEnd(width + 2))}${v}`);
  }
};

/** Redirect stdout/stderr writes elsewhere (e.g. a log file) for the duration of `fn`, restoring afterwards. */
export const withQuiet = async (quiet, sink, fn) => {
  if (!quiet) return fn();
  const patched = (chunk, ...rest) => {
    try {
      sink(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    } catch {
      // best-effort only; never let logging interception break the caller
    }
    const maybeCallback = rest.find((a) => typeof a === 'function');
    if (maybeCallback) maybeCallback();
    return true;
  };
  process.stdout.write = patched;
  process.stderr.write = patched;
  try {
    return await fn();
  } finally {
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
  }
};

export const elapsedSince = (start) => {
  const ms = Date.now() - start;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
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
