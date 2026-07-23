# Troubleshooting / FAQ

---

## Setup

### `./setup.sh` fails on Node.js version

**What happened:** Node.js is older than version 24.

**Why:** This project requires Node.js >= 24 for its npm workspaces and ES module support.

**Fix:** If nvm is installed, `setup.sh` automatically installs and switches to the correct version.
Otherwise:
```
nvm install 24 && nvm use 24
./setup.sh
```
Or download from https://nodejs.org/

### Docker images pull is very slow

**What happened:** First-time setup downloads ~2 GB of Docker images (Midnight node, indexer,
proof server).

**Why:** This is a one-time download. Subsequent runs are instant.

**Fix:** Be patient — the `docker compose pull` step can take 2-5 minutes depending on your
internet connection. The script shows download progress while it runs.

### Compact compiler install fails

**What happened:** The `curl | sh` installer for the Compact CLI toolchain failed.

**Why:** Either `curl` is not installed, or the network is blocking
`raw.githubusercontent.com`.

**Fix:** Install `curl`, then retry `./setup.sh`. Or install manually:
```
curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/midnightntwrk/compact/main/install.sh | sh
```

---

## Environment Checks

### `npm run doctor` reports failures

**What happened:** One or more health checks failed (shown with `✗`).

**Why:** Various — each `✗` line names the exact issue.

**Fix:** Read the specific failure message — each one includes the command to fix it. Then
re-run `npm run doctor`.

Common failures:
- **"missing — run 'npm run contracts:build'"** — Contract artifacts not compiled. Run `npm run contracts:build`.
- **"missing — run 'npm run build:cli'"** — CLI not built. Run `npm run build:cli`.
- **"unreachable — run 'npm run blockchain:start'"** — Local Docker services not running. Run `npm run blockchain:start`.
- **"missing — run 'cp web/.env.example web/.env.local'"** — No environment file. Run `cp web/.env.example web/.env.local`.

### Docker daemon not reachable

**What happened:** `docker info` fails.

**Why:** The Docker daemon isn't running.

**Fix:**
- **macOS:** Open Docker Desktop (or run `open -a Docker`)
- **Windows/WSL2:** Start Docker Desktop and ensure WSL2 integration is enabled
- **Linux:** `sudo systemctl start docker && sudo systemctl enable docker`

Then re-run whatever command failed.

### Port already in use (3000, 6300, 8088, 9944)

**What happened:** One of the required ports is already occupied.

**Why:** Another service or a stale container is using the port.

**Fix:**
```
npm run docker:reset
npm run blockchain:start
```
This stops all containers and removes volumes (resets chain state — safe for dev).

---

## Contract Compilation

### Contract compilation fails

**What happened:** `compact compile` returns an error.

**Why:** Either the Compact toolchain isn't installed, or the source code has an error.

**Fix:**
1. Check `compact list` — it should show a `*` next to an installed version.
2. If no `*` is shown, run `compact update` to install a toolchain.
3. If the toolchain is installed, check the compiler error output for the specific line
   that failed.

### Stale build artifacts after changing the contract

**What happened:** Changes to `bboard.compact` aren't reflected in the deployed contract.

**Why:** Build artifacts are cached; `npm run contracts:build` must be re-run after edits.

**Fix:**
```
npm run clean
npm install
npm run build:all
```

---

## Contract Deployment

### Deployment hangs at "Waiting for funds"

**What happened:** The CLI is waiting for test tokens to arrive at the deployment wallet.

**Why:** The deployment wallet has a zero balance. The CLI automatically requests tokens from
the network faucet, but this can take 1-3 minutes. If the faucet is unreachable, the CLI
warns you within a few seconds and times out after 15 minutes.

**Fix:**
1. Check the funding screen output: it shows the wallet address and faucet URL.
2. Open the faucet URL in a browser:
   - **Preview:** https://midnight-tmnight-preview.nethermind.dev/
   - **Preprod:** https://midnight-tmnight-preprod.nethermind.dev/
3. Paste the displayed wallet address and request tokens.
4. Wait — the CLI detects funds automatically and continues.

If funds never arrive after 15 minutes:
1. Open the faucet URL manually and verify the address.
2. Check your internet connection.
3. Re-run the deployment:
   ```
   npm run contracts:deploy -- --network preview
   ```

### Deployment fails with "Could not reach the Midnight network"

**What happened:** The deploy script cannot connect to the Midnight node, indexer, or proof
server.

**Why:** Usually a network connectivity issue, or the proof server Docker container failed to
start.

**Fix:**
1. Check your internet connection.
2. If deploying to `preview` or `preprod`, the endpoints are hosted — verify they're
   reachable from your network.
3. Make sure Docker is running — the deploy uses an ephemeral Docker container for the
   proof server.
4. Re-run with `--verbose` to see the full error:
   ```
   npm run contracts:deploy -- --network preview --verbose
   ```

### Deployment fails with "Proof server is unavailable"

**What happened:** Docker cannot start the proof server container.

**Why:** Docker daemon is not running, or the proof server image is missing.

**Fix:**
1. Confirm Docker is running: `docker info`
2. Pull the proof server image: `docker pull midnightntwrk/proof-server:8.0.3`
3. Re-run the deployment.

### "DEPLOYMENT_RESULT" warning appears but deployment still works

**What happened:** The deploy script printed "⚠ Could not parse deployment result".

**Why:** The child deploy process printed output before the final JSON line, and the regex
didn't find the expected format.

**Fix:** This is usually harmless — the contract was deployed but the record wasn't saved to
`deployment.json`. To fix:
1. Check the output for the actual contract address.
2. Manually add it to `web/.env.local`:
   ```
   NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
   ```
3. Re-run the deployment to get a proper record.

### Deployment works but wallet can't connect in the browser

**What happened:** The frontend loads but the wallet extension doesn't connect.

**Why:** The `NEXT_PUBLIC_NETWORK_ID` in `web/.env.local` doesn't match the network your
wallet extension is configured for.

**Fix:**
1. Check `web/.env.local` — it defaults to `preprod`.
2. Change `NEXT_PUBLIC_NETWORK_ID` to match your wallet's network (e.g., `preview`).
3. Refresh the browser page (the wallet extension must be on the same network).

---

## Wallet & Browser

### Lace / 1AM wallet not detected

**What happened:** The app shows "Connect Wallet" but clicking does nothing.

**Why:** The wallet extension isn't installed, or the page needs a refresh.

**Fix:**
- Install [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk)
  or [1AM](https://1am.com/) from the Chrome Web Store.
- Refresh the page after installing.
- Ensure the wallet is configured for the Midnight network (not Cardano).

### Network mismatch between wallet and app

**What happened:** Wallet connects but shows 0 balance or "wrong network".

**Why:** The wallet extension is set to `preview` but `web/.env.local` has
`NEXT_PUBLIC_NETWORK_ID=preprod` (or vice versa).

**Fix:**
1. Check which network your wallet is configured for.
2. Set `NEXT_PUBLIC_NETWORK_ID` in `web/.env.local` to match.
3. Restart the dev server.

---

## General

### Dependencies won't install

**What happened:** `npm install` fails with peer dependency conflicts.

**Why:** Usually an older npm version or Node.js mismatch.

**Fix:**
1. Confirm Node >= 24: `node --version`
2. Delete `node_modules` and try again:
   ```
   npm run clean
   npm install
   ```

### "Application not authorized" error

**What happened:** The CLI or frontend shows "Application not authorized".

**Why:** The proof server is not reachable — it's needed to generate zero-knowledge proofs
for contract interactions.

**Fix:**
```
npm run blockchain:start
```
This starts the local node, indexer, and proof server containers.

---

## When All Else Fails

Reset the entire environment from scratch:
```
npm run clean
npm install
npm run build:all
npm run docker:reset
npm run blockchain:start
npm run doctor
```

If `npm run doctor` passes but the problem persists, file an issue at
https://github.com/midnightntwrk/example-bboard/issues with the output of `npm run doctor`
and a description of what you're trying to do.
