# Bulletin Board DApp

The official Midnight Network Next.js starter kit — a zero-config template for building and
deploying privacy-preserving smart contracts on [Midnight](https://midnight.network/).

This is a **one-item bulletin board**: anyone can post a message, but only the author can remove
it. Zero-knowledge proofs enforce the rules without revealing who anyone is on-chain.

> **Use this repo as a template** via GitHub's "Use this template" flow — don't fork it.

---

## Architecture

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

- **`contracts/`** — Compact smart contract source, compiled artifacts, tests
- **`api/`** — Shared types and `BBoardAPI` class (used by both CLI and web)
- **`cli/`** — Command-line deployment and interaction tool
- **`web/`** — Next.js 15 (App Router) frontend
- **`scripts/deploy/deploy.mjs`** — End-to-end deployment orchestrator

---

## Prerequisites

Install these yourself (one-time):

| Requirement | Minimum version | Install |
|---|---|---|
| [Docker](https://docs.docker.com/get-docker/) | Any (Compose v2) | Docker Desktop or Docker Engine |
| [Git](https://git-scm.com/) | Any recent | Your package manager or git-scm.com |

Everything else is installed automatically by `setup.sh`: Node.js (via nvm), the Compact compiler
toolchain, npm dependencies, and the Docker proof-server image.

---

## Quick Start

```bash
git clone <this-repo-url>
cd example-bboard
./setup.sh
```

`setup.sh` is a single, idempotent, 9-step bootstrap that takes you from zero to running local
blockchain services. It installs all prerequisites (Node.js, Docker when possible, Compact),
compiles the contract and CLI, starts a local Midnight node + indexer + proof server, and runs
a health check. Re-run it anytime to repair a broken environment.

**After setup completes you'll have:**

- A running local Midnight blockchain (`localhost:9944`)
- A local indexer (`localhost:8088`)
- A local proof server (`localhost:6300`)
- A compiled contract and built CLI/API
- A `web/.env.local` configuration file

---

## Start Developing

```bash
npm run dev                     # Start the frontend at http://localhost:3000
```

Then open http://localhost:3000 with the [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk)
or [1AM](https://1am.com/) wallet extension installed. The app detects your wallet's
network automatically.

---

## Deploy a Contract

```bash
npm run contracts:deploy -- --network preview
# or
npm run contracts:deploy -- --network preprod
```

### About the networks

| Network | Purpose | Faucet | Explorer |
|---|---|---|---|
| `preview` | Rapid iteration, frequent resets | [Preview Faucet](https://midnight-tmnight-preview.nethermind.dev/) | [Preview Explorer](https://explorer.preview.midnight.network/) |
| `preprod` | Staging, stable testnet | [Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/) | [Preprod Explorer](https://explorer.preprod.midnight.network/) |

The deployment script:

1. **Checks prerequisites** — Node.js, Docker, Compact toolchain, dependencies
2. **Builds what's needed** — compiles the contract and CLI if not already built
3. **Creates an ephemeral deployment wallet** — generates a fresh wallet, funds it from the
   network faucet if needed (the funding screen shows the wallet address and faucet URL)
4. **Deploys the contract** — submits the deploy transaction and waits for on-chain confirmation
5. **Saves the result** — appends a record to `deployment.json` and writes the contract address
   to `web/.env.local` automatically

**After deploy you'll have:**

- A live contract on the network
- Its address saved in `web/.env.local` for the frontend
- A record in `deployment.json` with explorer and indexer links

### Deploy output example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🚀 Midnight Contract Deployment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Node.js 24.18.0
  ✓ Docker is running
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦 Deploying to preview
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⏳ Starting environment... ✓
  ⏳ Creating deployment wallet... ✓
  ⏳ Checking wallet balance... ⚠ No funds yet

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💰 Wallet Funding Required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Network:         preview
  Funding Address: addr_preview1...
  Faucet:          https://midnight-tmnight-preview.nethermind.dev/

  Open the faucet, paste the address above, and request test tokens.
  Deployment continues automatically once funds arrive.

  ✓ Funds detected (balance: 100 tNIGHT)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📄 Deployment Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Network:         preview
  Contract:        0x...
  Explorer:        https://explorer.preview.midnight.network/contract/0x...
  Indexer:         https://indexer.preview.midnight.network/api/v4/graphql

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Deployment completed in 27.4s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If something goes wrong, re-run with `--verbose` for full diagnostic output:

```bash
npm run contracts:deploy -- --network preview --verbose
```

---

## Common Commands

| Command | What it does |
|---|---|
| `npm run setup` | Full bootstrap (idempotent) |
| `npm run doctor` | Health-check the whole toolchain |
| `npm run dev` | Start the Next.js dev server at `localhost:3000` |
| `npm run contracts:build` | Compile the Compact contract |
| `npm run contracts:deploy -- --network preview` | Deploy to preview testnet |
| `npm run contracts:deploy -- --network preprod` | Deploy to preprod testnet |
| `npm run contracts:test` | Run the contract's vitest suite |
| `npm run test` | Run tests across every workspace |
| `npm run docker:start` | Full local stack (node + indexer + proof server + web) |
| `npm run docker:stop` | Stop the Docker stack |
| `npm run docker:reset` | Stop and wipe local chain state |
| `npm run clean` | Remove build output and caches |

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — project structure, data flow, implementation notes
- [Docker](docs/DOCKER.md) — full Docker stack and production image
- [Environment Variables](docs/ENVIRONMENT.md) — `web/.env.local` reference
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common issues and fixes
- [Changelog](docs/CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Midnight Documentation](https://docs.midnight.network/examples/dapps/bboard)
- [Compact Language Guide](https://docs.midnight.network/compact/writing)
