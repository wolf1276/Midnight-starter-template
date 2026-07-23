# Bulletin Board DApp

This project is built on the [Midnight Network](https://midnight.network/).

[![Generic badge](https://img.shields.io/badge/Compact%20Compiler-0.30.0-1abc9c.svg)](https://shields.io/)
[![Generic badge](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://shields.io/)


> **Use this repo as a template. Do not fork it.**
>  
> This repository is intended to be used via GitHub’s “Use this template” flow.  
> Forking this repo is discouraged, as forks are not tracked as independent projects.

A Midnight smart contract example demonstrating a simple one-item bulletin board with zero-knowledge proofs on testnet. Users can post a single message at a time, and only the message author can remove it.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | >= 24.11.1 | `node --version` |
| [Docker](https://docs.docker.com/desktop/) | Any recent | `docker --version` |
| [Compact Compiler](https://docs.midnight.network/develop/tutorial/using/compact) | Latest | `compactc --version` |

## Quick Start

```bash
# 1. Install dependencies (one time)
npm install

# 2. Deploy to preview network
npm run deploy --network preview
```

The deploy command will:
1. Verify all prerequisites (Node, Docker, Compact)
2. Compile the Compact smart contract
3. Build the CLI
4. Start the proof server in Docker
5. Create a wallet, request faucet funds, and generate DUST
6. Deploy the contract
7. Print the contract address — **save this for later**

**Note:** Step 5 waits for faucet funds. This can take 1-3 minutes.

## Interactive CLI (Post-Deploy)

```bash
cd cli
npm run preview-remote    # interactive mode for preview
npm run preprod-remote    # interactive mode for preprod
```

## Web UI

```bash
cd web
npm run dev
```
Open http://localhost:3000 with the Lace wallet extension installed.

## Project Structure

```
├── contracts/          # Compact smart contract source
├── api/                # Shared types and BBoardAPI class
├── cli/                # Command-line interface
├── web/                # Next.js web interface
├── docker/             # Docker compose files
├── docs/               # Additional documentation
└── scripts/            # Orchestration scripts (deploy/, docker/)
```

## Useful Links

- Get Testnet tNIGHT on [Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/) or [Preview Faucet](https://midnight-tmnight-preview.nethermind.dev/)
- [Midnight Documentation](https://docs.midnight.network/examples/dapps/bboard) - Complete developer guide
- [Compatibility Matrix](https://docs.midnight.network/relnotes/support-matrix) - Current supported Midnight component versions
- [Compact Language Guide](https://docs.midnight.network/compact/writing) - Smart contract language reference
- Get Lace wallet on the [Chrome Store](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk) or the [Edge Store](https://microsoftedge.microsoft.com/addons/detail/lace/efeiemlfnahiidnjglmehaihacglceia)

## Troubleshooting

| Common Issue                       | Solution                                                                                                  |
| ---------------------------------- |-----------------------------------------------------------------------------------------------------------|
| `npm install` fails                | Ensure you're using Node `v24.11.1` or newer. Older Node versions can install with warnings but are not the target runtime |
| Contract compilation fails         | Ensure the Compact toolchain is installed and run `npm run compact` from `contracts/`                     |
| Network connection timeout         | CLI requires internet connection, restart if connection times out                                         |
| Token funding takes too long       | Wait 1-2 minutes, funding is automatic in CLI                                                             |
| "Application not authorized" error | Start proof server: `docker compose -f scripts/docker/proof-server-local.yml up -d`                       |
| Lace wallet not detected           | Install Lace wallet browser extension and refresh page                                                    |
| Docker issues                      | Ensure Docker Desktop is running, check `docker --version`                                                |
| Port 6300 in use                   | Run `docker compose down` then restart services                                                           |
| Dependencies won't install         | Use Node.js LTS version. For older npm versions, you may need `--legacy-peer-deps`                        |
| Contract deployment fails          | Verify wallet has sufficient balance and network connection                                               |

## Notes

- CLI and UI can run simultaneously and share the same proof server
- Proof server (Docker) is required for both CLI and UI to generate zero-knowledge proofs
- Contract must be compiled before building CLI or UI
- Fund your wallet using the testnet faucet before deploying contracts

## Implementation Notes

- **Transaction fee configuration**  
  The default `additionalFeeOverhead` value (`500_000_000_000_000_000n`) from `@midnight-ntwrk/testkit-js` is required on the `undeployed` network. Lower values can fail with `BalanceCheckOverspend` on the node side. On remote networks, that overhead requires too much dust, so the CLI overrides it to `1_000n`.
- CLI private state is stored per contract address, matching the `Midnight.js 4.x` private-state provider model.
