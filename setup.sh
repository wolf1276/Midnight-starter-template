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

# Print the failing message(s) then exit 1, always pointing at `npm run doctor` as the
# general-purpose next step for diagnosing whatever's still broken.
die() {
  for msg in "$@"; do err "$msg"; done
  err "Once fixed, you can also run 'npm run doctor' to check everything at once."
  exit 1
}

REQUIRED_NODE_MAJOR=24
TOTAL_STEPS=9

# --- 0/9: Baseline tooling (git, curl) --------------------------------------
if ! command -v git >/dev/null 2>&1; then
  die "git is required but was not found on PATH." "Install it: https://git-scm.com/downloads"
fi
if ! command -v curl >/dev/null 2>&1; then
  die "curl is required but was not found on PATH." "Install it via your OS package manager (e.g. apt install curl, brew install curl)."
fi

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
  die \
    "Running under native Windows bash (Git Bash/MSYS). This repo's tooling (Docker Compose" \
    "healthchecks, Compact installer) targets Linux/macOS. Install WSL2 and re-run this script" \
    "from inside a WSL2 distro: https://learn.microsoft.com/windows/wsl/install"
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
# Check the usual nvm locations (default install, Homebrew on macOS, XDG-style) plus
# common alternative version managers, in case NVM_DIR isn't set in this shell.
find_nvm_sh() {
  for candidate in \
    "${NVM_DIR:-}/nvm.sh" \
    "$HOME/.nvm/nvm.sh" \
    "/usr/local/opt/nvm/nvm.sh" \
    "/opt/homebrew/opt/nvm/nvm.sh" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/nvm/nvm.sh"
  do
    [ -n "$candidate" ] && [ -s "$candidate" ] && { echo "$candidate"; return 0; }
  done
  return 1
}

if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version | tr -d 'v')"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    err "Node.js >= ${REQUIRED_NODE_MAJOR} required, found $NODE_VERSION."
    NVM_SH="$(find_nvm_sh || true)"
    if [ -n "$NVM_SH" ]; then
      warn "nvm detected (${NVM_SH}) — attempting to install/use Node ${REQUIRED_NODE_MAJOR}..."
      # shellcheck disable=SC1090
      . "$NVM_SH"
      nvm install "$REQUIRED_NODE_MAJOR" >/dev/null
      nvm use "$REQUIRED_NODE_MAJOR" >/dev/null
      ok "Now using Node.js $(node --version)"
    elif command -v fnm >/dev/null 2>&1; then
      warn "fnm detected — attempting to install/use Node ${REQUIRED_NODE_MAJOR}..."
      fnm install "$REQUIRED_NODE_MAJOR" && eval "$(fnm env)" && fnm use "$REQUIRED_NODE_MAJOR"
      ok "Now using Node.js $(node --version)"
    elif command -v volta >/dev/null 2>&1; then
      warn "volta detected — attempting to pin Node ${REQUIRED_NODE_MAJOR}..."
      volta install "node@${REQUIRED_NODE_MAJOR}"
      ok "Now using Node.js $(node --version)"
    else
      die "Install Node.js >= ${REQUIRED_NODE_MAJOR} (https://nodejs.org), nvm, fnm, or volta, then re-run ./setup.sh"
    fi
  else
    ok "Node.js $NODE_VERSION"
  fi
else
  die "Node.js not found. Install Node.js >= ${REQUIRED_NODE_MAJOR} from https://nodejs.org, then re-run ./setup.sh"
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
  err "Once fixed, you can also run 'npm run doctor' to check everything at once."
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker not found."
  if [ "$OS_KIND" = "linux" ] && [ -n "$PKG_MGR" ] && [ "$(id -u)" -eq 0 -o -n "${SUDO_AVAILABLE:-}" ] && command -v sudo >/dev/null 2>&1; then
    warn "Attempting automatic install via Docker's official convenience script (requires sudo)..."
    if curl -fsSL https://get.docker.com | sudo sh; then
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      # Group membership only takes effect in new sessions. Re-exec the rest of this script
      # under the new group via `sg` so the user doesn't have to log out/in and re-run by hand.
      if command -v sg >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
        warn "Added $USER to the docker group. Re-launching setup under that group (no logout needed)..."
        exec sg docker -c "$0 $*"
      else
        warn "Docker installed. Added $USER to the docker group — log out/in (or run 'newgrp docker')"
        warn "for it to take effect if 'docker info' below still fails."
      fi
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
  case "$OS_KIND" in
    macos)   die "Docker CLI is installed but the daemon is not running/reachable." "Start Docker Desktop (open -a Docker), wait for it to finish starting, then re-run." ;;
    wsl)     die "Docker CLI is installed but the daemon is not running/reachable." "Start Docker Desktop on Windows and ensure WSL2 integration is enabled, then re-run." ;;
    linux)   die "Docker CLI is installed but the daemon is not running/reachable." "Start the daemon: sudo systemctl start docker (and 'sudo systemctl enable docker' to persist), then re-run." ;;
    *)       die "Docker CLI is installed but the daemon is not running/reachable." "Start the Docker daemon for your platform, then re-run." ;;
  esac
fi
ok "Docker daemon is running"

# Docker Desktop on macOS/Windows defaults to a VM with limited memory, which is too little
# for node + indexer + proof-server (+ web) running together. Warn, don't block — some setups
# report memory info differently and a false negative shouldn't stop the whole script.
DOCKER_MEM_MB="$(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{printf "%d", $1/1024/1024}')"
RECOMMENDED_MEM_MB=4096
if [ -n "$DOCKER_MEM_MB" ] && [ "$DOCKER_MEM_MB" -gt 0 ] 2>/dev/null; then
  if [ "$DOCKER_MEM_MB" -lt "$RECOMMENDED_MEM_MB" ]; then
    warn "Docker has ${DOCKER_MEM_MB}MB of memory allocated; ${RECOMMENDED_MEM_MB}MB+ is recommended for"
    warn "node + indexer + proof-server. On Docker Desktop: Settings → Resources → Memory."
  else
    ok "Docker memory allocation: ${DOCKER_MEM_MB}MB"
  fi
fi

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose plugin found"
else
  die \
    "Docker Compose v2 plugin not found. Update Docker to a version that bundles 'docker compose'" \
    "(Docker Desktop includes it; on Linux install the 'docker-compose-plugin' package)."
fi

# --- Compact toolchain -----------------------------------------------------
if ! command -v compact >/dev/null 2>&1; then
  warn "Compact CLI not found. Installing via the official installer..."
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/midnightntwrk/compact/main/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
  if ! command -v compact >/dev/null 2>&1; then
    die "Automatic install failed. Install manually: https://docs.midnight.network/develop/tutorial/using/compact"
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
if [ ! -f "docker/.env" ] || ! grep -q '^INDEXER_SECRET=.\+' "docker/.env" 2>/dev/null; then
  # 32 random bytes hex-encoded — dev-only secret to satisfy the indexer's config schema,
  # unique per machine instead of the fixed value every clone of this repo used to share.
  printf 'INDEXER_SECRET=%s\n' "$(openssl rand -hex 32 2>/dev/null || node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')" > docker/.env
  ok "Generated docker/.env with a unique dev secret for the indexer"
else
  ok "docker/.env already exists (left untouched)"
fi

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

wait_for "node" "http://localhost:9944/health" 1 || die "Node did not become healthy — see log command above."
wait_for "indexer" "http://localhost:8088" 0 || warn "Indexer not yet reachable — it may still be catching up; check 'docker compose -f docker/docker-compose.yml ps'"

if curl -sf "http://localhost:6300" >/dev/null 2>&1 || nc -z localhost 6300 >/dev/null 2>&1; then
  ok "proof-server reachable on :6300"
else
  warn "proof-server did not respond on :6300 yet — check 'docker compose -f docker/docker-compose.yml logs proof-server'"
fi

step "9/${TOTAL_STEPS} Running full health checks"
npm run doctor || die "Some checks failed — see above. Fix them, then re-run: npm run doctor"

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
