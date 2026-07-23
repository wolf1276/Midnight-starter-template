#!/usr/bin/env bash
# Zero-config bootstrap for the Midnight bboard starter.
#
# Usage: ./setup.sh
#
# What it does:
#   1. Verify/guide install of Node.js, Docker, and the Compact toolchain.
#   2. npm install (root workspaces: contracts, api, cli, web).
#   3. Create web/.env.local from web/.env.example if missing.
#   4. Compile the contract and build the CLI/API workspaces.
#   5. Run `npm run doctor` as a final health check.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

ok()   { printf "${GREEN}✔${RESET} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${RESET} %s\n" "$1"; }
err()  { printf "${RED}✘${RESET} %s\n" "$1"; }
step() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

REQUIRED_NODE_MAJOR=24

step "1/6 Checking prerequisites"

# --- Node.js -----------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version | tr -d 'v')"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    err "Node.js >= ${REQUIRED_NODE_MAJOR} required, found $NODE_VERSION."
    if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
      warn "nvm detected — attempting to install/use Node ${REQUIRED_NODE_MAJOR}..."
      # shellcheck disable=SC1090
      . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
      nvm install "$REQUIRED_NODE_MAJOR" >/dev/null
      nvm use "$REQUIRED_NODE_MAJOR" >/dev/null
      ok "Now using Node.js $(node --version)"
    else
      err "Install Node.js >= ${REQUIRED_NODE_MAJOR} (https://nodejs.org) or nvm, then re-run ./setup.sh"
      exit 1
    fi
  else
    ok "Node.js $NODE_VERSION"
  fi
else
  err "Node.js not found. Install Node.js >= ${REQUIRED_NODE_MAJOR} from https://nodejs.org, then re-run ./setup.sh"
  exit 1
fi

# --- Docker --------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "Docker not found. Install Docker Desktop / Engine: https://docs.docker.com/get-docker/"
  exit 1
fi
ok "Docker CLI found"

if ! docker info >/dev/null 2>&1; then
  err "Docker daemon is not running. Start Docker and re-run ./setup.sh"
  exit 1
fi
ok "Docker daemon is running"

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose plugin found"
else
  err "Docker Compose plugin not found. Update Docker to a version that bundles 'docker compose'."
  exit 1
fi

# --- Compact toolchain -----------------------------------------------------
if ! command -v compact >/dev/null 2>&1; then
  warn "Compact CLI not found. Installing via the official installer..."
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/midnightntwrk/compact/main/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
  if ! command -v compact >/dev/null 2>&1; then
    err "Automatic install failed. Install manually: https://docs.midnight.network/develop/tutorial/using/compact"
    exit 1
  fi
fi
ok "Compact CLI $(compact --version 2>/dev/null | tail -n1)"

if ! compact list 2>/dev/null | grep -q '\*'; then
  warn "No Compact compiler toolchain installed yet — installing latest via 'compact update'..."
  compact update
fi
ok "Compact compiler toolchain ready"

step "2/6 Installing dependencies (npm workspaces: contracts, api, cli, web)"
npm install
ok "Dependencies installed"

step "3/6 Creating environment files"
if [ ! -f "web/.env.local" ]; then
  cp web/.env.example web/.env.local
  ok "Created web/.env.local from web/.env.example"
else
  ok "web/.env.local already exists (left untouched)"
fi

step "4/6 Compiling contract and building workspaces"
npm run build:all
ok "Contract and CLI built"

step "5/6 Installing git hooks"
if [ -d .git ]; then
  mkdir -p .git/hooks
  cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
npm run --silent lint --workspaces --if-present
HOOK
  chmod +x .git/hooks/pre-commit
  ok "Installed pre-commit hook (lint)"
else
  warn "Not a git repository — skipping git hooks"
fi

step "6/6 Running health checks"
npm run doctor || {
  err "Some checks failed — see above. Fix them, then re-run: npm run doctor"
  exit 1
}

printf "\n${GREEN}${BOLD}✅ Ready for development${RESET}\n\n"
cat <<EOF
Next steps:
  npm run dev              # start the Next.js frontend (web/)
  npm run contracts:deploy -- --network preview   # deploy the contract
  npm run doctor            # re-run health checks any time

See README.md for the full walkthrough.
EOF
