# Agent Notes

This is an npm-workspaces monorepo for the Midnight Network bulletin board dApp.

## Layout

| Path | What it is |
| --- | --- |
| `contracts/` | Compact smart contract source, compiled artifacts (`src/managed`), tests |
| `api/` | Shared types and the `BBoardAPI` class used by both `cli/` and `web/` |
| `cli/` | Command-line deployment/interaction tool |
| `web/` | Next.js frontend (App Router) |
| `scripts/deploy/` | End-to-end deploy orchestration script |
| `scripts/docker/` | Proof server compose files used by the CLI/testkit |
| `docker/` | Standalone docker-compose setup |
| `docs/` | Additional documentation (changelog, etc.) |

## Conventions

- Package manager is npm workspaces — use `npm run <script> -w <package-name>` (package names are
  `@midnight-ntwrk/bboard-contract`, `@midnight-ntwrk/bboard-api`, `@midnight-ntwrk/bboard-cli`,
  `@midnight-ntwrk/bboard-web`), not the folder path.
- `npm run build:contract` / `npm run build:cli` / `npm run build:all` at the repo root build the
  contract and CLI in the correct order.
- The web app's `@/*` TypeScript path alias resolves to `web/*` (flattened, no `src/` directory).
