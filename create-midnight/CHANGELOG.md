# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-24

### Added

- Interactive CLI (`npx create-midnight my-app`) with prompts for project name,
  default network (Preview/Preprod), Git initialization, dependency installation,
  and project setup.
- Non-interactive flags for scripting/CI: `--network`, `--git`/`--no-git`,
  `--install`/`--no-install`, `--setup`/`--no-setup`, `--use-npm`/`--use-pnpm`/
  `--use-yarn`/`--use-bun`, `-y`/`--yes`, `--verbose`.
- Version-locked template downloads: each CLI release scaffolds from the matching
  Git tag of the starter template repository, never from `main`, for reproducible
  project generation. `--ref` available for development-only overrides.
- Template registry supporting multiple named templates via `--template`.
- Typed error system with friendly messages and recovery suggestions; stack traces
  hidden unless `--verbose` is passed.
- Automatic package manager detection (npm/pnpm/yarn/bun) with manual override flags.
- Git repository initialization with an initial commit.
- Optional post-install project setup (`npm run setup`) with Docker/Proof Server
  bootstrap and health checks.
- Automated test suite (offline fixture-based CLI integration tests, version-lock
  unit tests, and an opt-in real-network test path).

[1.0.0]: https://github.com/wolf1276/Midnight-starter-template/releases/tag/create-midnight%401.0.0
