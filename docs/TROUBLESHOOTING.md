# Troubleshooting / FAQ

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
