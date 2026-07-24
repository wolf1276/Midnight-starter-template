#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('🐳 Stopping full stack (node, indexer, proof-server, web)', '--profile web down', {
  requireDaemon: false,
});
