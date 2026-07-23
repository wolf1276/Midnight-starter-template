# Bulletin Board — Midnight Network (Next.js)

A privacy-preserving bulletin board dApp on [Midnight Network](https://midnight.network), rebuilt as a
production-ready Next.js 15 (App Router) application. Anyone can deploy a board, post one message to it,
and take it down again — the underlying Compact contract enforces that only the poster can remove their
own message, without revealing who anyone is on-chain.

This package (`web`) is a from-scratch Next.js port of the project's original Vite/MUI frontend. It keeps
the exact same contract, API, and wallet-connector logic, but restructures the app around clean
service/config layers so it's easy to read, extend, and deploy.

## Features

- Deploy a new bulletin board contract, or join an existing one by contract address
- Post a message (locks the board to you) and take it down again (unlocks it)
- Wallet connection via the Midnight DApp Connector API (Lace, 1AM, or any compatible extension)
- Zero server-side secrets — proving, indexing and wallet config all come from the connected wallet

## Architecture

```
src/
  app/                    Next.js App Router: layout, page, loading/error states
  components/
    ui/                   Small style-agnostic primitives (Button, Card, Dialog, Skeleton, IconButton)
    layout/               Header, MainLayout — page chrome
    board/                 Board, BoardEmptyContent, TextPromptDialog — feature UI
    providers/             AppProviders, BoardProvider, ErrorBoundary — client-side context tree
  hooks/                  useDeployedBoardContext
  services/midnight/      All Midnight SDK access. The UI never imports the SDK directly.
    wallet.ts              Wallet discovery + connection (window.midnight)
    providers.ts           Builds the BBoardProviders (proof/indexer/private-state/wallet/midnight)
    board-manager.ts       BrowserDeployedBoardManager — deploy/join lifecycle as observables
    in-memory-private-state-provider.ts
    types.ts               BoardDeployment, DeployedBoardAPIProvider
  config/                 environment.ts (zod-validated env), network.ts, constants.ts
  lib/                    logger, browser polyfills, cn()/formatting utils
```

**Rule of thumb:** if a file imports anything from `@midnight-ntwrk/*`, it lives in `services/midnight/`.
Components and pages only ever talk to `useDeployedBoardContext()` and the types in `services/midnight`.

## Tech stack

Next.js 15 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · ESLint · Prettier ·
Zod · rxjs · lucide-react

## Getting started

From the repo root, `./setup.sh` handles all of this automatically (see the root `README.md`).
To do it manually:

```bash
# from the repo root — this app is part of the npm workspace
npm install
npm run build:contract   # compiles the Compact contract and its TS bindings
npm run build -w @midnight-ntwrk/bboard-api

cp web/.env.example web/.env.local
npm run dev   # or: npm run dev -w @midnight-ntwrk/bboard-web
```

Then open http://localhost:3000. You'll need a Midnight-compatible wallet extension (e.g. Lace) installed
and configured for the same network as `NEXT_PUBLIC_NETWORK_ID` to deploy or join a board.

## Environment variables

See [`.env.example`](./.env.example). Only two variables exist:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_NETWORK_ID` | The Midnight network this app targets (`preprod`, `preview`, `testnet`, `mainnet`, `devnet`, `undeployed`). Must match your wallet's network. |
| `NEXT_PUBLIC_LOGGING_LEVEL` | Log verbosity for the in-browser logger (`trace`…`silent`). |

Indexer, indexer-websocket and proof-server endpoints are **not** configured here — they're supplied at
runtime by the connected wallet extension (`connectedAPI.getConfiguration()`), so the same build works
against whichever network the user's wallet is pointed at.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run ci` | typecheck + lint + build, in that order |
| `npm run clean` | Remove `.next`, `out`, and the local build cache |

## Known build warnings

`next build` prints two harmless warnings about WASM modules using `async/await` under
`asyncWebAssembly`. These come from the Midnight ZK/ledger WASM bindings and don't affect correctness in
any evergreen browser — top-level await and async WASM instantiation are supported everywhere this app is
expected to run.

## Deploying

This is a standard Next.js app — deploy it however you deploy Next.js:

- **Vercel / Netlify**: point the project root at `web/`, build command `npm run build`, no
  server-side secrets required.
- **Docker / self-hosted Node**: use the root `Dockerfile`'s `prod` target —
  `docker build --target prod -t bboard-web:prod .` from the repo root — which builds the
  standalone Next.js output. This app has no server-only environment variables to inject.

Whichever platform you use, make sure `NEXT_PUBLIC_NETWORK_ID` is set at build time and matches the
network your users' wallets are configured for.

## Contributing

This package follows the same contribution and licensing terms as the rest of the monorepo — see the
root [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`LICENSE`](../LICENSE).
