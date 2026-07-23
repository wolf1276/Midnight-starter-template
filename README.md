# Bulletin Board DApp

The official Midnight Network Next.js starter kit — a zero-config template for building and
deploying privacy-preserving smart contracts on [Midnight](https://midnight.network/). A
one-item bulletin board with zero-knowledge proofs: post a message, only the author can remove it.

> **Use this repo as a template** via GitHub's "Use this template" flow — don't fork it.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Git](https://git-scm.com/)

Everything else (Node.js >= 24, the Compact compiler, npm dependencies) is installed by `./setup.sh`.

## Quick Start

```bash
git clone <this-repo-url>
cd example-bboard
./setup.sh
```

Then:

```bash
npm run dev                                     # start the frontend at http://localhost:3000
npm run contracts:deploy -- --network preview   # deploy the contract (preview or preprod)
```

Open http://localhost:3000 with the [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk) or 1AM wallet extension installed.

## Environment Setup

`setup.sh` creates `web/.env.local` from `web/.env.example`. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for variable details.

## Starting Docker

```bash
npm run docker:start   # full local stack: node, indexer, proof server, web
npm run docker:stop
```

See [docs/DOCKER.md](docs/DOCKER.md) for the production image and advanced usage.

## Building & Deploying Contracts

```bash
npm run contracts:build                          # compile the Compact contract
npm run contracts:deploy -- --network preview    # deploy and auto-patch web/.env.local
```

## Common Commands

| Command | What it does |
|---|---|
| `npm run doctor` | Health-check the whole toolchain |
| `npm run dev` | Start the Next.js dev server |
| `npm run test` | Run tests across every workspace |
| `npm run contracts:test` | Run the contract's vitest suite |
| `npm run clean` | Remove build output and caches |

## Troubleshooting

Docker not running, port conflicts, wallet not detected, deploy failures — see
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — project structure, data flow, implementation notes
- [docs/DOCKER.md](docs/DOCKER.md) — full Docker stack and production image
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common issues
- [docs/CHANGELOG.md](docs/CHANGELOG.md)
- [Midnight Documentation](https://docs.midnight.network/examples/dapps/bboard)
- [Compact Language Guide](https://docs.midnight.network/compact/writing)
- Testnet faucets: [Preprod](https://midnight-tmnight-preprod.nethermind.dev/) · [Preview](https://midnight-tmnight-preview.nethermind.dev/)
