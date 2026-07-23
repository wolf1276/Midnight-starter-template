#!/usr/bin/env node
// Prints the final "environment ready" panel at the end of setup.sh, replacing the old plain
// printf/cat block. Actual health status comes from setup.sh's own step results (all of which
// must have passed for this script to be reached), so everything below is shown as ✓.
import { printSetupComplete } from '../lib/success.mjs';

printSetupComplete({
  env: {
    Node: true,
    Docker: true,
    'Proof Server': true,
    Indexer: true,
    'Midnight Node': true,
  },
  frontendUrl: undefined,
});

console.log('Local stack running: node (:9944), indexer (:8088), proof-server (:6300)\n');
console.log('More next steps:');
console.log('  npm run contracts:deploy -- --network preview     # deploy the contract (preview or preprod)');
console.log('  npm run doctor                                    # re-run health checks any time');
console.log('  npm run docker:stop                               # stop the local stack');
console.log('  npm run docker:reset                              # stop and wipe local chain state\n');
console.log('See README.md for the full walkthrough, SETUP-AGENT.md for the agent-facing operational playbook.');
