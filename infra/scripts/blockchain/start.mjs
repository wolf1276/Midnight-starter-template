#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('⛓️  Starting blockchain services (node, indexer, proof-server)', 'up -d node indexer proof-server', {
  checkPorts: true,
});
