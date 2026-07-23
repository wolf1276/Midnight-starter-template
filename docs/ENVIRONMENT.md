# Environment Variables

All web-facing config lives in `web/.env.local` (copied from `web/.env.example` by `setup.sh`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_NETWORK_ID` | Network the frontend talks to: `undeployed \| devnet \| testnet \| preview \| preprod \| mainnet`. Must match your wallet extension's network. |
| `NEXT_PUBLIC_LOGGING_LEVEL` | In-browser pino log level: `fatal \| error \| warn \| info \| debug \| trace \| silent`. |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Set automatically by `npm run contracts:deploy` — safe to leave blank; the UI also lets you paste/select an address. |

See `.env.example` at the repo root for the full picture across workspaces. The CLI/deploy path
does not use env files — network selection is a `--network` flag, and per-network indexer/node
URLs live in `cli/src/config.ts`.
