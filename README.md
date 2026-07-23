# Midnight Starter Template

A privacy-preserving dApp starter for [Midnight Network](https://midnight.network/) — a bulletin
board where anyone can post a message, but only the author can remove it. Zero-knowledge proofs
enforce the rules on-chain without ever revealing who posted what.

Use this as the starting point for your own Midnight project: contract, API, CLI, and frontend
already wired together.

- **Zero-knowledge by default** — write rules in [Compact](https://docs.midnight.network/), get privacy for free
- **Full stack, ready to go** — smart contract, API layer, CLI, and Next.js frontend, all connected
- **One-command setup** — Docker services, proof server, and wallet handled for you

## Quick Start

```bash
git clone <this-repo-url>
cd example-bboard

./setup.sh      # installs deps, builds the contract, starts local services
npm run dev     # starts the frontend

cd contracts
npm run deploy  # deploys your first contract
```

Open http://localhost:3000 with the [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk)
or [1AM](https://1am.com/) wallet extension installed.

## Prerequisites

- [Git](https://git-scm.com/)
- [Docker](https://docs.docker.com/get-docker/)
- Node.js — `setup.sh` checks and installs this for you
- Windows — run `setup.sh` inside [WSL2](https://learn.microsoft.com/windows/wsl/install), not native PowerShell/Git Bash

## What `setup.sh` Does

- Installs dependencies across the workspace
- Builds the smart contract
- Starts local Docker services (node, indexer, proof server)
- Runs health checks to confirm everything is up
- Leaves you with a ready-to-develop environment

## Deploy Your First Contract

```bash
cd contracts
npm run deploy
```

This will:

1. Ask which network to deploy to
2. Create or load a local wallet automatically
3. Show funding instructions if your wallet balance is too low
4. Deploy the contract and save its address
5. Update the frontend configuration to point at your new deployment

## Daily Development

```bash
npm run dev

cd contracts
npm run deploy
```

## Common Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the frontend dev server |
| `npm run doctor` | Check your environment is set up correctly |
| `npm run test` | Run tests across the workspace |
| `npm run wallet:reset` | Reset your local wallet |

## Continuous Integration

Every push and pull request runs the `CI` workflow (`.github/workflows/ci.yaml`):

- **Build matrix** — lint, typecheck, build, and test the contract, API, CLI, and web workspaces
  on Ubuntu, macOS, and Windows in parallel (`fail-fast: false`, so one platform failing doesn't
  hide results from the others). Onboarding scripts (`setup.sh`, `scripts/**/*.mjs`) are also
  syntax-checked on every platform (the `setup.sh` check is skipped on Windows, where it isn't
  meant to run natively — see [Prerequisites](#prerequisites)).
- **Integration job** — runs only on Ubuntu, since it needs Docker. It builds the workspace,
  starts the local blockchain stack (node, indexer, proof server) with `npm run blockchain:start`,
  runs `npm run doctor` to verify the environment and services are healthy, then tears the stack
  down. No live testnet deployments or faucet funding happen in CI.
- Build output and Docker logs are uploaded as artifacts whenever a job fails, to make debugging
  CI failures easier without needing to reproduce locally.

## Documentation

- [What Is Midnight?](docs/WHAT_IS_MIDNIGHT.md) — background on the network and ZK model
- [Troubleshooting](docs/TROUBLESHOOTING.md) — fixes for common setup issues
- [AGENTS.md](AGENTS.md) — repo layout notes for AI coding agents
- [Official Midnight Documentation](https://docs.midnight.network/)
