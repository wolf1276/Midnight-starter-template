# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-24

First public release of the Midnight Starter Template — a full-stack, privacy-preserving
bulletin board dApp (contract, API, CLI, and Next.js frontend) meant to be scaffolded via
`create-midnight`.

### Added
- Zero-knowledge bulletin board contract (Compact) with post/remove-by-author rules
- Next.js frontend wired to the contract via a typed API layer and wallet provider
- One-command `setup.sh` bootstrap: prerequisite checks, dependency install, contract
  compilation, git hooks, Docker service startup, and RPC health verification
- `npm run doctor` environment/health checker covering prerequisites, build artifacts,
  local Docker services, and configuration
- Deployment script (`npm run deploy`) and wallet management (create/load/reset)
- Docker lifecycle management for the local node/indexer/proof-server stack, with
  pinned image versions and preflight checks (disk space, permissions, connectivity,
  Docker memory, port conflicts)
- `create-midnight` CLI support: version-locked template downloads, package manager
  detection, and CI coverage for scaffolding this template end-to-end

### Fixed
- CI now sets `NEXT_PUBLIC_NETWORK_ID` for the web build
- `infra/docker/.env` is generated before any compose command, with a unique per-machine
  indexer secret instead of a fixed value shared across clones
- `npm run doctor` no longer fails the git-hooks check on CI runners

[Unreleased]: https://github.com/wolf1276/Midnight-starter-template/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wolf1276/Midnight-starter-template/releases/tag/v1.0.0
