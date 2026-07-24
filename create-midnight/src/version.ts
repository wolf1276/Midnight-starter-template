import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Both src/ (dev, via tsx) and dist/ (built) sit one level below the package root,
// so the relative path to package.json is the same in either case.
const pkgPath = path.join(here, '..', 'package.json');

let cached: string | undefined;

/** The create-midnight CLI's own version, read from its package.json. */
export function getCliVersion(): string {
  if (!cached) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cached = pkg.version;
  }
  return cached!;
}
