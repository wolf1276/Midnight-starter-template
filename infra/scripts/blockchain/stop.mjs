#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('⛓️  Stopping blockchain services (node, indexer, proof-server)', 'stop node indexer proof-server', {
  requireDaemon: false,
});
