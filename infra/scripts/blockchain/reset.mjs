#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('⛓️  Resetting blockchain services (node, indexer, proof-server)', 'rm -sf node indexer proof-server', {
  requireDaemon: false,
});
