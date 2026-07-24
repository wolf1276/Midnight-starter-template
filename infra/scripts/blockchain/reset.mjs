#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';
import { COMPOSE_PROJECT_NAME } from '../lib/ports.mjs';

// Default: remove containers only, preserving chain/indexer volumes (fast, keeps data).
// --hard: also drop the node-data/indexer-data volumes, for when persisted state itself
// is corrupted and a plain container recreate won't clear it. Volume names are prefixed
// by Compose with the project name, so build them from the same COMPOSE_PROJECT_NAME
// runCompose itself uses (`-p`) rather than the bare `node-data`/`indexer-data` names.
const hard = process.argv.includes('--hard');
const dropVolumes = `docker volume rm -f ${COMPOSE_PROJECT_NAME}_node-data ${COMPOSE_PROJECT_NAME}_indexer-data > /dev/null 2>&1 || true`;

await runCompose(
  hard
    ? '⛓️  Resetting blockchain services (node, indexer, proof-server) — dropping volumes'
    : '⛓️  Resetting blockchain services (node, indexer, proof-server)',
  hard ? `rm -sf node indexer proof-server && ${dropVolumes}` : 'rm -sf node indexer proof-server',
  { requireDaemon: false },
);
