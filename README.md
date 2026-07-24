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
npx create-midnight my-app
cd my-app

npm run dev                       # starts the frontend
npm run deploy -- --network local # deploys to your local Midnight stack — no faucet, no internet required
```

`local` runs a fully self-contained Midnight node, indexer, and proof server via Docker, and
deploys against them using a pre-funded genesis wallet — the recommended way to build and test,
with nothing outside your machine in the loop.

Prefer cloning instead of scaffolding? Clone this template directly and run setup yourself:

```bash
git clone <this-repo-url>
cd example-bboard

./setup.sh      # installs deps, builds the contract, starts local services
npm run dev     # starts the frontend
npm run deploy -- --network local
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
npm run deploy
```

Run with no flags, this prompts you to pick a network — **Local** is the default and recommended
choice. It will:

1. Start the local Docker stack (node, indexer, proof server) if it isn't running
2. Use a pre-funded genesis wallet — no funding step, no faucet
3. Deploy the contract and save its address
4. Update the frontend configuration to point at your new deployment

You can also skip the prompt entirely:

```bash
npm run deploy -- --network local
```

### Deploying to Preview or Preprod (optional)

Preview and Preprod are Midnight's public testnets, useful once you want to test against
real network conditions or share a deployment with others:

```bash
npm run deploy -- --network preview   # public testnet, faucet available
npm run deploy -- --network preprod   # closest to mainnet
```

These use a persisted wallet funded from the network's public faucet, so deployment can be
blocked by faucet outages or public RPC downtime — local mode never has that dependency.

## Daily Development

```bash
npm run dev
npm run deploy -- --network local
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
  hide results from the others). Onboarding scripts (`setup.sh`, `infra/scripts/**/*.mjs`) are also
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
