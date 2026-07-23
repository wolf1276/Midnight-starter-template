# Bulletin Board DApp

The official Midnight Network Next.js starter kit — a zero-config template for building and
deploying privacy-preserving smart contracts on [Midnight](https://midnight.network/).

[![Generic badge](https://img.shields.io/badge/Compact%20Compiler-0.30.0-1abc9c.svg)](https://shields.io/)
[![Generic badge](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://shields.io/)

> **Use this repo as a template. Do not fork it.**
>
> This repository is intended to be used via GitHub's "Use this template" flow.
> Forking this repo is discouraged, as forks are not tracked as independent projects.

A Midnight smart contract example demonstrating a simple one-item bulletin board with
zero-knowledge proofs. Users can post a single message at a time, and only the message
author can remove it. Use it as-is, or as the starting point for your own dApp.

## Prerequisites

Only two things are truly unavoidable — everything else, `./setup.sh` installs for you:

| Tool | Why it can't be automated |
|------|---------------------------|
| [Docker](https://docs.docker.com/get-docker/) | Runs the Midnight node, indexer, and proof server — can't be installed from inside a script safely on every OS |
| [Git](https://git-scm.com/) | You already have this if you cloned the repo |

`setup.sh` handles Node.js (>= 24), the Compact compiler toolchain, npm dependencies, env files,
contract compilation, and git hooks.

## Quick Start

```bash
git clone <this-repo-url>
cd example-bboard
./setup.sh          # or: npm run setup
```

That's it. `./setup.sh` will:

1. Verify/install Node.js >= 24 (via `nvm` if available)
2. Verify Docker is installed and the daemon is running
3. Install the Compact CLI + compiler toolchain if missing
4. Run `npm install` across all workspaces
5. Create `web/.env.local` from `web/.env.example`
6. Compile the contract and build the CLI
7. Install git hooks (pre-commit lint)
8. Run `npm run doctor` as a final health check and print a ready/not-ready summary

Then:

```bash
npm run dev                              # start the Next.js frontend at http://localhost:3000
npm run contracts:deploy -- --network preview   # deploy the contract (preview or preprod)
```

Open http://localhost:3000 with the Lace or 1AM wallet extension installed.

## Everyday Commands

| Command | What it does |
|---|---|
| `npm run setup` | Full zero-config bootstrap (see above) |
| `npm run doctor` / `npm run verify` | Health-check the whole toolchain; prints ✅/❌ per item |
| `npm run dev` | Start the Next.js dev server (`web/`) |
| `npm run test` | Run tests across every workspace |
| `npm run clean` | Remove `node_modules`, build output, and `.next` cache |
| `npm run contracts:build` | Compile the Compact contract |
| `npm run contracts:test` | Run the contract's vitest suite |
| `npm run contracts:deploy -- --network <preview\|preprod>` | Compile, deploy, save the address, update `web/.env.local` |
| `npm run docker:start` | Bring up the full stack in Docker (node, indexer, proof server, web) |
| `npm run docker:stop` | Stop the Docker stack |
| `npm run docker:reset` | Stop the stack and drop its volumes (fresh chain state) |
| `npm run blockchain:start` | Start only node + indexer + proof server (no web container) |
| `npm run blockchain:reset` | Remove the blockchain service containers |

## Contract Deployment

```bash
npm run contracts:deploy -- --network preview   # or --network preprod
```

This single command:

1. Verifies Node, Docker, and Compact are ready
2. Compiles the contract if not already built
3. Builds the CLI if not already built
4. Spins up an ephemeral proof server, creates a wallet, requests faucet funds, and generates DUST
5. Deploys the contract
6. Writes a record (network, contract address, indexer/node URLs, timestamp) to `deployment.json`
7. **Automatically patches `web/.env.local`** with `NEXT_PUBLIC_CONTRACT_ADDRESS` — no manual copying

`deployment.json` is a local, gitignored history of your deploys from this machine — not shared
state. There is no public block explorer for Midnight preview/preprod at the time of writing; use
the printed indexer URL to inspect on-chain contract state via GraphQL.

## Interactive CLI (Post-Deploy)

```bash
cd cli
npm run preview-remote    # interactive mode for preview
npm run preprod-remote    # interactive mode for preprod
```

## Docker Setup

`docker/docker-compose.yml` defines the full local stack: `node`, `indexer`, `proof-server`, and a
`web` service (built from the root `Dockerfile`'s `dev` target with hot reload via bind mount).

```bash
npm run docker:start   # equivalent to: docker compose -f docker/docker-compose.yml --profile web up -d --build
```

Fixed host ports: node `9944`, indexer `8088`, proof server `6300`, web `3000`.

The root `Dockerfile` also has a `prod` target producing a minimal standalone Next.js image:

```bash
docker build --target prod -t bboard-web:prod .
docker run -p 3000:3000 bboard-web:prod
```

This is separate from the ephemeral, testcontainers-managed proof server that
`npm run contracts:deploy` spins up per-run (`scripts/docker/proof-server*.yml`) — that one is
managed automatically by the deploy pipeline and needs no manual Docker commands.

## Updating the Contract

1. Edit `contracts/src/bboard.compact`
2. `npm run contracts:build` (recompiles and regenerates types)
3. `npm run contracts:test` (runs the vitest suite against the new contract)
4. `npm run contracts:deploy -- --network preview` (re-deploy; `web/.env.local` updates automatically)

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

## Environment Variables

All web-facing config lives in `web/.env.local` (copied from `web/.env.example` by `setup.sh`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_NETWORK_ID` | Network the frontend talks to: `undeployed \| devnet \| testnet \| preview \| preprod \| mainnet`. Must match your wallet extension's network. |
| `NEXT_PUBLIC_LOGGING_LEVEL` | In-browser pino log level: `fatal \| error \| warn \| info \| debug \| trace \| silent`. |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Set automatically by `npm run contracts:deploy` — safe to leave blank; the UI also lets you paste/select an address. |

See `.env.example` at the repo root for the full picture across workspaces. The CLI/deploy path
does not use env files — network selection is a `--network` flag, and per-network indexer/node
URLs live in `cli/src/config.ts`.

## Useful Links

- Get Testnet tNIGHT on the [Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/) or [Preview Faucet](https://midnight-tmnight-preview.nethermind.dev/)
- [Midnight Documentation](https://docs.midnight.network/examples/dapps/bboard) — complete developer guide
- [Compatibility Matrix](https://docs.midnight.network/relnotes/support-matrix) — current supported Midnight component versions
- [Compact Language Guide](https://docs.midnight.network/compact/writing) — smart contract language reference
- Get Lace wallet on the [Chrome Store](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk) or the [Edge Store](https://microsoftedge.microsoft.com/addons/detail/lace/efeiemlfnahiidnjglmehaihacglceia)

## Troubleshooting / FAQ

| Issue | Solution |
|---|---|
| `./setup.sh` fails on Node version | It attempts an `nvm install 24` automatically; without `nvm`, install Node >= 24 manually from https://nodejs.org |
| `npm run doctor` reports a failure | Each line names the exact fix (e.g. `run 'npm run contracts:build'`) — fix the ✘ items and re-run |
| Contract compilation fails | Ensure the Compact toolchain is installed (`compact list` should show a `*`); run `compact update` |
| "Application not authorized" error | Start the proof server: `npm run blockchain:start` |
| Lace/1AM wallet not detected | Install the wallet browser extension and refresh the page |
| Docker issues | Ensure the Docker daemon is running: `docker info`; `npm run doctor` checks this too |
| Port already in use (3000/6300/8088/9944) | `npm run docker:reset` to stop and clear containers, then retry |
| Contract deployment fails | Verify network connectivity; the deploy step auto-funds a fresh wallet from the network faucet, which can take 1–3 minutes |
| Dependencies won't install | Confirm Node >= 24 (`node --version`); older npm versions may need `--legacy-peer-deps` |

**Why isn't this using pnpm even though the commands read like `pnpm run x`?** The workspace is npm
workspaces under the hood (already configured, one lockfile); every command here also works
verbatim with `pnpm run <script>` if you prefer that CLI, since pnpm understands npm workspaces.

## Notes

- CLI and web UI can run simultaneously and share the same network/indexer.
- The proof server is required by both CLI and UI to generate zero-knowledge proofs.
- The contract must be compiled before building the CLI or UI (`npm run contracts:build`).
- `contracts:deploy` funds a fresh wallet from the network faucet automatically — no manual funding step.

## Implementation Notes

- **Transaction fee configuration**
  The default `additionalFeeOverhead` value (`500_000_000_000_000_000n`) from `@midnight-ntwrk/testkit-js` is required on the `undeployed` network. Lower values can fail with `BalanceCheckOverspend` on the node side. On remote networks, that overhead requires too much dust, so the CLI overrides it to `1_000n`.
- CLI private state is stored per contract address, matching the `Midnight.js 4.x` private-state provider model.
