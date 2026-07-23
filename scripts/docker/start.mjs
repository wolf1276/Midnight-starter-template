#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('🐳 Starting full stack (node, indexer, proof-server, web)', '--profile web up -d --build', {
  checkPorts: true,
});
