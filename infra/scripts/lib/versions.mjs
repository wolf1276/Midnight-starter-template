import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const versions = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'config', 'versions.json'), 'utf-8'));
