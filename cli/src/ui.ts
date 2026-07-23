/*
 * This file is part of example-bboard.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Small, dependency-free terminal UI helpers used to give the deployment CLI
 * a clean, structured, "modern dev tool" look (Vercel/Prisma/Cargo style),
 * independent of whatever raw logging the underlying SDKs produce.
 *
 * Captures the *original* stdout/stderr write functions at import time so
 * that UI output always reaches the real terminal even while `withQuiet()`
 * is redirecting everything else to the log file.
 */

import type { WriteStream } from 'node:tty';

const realStdoutWrite = process.stdout.write.bind(process.stdout);
const realStderrWrite = process.stderr.write.bind(process.stderr);

const isTTY = Boolean((process.stdout as WriteStream).isTTY);
const colorEnabled = isTTY && !process.env.NO_COLOR;

const wrap = (code: string) => (text: string) => (colorEnabled ? `[${code}m${text}[0m` : text);

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

const out = (line = ''): void => {
  realStdoutWrite(`${line}\n`);
};

/** Print a section header, e.g. "🚀 Midnight Contract Deployment". */
export const section = (title: string): void => {
  out();
  out(color.dim(RULE));
  out(color.bold(title));
  out(color.dim(RULE));
  out();
};

export const info = (msg: string): void => out(msg);
export const success = (msg: string): void => out(`${color.green('✓')} ${msg}`);
export const warn = (msg: string): void => out(`${color.yellow('⚠')} ${msg}`);
export const fail = (msg: string): void => out(`${color.red('✗')} ${msg}`);

/** A single in-progress step: "⏳ message" that resolves to ✓/✗/⚠ in place. */
export class Step {
  private readonly label: string;
  private readonly start: number;
  private done = false;

  constructor(label: string) {
    this.label = label;
    this.start = Date.now();
    if (isTTY) {
      realStdoutWrite(`⏳ ${label}...`);
    } else {
      out(`⏳ ${label}...`);
    }
  }

  private elapsed(): string {
    const ms = Date.now() - this.start;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  private finish(symbol: string, colorFn: (s: string) => string, message?: string): void {
    if (this.done) return;
    this.done = true;
    const text = `${colorFn(symbol)} ${message ?? this.label} ${color.dim(`(${this.elapsed()})`)}`;
    if (isTTY) {
      realStdoutWrite(`\r[K${text}\n`);
    } else {
      out(text);
    }
  }

  succeed(message?: string): void {
    this.finish('✓', color.green, message);
  }

  fail(message?: string): void {
    this.finish('✗', color.red, message);
  }

  warn(message?: string): void {
    this.finish('⚠', color.yellow, message);
  }
}

export const step = (label: string): Step => new Step(label);

export const isInteractive = isTTY;

/** Overwrite the current terminal line in place (for continuously-updating values like a polled balance). */
export const liveLine = (text: string): void => {
  if (isTTY) {
    realStdoutWrite(`\r\x1b[K${text}`);
  } else {
    out(text);
  }
};

/** Finish a run of liveLine() updates, moving to a fresh line. */
export const endLiveLine = (): void => {
  if (isTTY) realStdoutWrite('\n');
};

/** Aligned key: value summary block. */
export const summary = (rows: Array<[string, string]>): void => {
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    out(`${color.dim(`${k}:`.padEnd(width + 2))}${v}`);
  }
};

export interface ActionableError {
  what: string;
  why: string;
  fix: string;
  nextCommand?: string;
}

/** Print a structured, actionable error instead of a generic "Deployment failed". */
export const explainError = ({ what, why, fix, nextCommand }: ActionableError): void => {
  out();
  fail(color.bold(what));
  out(`  ${color.dim('Why:')} ${why}`);
  out(`  ${color.dim('Fix:')} ${fix}`);
  if (nextCommand) {
    out(`  ${color.dim('Next:')} ${color.cyan(nextCommand)}`);
  }
  out();
};

/** Redirect stdout/stderr writes elsewhere (e.g. the log file) for the duration of `fn`, restoring afterwards. */
export const withQuiet = async <T>(quiet: boolean, sink: (chunk: string) => void, fn: () => Promise<T>): Promise<T> => {
  if (!quiet) {
    return fn();
  }
  const patched = (chunk: unknown, ...rest: unknown[]): boolean => {
    try {
      sink(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8'));
    } catch {
      // best-effort only; never let logging interception break the deployment
    }
    // Signal success without touching the real terminal.
    const maybeCallback = rest.find((a): a is () => void => typeof a === 'function');
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

export const elapsedSince = (start: number): string => {
  const ms = Date.now() - start;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
};
