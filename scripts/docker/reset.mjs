#!/usr/bin/env node
import { runCompose } from '../lib/compose-cmd.mjs';

await runCompose('🐳 Resetting full stack (this clears local chain/indexer data)', '--profile web down -v --remove-orphans', {
  requireDaemon: false,
});
