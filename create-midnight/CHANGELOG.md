# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-07-24

### Fixed

- The version-locked template ref now includes the `docker-compose.yml` path
  fix from the starter template (previously only on `main`, not yet tagged).
  Fresh `npx create-midnight` scaffolds no longer hit a false "could not
  query compose state" failure during automatic setup, which forced users to
  manually re-run `npm run setup` even though nothing was actually broken.
- Includes the starter template's targeted Docker recovery improvements
  (port diagnostics, container reuse, safe cleanup of stale/orphaned
  project containers) from setup.

## [1.2.0] - 2026-07-24

### Changed

- Package manager selection no longer auto-detects or prompts. npm is used by
  default; pass `--use-bun`, `--use-pnpm`, or `--use-yarn` to opt into a
  different one. This removes the previous Bun → pnpm → Yarn → npm
  auto-detection and try-each-until-one-works fallback logic, making project
  creation faster and more predictable.

## [1.1.2] - 2026-07-24

### Fixed

- The completion screen's "Next steps" no longer prints a hardcoded
  `cd contracts` / `bun run dev` / `bun run deploy` workflow left over from an
  earlier project layout. It now reads the generated project's own
  `package.json` scripts (`dev`, `deploy`/`contracts:deploy`) and prints them
  with whichever package manager was actually selected (npm, pnpm, Yarn, or
  Bun), so the printed commands stay correct if the project layout changes
  again.

## [1.1.1] - 2026-07-24

### Fixed

- Generated projects no longer include `.github/workflows/create-midnight.yaml`,
  an internal CI workflow for the create-midnight CLI repo itself that
  referenced paths (`create-midnight/`, `dist/cli.js`) which don't exist in
  scaffolded projects.
- Generated projects no longer include `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  or `SUPPORT.md`, which document how to contribute to the upstream Midnight
  starter template repo and don't apply to a scaffolded application.

## [1.1.0] - 2026-07-24

### Changed

- Package manager selection now prioritizes reliability over mere availability:
  instead of committing to the first installed package manager (Bun → pnpm →
  Yarn → npm), the CLI verifies each candidate can actually install
  dependencies, run the project's `setup` script, and run the project's own
  scripts (via its `verify` script, when present) before committing to it. On
  any failure it cleans up that candidate's `node_modules`/lockfile and tries
  the next one automatically.
- If every package manager fails, the CLI prints a summary of what failed for
  each one and how to finish setup manually, instead of leaving a partially
  initialized project behind.
- The success screen's "Package Manager" field now reflects the package
  manager that actually completed initialization, not just the first one
  found on `PATH`.

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

[1.1.0]: https://github.com/wolf1276/Midnight-starter-template/releases/tag/v1.1.0
[1.0.0]: https://github.com/wolf1276/Midnight-starter-template/releases/tag/create-midnight%401.0.0
