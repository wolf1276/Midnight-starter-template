#!/usr/bin/env bash
# One-command, idempotent bootstrap for the Midnight bboard starter.
#
# Usage: npm run setup   (or ./setup.sh directly)
#
# What it does:
#   1. Detect OS and verify/install prerequisites (Node.js, Docker, Compact toolchain).
#   2. npm install (root workspaces: contracts, api, cli, web).
#   3. Create web/.env.local from web/.env.example if missing.
#   4. Compile the contract and build the CLI/API workspaces (contract artifacts + type bindings).
#   5. Install git hooks.
#   6. Pull required Docker images and start the local dev stack (node, indexer, proof-server).
#   7. Verify RPC connectivity to node/indexer/proof-server.
#   8. Run `npm run doctor` as a final health check.
#   9. Print a success summary with the commands available next.
#
# Safe to re-run: every step only installs/configures what's missing.
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
TOTAL_STEPS=9

# --- 1/9: Detect OS --------------------------------------------------------
step "1/${TOTAL_STEPS} Detecting operating system"

OS_KIND="unknown"
case "$(uname -s)" in
  Linux*)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      OS_KIND="wsl"
    else
      OS_KIND="linux"
    fi
    ;;
  Darwin*) OS_KIND="macos" ;;
  CYGWIN*|MINGW*|MSYS*) OS_KIND="windows-native" ;;
  *) OS_KIND="unknown" ;;
esac

if [ "$OS_KIND" = "windows-native" ]; then
  err "Running under native Windows bash (Git Bash/MSYS). This repo's tooling (Docker Compose"
  err "healthchecks, Compact installer) targets Linux/macOS. Install WSL2 and re-run this script"
  err "from inside a WSL2 distro: https://learn.microsoft.com/windows/wsl/install"
  exit 1
fi
ok "Detected OS: ${OS_KIND}$( [ "$OS_KIND" = "wsl" ] && echo ' (Windows via WSL2)' )"

# Linux distro/package manager detection, used for guided/automatic Docker install below.
PKG_MGR=""
if [ "$OS_KIND" = "linux" ] || [ "$OS_KIND" = "wsl" ]; then
  if command -v apt-get >/dev/null 2>&1; then PKG_MGR="apt"
  elif command -v dnf >/dev/null 2>&1; then PKG_MGR="dnf"
  elif command -v yum >/dev/null 2>&1; then PKG_MGR="yum"
  elif command -v pacman >/dev/null 2>&1; then PKG_MGR="pacman"
  fi
fi

# --- 2/9: Prerequisites -----------------------------------------------------
step "2/${TOTAL_STEPS} Checking prerequisites"

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
install_docker_guided() {
  err "Docker could not be installed automatically on this system."
  case "$OS_KIND" in
    macos)
      err "Install Docker Desktop for Mac: https://docs.docker.com/desktop/install/mac-install/"
      err "  or, if you use Homebrew: brew install --cask docker (then launch Docker.app once)"
      ;;
    wsl)
      err "Install Docker Desktop for Windows with WSL2 integration enabled for this distro:"
      err "  https://docs.docker.com/desktop/wsl/"
      err "  (Docker Desktop requires Windows admin rights — this cannot be scripted from WSL.)"
      ;;
    linux)
      err "Install Docker Engine using your distro's official instructions:"
      err "  https://docs.docker.com/engine/install/"
      err "  This typically requires sudo/administrator privileges."
      ;;
    *)
      err "See https://docs.docker.com/get-docker/ for install instructions."
      ;;
  esac
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found."
  if [ "$OS_KIND" = "linux" ] && [ -n "$PKG_MGR" ] && [ "$(id -u)" -eq 0 -o -n "${SUDO_AVAILABLE:-}" ] && command -v sudo >/dev/null 2>&1; then
    warn "Attempting automatic install via Docker's official convenience script (requires sudo)..."
    if curl -fsSL https://get.docker.com | sudo sh; then
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      warn "Docker installed. You may need to log out/in (or run 'newgrp docker') for group"
      warn "membership to take effect before Docker works without sudo."
    else
      install_docker_guided
    fi
  else
    install_docker_guided
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  install_docker_guided
fi
ok "Docker CLI found ($(docker --version))"

if ! docker info >/dev/null 2>&1; then
  err "Docker CLI is installed but the daemon is not running/reachable."
  case "$OS_KIND" in
    macos)   err "Start Docker Desktop (open -a Docker), wait for it to finish starting, then re-run." ;;
    wsl)     err "Start Docker Desktop on Windows and ensure WSL2 integration is enabled, then re-run." ;;
    linux)   err "Start the daemon: sudo systemctl start docker (and 'sudo systemctl enable docker' to persist), then re-run." ;;
    *)       err "Start the Docker daemon for your platform, then re-run." ;;
  esac
  exit 1
fi
ok "Docker daemon is running"

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose plugin found"
else
  err "Docker Compose v2 plugin not found. Update Docker to a version that bundles 'docker compose'"
  err "(Docker Desktop includes it; on Linux install the 'docker-compose-plugin' package)."
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

step "3/${TOTAL_STEPS} Installing dependencies (npm workspaces: contracts, api, cli, web)"
npm install
ok "Dependencies installed"

step "4/${TOTAL_STEPS} Creating environment files"
if [ ! -f "web/.env.local" ]; then
  cp web/.env.example web/.env.local
  ok "Created web/.env.local from web/.env.example"
else
  ok "web/.env.local already exists (left untouched)"
fi

step "5/${TOTAL_STEPS} Compiling contract and building workspaces (artifacts + type bindings)"
npm run build:all
ok "Contract compiled, TypeScript bindings and CLI/API built"

step "6/${TOTAL_STEPS} Installing git hooks"
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

step "7/${TOTAL_STEPS} Pulling Docker images and starting the local dev stack (node, indexer, proof-server)"
warn "Pulling images (this can take a while on first run)..."
docker compose -f docker/docker-compose.yml pull node indexer proof-server
ok "Docker images pulled"

docker compose -f docker/docker-compose.yml up -d node indexer proof-server
ok "Containers started (node, indexer, proof-server)"

step "8/${TOTAL_STEPS} Waiting for services and verifying RPC connectivity"
# Waits for the HTTP server at $url to respond at all. `require_2xx=1` additionally requires a
# 2xx status (used for the node's /health endpoint); otherwise any HTTP response counts as
# "reachable" — e.g. the indexer legitimately 404s at "/" even when perfectly healthy.
wait_for() {
  local name="$1" url="$2" require_2xx="${3:-0}" tries=0 max=60 code
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    if [ "$require_2xx" = "1" ]; then
      [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 300 ] 2>/dev/null && break
    else
      [ "$code" != "000" ] && break
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge "$max" ]; then
      err "${name} did not become reachable at ${url} in time."
      err "Check logs with: docker compose -f docker/docker-compose.yml logs ${name}"
      return 1
    fi
    sleep 2
  done
  ok "${name} reachable at ${url} (HTTP ${code})"
}

wait_for "node" "http://localhost:9944/health" 1 || exit 1
wait_for "indexer" "http://localhost:8088" 0 || warn "Indexer not yet reachable — it may still be catching up; check 'docker compose -f docker/docker-compose.yml ps'"

if curl -sf "http://localhost:6300" >/dev/null 2>&1 || nc -z localhost 6300 >/dev/null 2>&1; then
  ok "proof-server reachable on :6300"
else
  warn "proof-server did not respond on :6300 yet — check 'docker compose -f docker/docker-compose.yml logs proof-server'"
fi

step "9/${TOTAL_STEPS} Running full health checks"
npm run doctor || {
  err "Some checks failed — see above. Fix them, then re-run: npm run doctor"
  exit 1
}

printf "\n${GREEN}${BOLD}✅ Setup complete — ready for development${RESET}\n\n"
cat <<EOF
Local stack running: node (:9944), indexer (:8088), proof-server (:6300)

Next steps:
  npm run dev                                      # start the Next.js frontend at http://localhost:3000
  npm run contracts:deploy -- --network preview     # deploy the contract (preview or preprod)
  npm run doctor                                    # re-run health checks any time
  npm run docker:stop                               # stop the local stack
  npm run docker:reset                              # stop and wipe local chain state

See README.md for the full walkthrough, SETUP-AGENT.md for the agent-facing operational playbook.
EOF
