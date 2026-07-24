# Agent Notes

This is an npm-workspaces monorepo for the Midnight Network bulletin board dApp.

## Layout

| Path | What it is |
| --- | --- |
| `contracts/` | Compact smart contract source, compiled artifacts (`src/managed`), tests |
| `api/` | Shared types and the `BBoardAPI` class used by both `cli/` and `web/` |
| `cli/` | Command-line deployment/interaction tool |
| `web/` | Next.js frontend (App Router) |
| `infra/` | Build/ops tooling: `config/` (pinned versions), `docker/` (dev-stack compose), `patches/` (dependency patches), `scripts/` (setup, doctor, deploy, docker/blockchain lifecycle) |
| `infra/scripts/deploy/` | End-to-end deploy orchestration script (`deploy.mjs`) |
| `infra/scripts/docker/` | `docker:start/stop/reset` wrapper scripts |
| `infra/scripts/doctor.mjs` | Environment health check (`npm run doctor`) |
| `infra/docker/` | Full local dev-stack docker-compose (node/indexer/proof-server/web) |
| `docs/` | Additional documentation (changelog, etc.) |
| `setup.sh` | One-command zero-config bootstrap (`npm run setup`) |
| `deployment.json` | Generated after `npm run contracts:deploy` — gitignored, local history of deploys |

## Conventions

- Package manager is npm workspaces — use `npm run <script> -w <package-name>` (package names are
  `@midnight-ntwrk/bboard-contract`, `@midnight-ntwrk/bboard-api`, `@midnight-ntwrk/bboard-cli`,
  `@midnight-ntwrk/bboard-web`), not the folder path.
- `npm run build:contract` / `npm run build:cli` / `npm run build:all` at the repo root build the
  contract and CLI in the correct order.
- The web app's `@/*` TypeScript path alias resolves to `web/*` (flattened, no `src/` directory).
