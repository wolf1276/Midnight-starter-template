# create-midnight

**Scaffold a production-ready [Midnight](https://midnight.network) dApp in seconds.**

[![npm version](https://img.shields.io/npm/v/create-midnight.svg)](https://www.npmjs.com/package/create-midnight)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)

One command. A complete Midnight development environment — smart contract, API layer, CLI tooling, Next.js frontend, local blockchain node, indexer, and proof server — all wired together and ready to run.

```bash
npx create-midnight my-app
```

---

## Features

| Feature | Details |
| --- | --- |
| **One-command scaffolding** | Project name to running app in a single `npx` call |
| **Midnight smart contracts** | Write privacy-preserving logic in [Compact](https://docs.midnight.network/), compiled and ready |
| **Local blockchain stack** | Dockerized Midnight node, indexer, and proof server — started automatically |
| **Smart setup** | Installs prerequisites, builds contracts, starts services, runs health checks |
| **Automatic validation** | `npm run doctor` verifies your entire environment in one pass |
| **Deployment tooling** | Deploy to Preview or Preprod networks with wallet and faucet handling built in |
| **TypeScript throughout** | Contract, API, CLI, and frontend — all typed, all connected |
| **Modern project structure** | npm workspaces, Next.js App Router, Turbopack, ESLint, Prettier |
| **Package manager choice** | npm by default; pnpm, Yarn, or Bun with a flag |
| **Version-locked templates** | Deterministic scaffolding — re-running an older CLI always produces the same project |
| **Git-ready** | Repository initialized with a pre-commit lint hook |
| **Doctor command** | Instant environment diagnostics with actionable fix suggestions |

---

## Quick Start

```bash
npx create-midnight my-app
```

That's it. The CLI will:

1. Ask for your project name and preferred network
2. Download the starter template
3. Install dependencies
4. Initialize a Git repository
5. Set up Docker, the proof server, and the local node
6. Run health checks to confirm everything works

**Expected output:**

```
$ npx create-midnight my-app

? Project name: my-app
? Default network: Preview
? Initialize Git repository? Yes
? Install dependencies? Yes
? Run project setup? Yes

✓ Downloaded template
✓ Installed dependencies
✓ Initialized Git repository
✓ Environment ready

  Your Midnight dApp is ready at ./my-app

  cd my-app
  npm run dev       # Start the frontend
  npm run deploy    # Deploy a contract
```

### Using with other package managers

```bash
npx create-midnight my-app --use-pnpm
npx create-midnight my-app --use-yarn
npx create-midnight my-app --use-bun
```

### Non-interactive usage

Skip all prompts with explicit flags — useful for CI and scripting:

```bash
npx create-midnight my-app \
  --network preview \
  --git \
  --install \
  --setup \
  --yes
```

---

## First Project

After scaffolding, your project is fully functional. Here's what happened under the hood:

### What setup does

| Step | What happens |
| --- | --- |
| **Prerequisites** | Checks for Node.js 24+, Docker, and the Compact CLI — installs what's missing |
| **Dependencies** | `npm install` across all workspaces (contracts, api, cli, web) |
| **Build** | Compiles the Compact contract, builds the API and CLI packages |
| **Environment** | Creates `web/.env.local` with your selected network |
| **Docker** | Pulls images and starts the Midnight node, indexer, and proof server |
| **Health checks** | Waits for all services to respond, then runs `npm run doctor` |
| **Git hooks** | Installs a pre-commit hook that runs linting |

### Ready to code

When setup completes, you have:

- **A running frontend** at [http://localhost:3000](http://localhost:3000)
- **A local blockchain node** at port `9944`
- **An indexer** (GraphQL API) at port `8088`
- **A proof server** at port `6300`

Install the [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk) or [1AM](https://1am.com/) wallet extension, and you're ready to deploy your first contract.

---

## Project Structure

```
my-app/
├── contracts/          # Compact smart contract + TypeScript witnesses + tests
│   ├── src/
│   │   ├── bboard.compact       # Contract source (Compact language)
│   │   ├── index.ts             # Compiled contract exports
│   │   └── witnesses.ts         # Private state witness functions
│   └── tests/                   # Contract test suite (Vitest)
├── api/                # Shared BBoardAPI class (deploy, post, takeDown)
│   └── src/
│       ├── index.ts             # API implementation
│       └── common-types.ts      # Shared types
├── cli/                # Command-line deployment and interaction tool
│   └── src/
│       ├── launcher/            # Entry points (deploy, standalone, preview, preprod)
│       ├── wallet-store.ts      # Persistent wallet seed storage
│       └── wallet-utils.ts      # Wallet sync and funding utilities
├── web/                # Next.js frontend (App Router + Turbopack)
│   ├── app/                     # Pages and layouts
│   ├── components/              # UI components
│   ├── services/midnight/       # Wallet and board management
│   └── config/                  # Environment and network configuration
├── infra/              # Build and operations tooling
│   ├── config/versions.json     # Pinned image versions and ports
│   ├── docker/                  # Docker Compose files
│   ├── patches/                 # Dependency patches
│   └── scripts/                 # Setup, deploy, doctor, docker lifecycle
├── setup.sh            # One-command zero-config bootstrap
├── Dockerfile          # Multi-stage build (dev + production targets)
└── package.json        # Workspace root (npm workspaces)
```

### Key directories

| Directory | Purpose |
| --- | --- |
| `contracts/` | Smart contract source in Compact, compiled artifacts, TypeScript witnesses, and tests |
| `api/` | Shared API layer used by both the CLI and the web frontend |
| `cli/` | Deployment tooling, wallet management, and interactive contract interaction |
| `web/` | Next.js 15 frontend with App Router, wallet integration, and board UI |
| `infra/` | Docker Compose, build scripts, deploy orchestration, and environment tooling |
| `infra/scripts/` | `doctor.mjs`, `deploy.mjs`, Docker lifecycle, and setup helpers |
| `infra/config/` | Single source of truth for pinned image versions and port assignments |

---

## Development Workflow

### Common commands

```bash
npm run setup        # Full environment bootstrap (idempotent — safe to re-run)
npm run doctor       # Check environment health
npm run dev          # Start the frontend dev server (Turbopack)
npm run deploy       # Deploy a contract to Preview or Preprod
npm run test         # Run tests across all workspaces
npm run build:all    # Build contract, API, and CLI in order
npm run wallet:reset # Reset your local deployment wallet
```

### What each command does

| Command | Description |
| --- | --- |
| `npm run setup` | Installs prerequisites, dependencies, builds contracts, starts Docker services, runs health checks. Fully idempotent. |
| `npm run doctor` | Verifies Node.js, Docker, ports, services, build artifacts, and configuration. Reports a health score with fix suggestions. |
| `npm run dev` | Starts the Next.js frontend at [localhost:3000](http://localhost:3000) with Turbopack hot reload. |
| `npm run deploy` | Builds the contract if needed, funds a wallet from the faucet, generates a ZK proof, and deploys to the selected network. |
| `npm run test` | Runs Vitest across all workspaces (contracts, api, cli, web). |
| `npm run build:all` | Compiles the Compact contract, then builds the API and CLI packages. |
| `npm run wallet:reset` | Clears the stored wallet seed so the next deploy creates a fresh wallet. |

### Docker lifecycle

```bash
npm run docker:start       # Start the full stack (node + indexer + proof-server + web)
npm run docker:stop        # Stop all containers (preserves volumes)
npm run docker:reset       # Stop everything and wipe local chain data

npm run blockchain:start   # Start node, indexer, and proof-server only
npm run blockchain:stop    # Stop blockchain services
npm run blockchain:reset   # Force-remove blockchain containers
```

---

## Doctor

Run `npm run doctor` to verify your entire environment. Doctor checks everything needed to build, run, and deploy.

### What Doctor checks

| Category | Checks |
| --- | --- |
| **Toolchain** | Node.js version (>= 24), npm, Docker CLI, Docker daemon, Docker Compose plugin, Docker memory (>= 4 GB), Compact CLI, Compact compiler toolchain, internet connectivity, disk space (>= 5 GB), filesystem permissions |
| **Build** | Contract artifacts compiled, CLI built, API package built, `web/.env.local` present, `node_modules` installed |
| **Services** | Local Docker services running (node, indexer, proof-server), Node RPC health (`:9944`), Indexer reachable (`:8088`), Proof server reachable (`:6300`) |
| **Environment** | Required ports free or owned by this project, Git hooks installed, indexer secret configured, pinned image versions match |

### Health score

Doctor outputs a health summary with a percentage score. A failing check includes:

- What was checked
- What went wrong
- The exact command to fix it

```bash
$ npm run doctor

Toolchain
  ✓ Node.js 24.11.1
  ✓ npm 10.9.0
  ✓ Docker CLI
  ✓ Docker daemon
  ✓ Docker Compose plugin
  ✓ Compact CLI
  ✓ Compact toolchain
  ✓ Internet
  ✓ Disk space
  ✓ Filesystem permissions

Build
  ✓ Contract compiled
  ✓ CLI built
  ✓ API built
  ✓ web/.env.local
  ✓ node_modules

Services
  ✓ Docker services running
  ✓ Node RPC healthy
  ✓ Indexer reachable
  ✓ Proof server reachable

Health: 100% — all checks passed
```

---

## Docker

The local development stack runs inside Docker containers. Everything is automatic — `setup.sh` and `npm run setup` handle pulling images, starting services, and waiting for health checks.

### Services

| Service | Image | Port | Purpose |
| --- | --- | --- | --- |
| **node** | `midnightntwrk/midnight-node` | `9944` | Midnight blockchain node (dev mode) |
| **indexer** | `midnightntwrk/indexer-standalone` | `8088` | Chain indexer with GraphQL API |
| **proof-server** | `midnightntwrk/proof-server` | `6300` | ZK proof generation server |
| **web** | Built from `Dockerfile` | `3000` | Next.js frontend (started with `--profile web`) |

### Automatic behavior

- **Startup:** Services start automatically during `npm run setup`. The node must be healthy before the indexer starts.
- **Cleanup:** `npm run docker:stop` tears down containers while preserving chain data. `npm run docker:reset` wipes everything.
- **Project isolation:** Each scaffolded project gets its own `COMPOSE_PROJECT_NAME`, so multiple Midnight projects can run side by side without container or network name collisions.
- **Port ownership:** Doctor verifies that ports are either free or owned by your project's Docker Compose stack — not just that something is listening.

---

## Deploying

Deploy your contract to a Midnight testnet with a single command.

### Networks

| Network | Purpose | Faucet |
| --- | --- | --- |
| **Preview** | Fast iteration, unstable state | [preview faucet](https://midnight-tmnight-preview.nethermind.dev/) |
| **Preprod** | Production-like testing | [preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/) |

### Deploy flow

```bash
npm run deploy
```

1. **Selects network** — prompts for Preview or Preprod (remembers your last choice)
2. **Ensures Docker** — starts Docker if it's not running, recovers from port conflicts
3. **Starts services** — brings up the local node, indexer, and proof server
4. **Builds** — compiles the contract and CLI if not already built
5. **Creates wallet** — generates or loads a local wallet from `contracts/.midnight/`
6. **Funds wallet** — requests tokens from the network faucet (waits up to 15 minutes if needed)
7. **Generates proof** — creates a ZK proof for the deploy transaction
8. **Deploys** — submits the transaction and verifies it on-chain
9. **Updates frontend** — writes the contract address to `web/.env.local`

After deployment, open [localhost:3000](http://localhost:3000) with the Lace or 1AM wallet extension to interact with your contract.

### Wallet management

```bash
npm run wallet:reset    # Clear stored wallet seed (next deploy creates a new wallet)
```

Wallet seeds are stored at `contracts/.midnight/{network}-wallet.json` with restricted permissions (`0o600`). These files are gitignored.

---

## Troubleshooting

### Node.js version

Doctor requires Node.js 24+. If you have an older version:

```bash
# Using nvm
nvm install 24
nvm use 24

# Using fnm
fnm install 24
fnm use 24

# Using volta
volta install node@24
```

`setup.sh` can also install Node.js automatically if nvm, fnm, or volta is already present.

### Docker not running

```bash
# macOS / Windows: open Docker Desktop
open -a Docker

# Linux (systemd)
sudo systemctl start docker
```

Then re-run `npm run doctor` to verify.

### Ports already in use

Doctor identifies which process holds the conflicting port. Common resolutions:

```bash
# Stop your own project's containers
npm run docker:stop

# Check what's using the port (replace 9944 with the conflicting port)
lsof -i :9944
kill <PID>
```

If another Midnight project is using the ports, Doctor will offer to stop it automatically.

### Faucet empty

Testnet faucets can run dry. If wallet funding fails:

- Wait a few minutes and retry
- Switch to a different network (`--network preview` vs `--network preprod`)
- Check the [Midnight Discord](https://discord.gg/midnight-network) for faucet status

### Permission issues

```bash
# Fix setup.sh permissions
chmod +x setup.sh

# Fix node_modules permissions (Linux)
sudo chown -R $(whoami) node_modules
```

### Docker Desktop

- Ensure Docker Desktop is running and shows "Engine running"
- Allocate at least 4 GB of memory in Docker Desktop Settings > Resources
- On macOS, ensure Virtualization Framework is enabled

---

## FAQ

**Do I need Docker?**

Yes. The local blockchain node, indexer, and proof server run as Docker containers. Docker Desktop (macOS/Windows) or Docker Engine (Linux) is required.

**Can I use Podman?**

Not yet. The tooling uses `docker compose` commands. Podman compatibility is planned.

**Why Node 24?**

Midnight's Compact compiler and the runtime toolchain require Node.js 24 or newer.

**How do I update a project?**

Re-run setup to get the latest compatible dependencies:

```bash
npm run setup
```

To upgrade to a new template version, compare your project against the latest template and merge changes manually — there's no built-in upgrade command yet.

**Can I deploy without Docker?**

No. Deployment requires the local proof server, which runs as a Docker container.

**How do I reset everything?**

```bash
npm run docker:reset     # Wipe local chain data
npm run wallet:reset     # Clear wallet seeds
rm -rf node_modules      # Remove installed dependencies
npm run setup            # Rebuild from scratch
```

**Which networks are supported?**

Preview (for fast iteration) and Preprod (for production-like testing). Mainnet support will be added when the network launches.

**How do I deploy a different contract?**

Replace `contracts/src/bboard.compact` with your own Compact source, update the witnesses in `contracts/src/witnesses.ts`, and re-run `npm run deploy`.

---

## Contributing

### Development setup

```bash
git clone https://github.com/wolf1276/Midnight-starter-template.git
cd Midnight-starter-template/create-midnight
npm install
npm run dev -- my-test-app --verbose
```

To test against a local template without hitting the network:

```bash
CREATE_MIDNIGHT_LOCAL_TEMPLATE=/path/to/template npm run dev -- my-test-app
```

### Running tests

```bash
npm run typecheck
npm run build
npm test

# Also exercise the real GitHub download path
CREATE_MIDNIGHT_TEST_NETWORK=1 npm test
```

### Architecture

```
src/
├── cli.ts          # Entry point: arg parsing + orchestration
├── prompts.ts      # Interactive prompts (@clack/prompts)
├── downloader.ts   # Template registry + version-locked ref resolution + download/extract
├── version.ts      # Reads the CLI's own version (drives the default template tag)
├── scaffold.ts     # Post-download project configuration
├── installer.ts    # Dependency installation
├── git.ts          # Git init + initial commit
├── setup.ts        # Runs the template's own `npm run setup`
├── errors.ts       # Typed errors + user-facing recovery messages
├── logger.ts       # Banner/section helpers
└── utils.ts        # Shell exec, package-manager detection, name validation
```

### Submitting PRs

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run typecheck && npm run build && npm test`
5. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full guidelines.

---

## License

[Apache 2.0](../LICENSE)
