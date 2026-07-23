# Architecture & Project Structure

```
Wallet extension (Lace / 1AM)
        │  DApp Connector API
        ▼
web/  (Next.js frontend) ──uses──▶ api/  (shared BBoardAPI, provider wiring)
        │                                  ▲
        │ indexer (GraphQL)                │ imports
        ▼                                  │
Midnight network (preview/preprod/devnet) ──┘── contracts/ (Compact source, compiled artifacts)

cli/  — headless deploy/interact tool, shares api/ and contracts/, used by scripts/deploy/deploy.mjs
```

- The wallet extension supplies indexer/proof-server/node endpoints at runtime
  (`connectedAPI.getConfiguration()`), so the same web build works unmodified against whichever
  network the user's wallet is configured for.
- The CLI's deploy path (`scripts/deploy/deploy.mjs` → `cli/src/launcher/deploy.ts`) uses
  `testkit-js`'s `RemoteTestEnvironment` to provision an ephemeral wallet + proof server, fund it
  from the network faucet, and deploy — no persistent CLI-side wallet state.

## Project Structure

```
├── contracts/          # Compact smart contract source, compiled artifacts, tests
├── api/                # Shared types and the BBoardAPI class (used by cli/ and web/)
├── cli/                # Command-line deployment/interaction tool
├── web/                # Next.js frontend (App Router)
├── docker/             # docker-compose.yml (full local dev stack) + Dockerfile targets
├── docs/               # Additional documentation (changelog, etc.)
├── scripts/
│   ├── deploy/         # deploy.mjs — end-to-end deploy orchestration
│   ├── docker/         # proof-server compose files used by testkit-js during deploy
│   └── doctor.mjs      # environment health check
├── setup.sh            # one-command zero-config bootstrap
├── .env.example         # documents every env var across workspaces
└── deployment.json      # generated after your first deploy (gitignored)
```

## Updating the Contract

1. Edit `contracts/src/bboard.compact`
2. `npm run contracts:build` (recompiles and regenerates types)
3. `npm run contracts:test` (runs the vitest suite against the new contract)
4. `npm run contracts:deploy -- --network preview` (re-deploy; `web/.env.local` updates automatically)

## Implementation Notes

- **Transaction fee configuration**
  The default `additionalFeeOverhead` value (`500_000_000_000_000_000n`) from `@midnight-ntwrk/testkit-js` is required on the `undeployed` network. Lower values can fail with `BalanceCheckOverspend` on the node side. On remote networks, that overhead requires too much dust, so the CLI overrides it to `1_000n`.
- CLI private state is stored per contract address, matching the `Midnight.js 4.x` private-state provider model.
- CLI and web UI can run simultaneously and share the same network/indexer.
- The proof server is required by both CLI and UI to generate zero-knowledge proofs.
