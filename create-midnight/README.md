# create-midnight

Scaffold a production-ready [Midnight](https://midnight.network) DApp in seconds.

```bash
npx create-midnight my-app
# or
npm create midnight@latest my-app
```

Other common examples:

```bash
npx create-midnight my-app --network preview
npx create-midnight my-app --no-install
npx create-midnight my-app --verbose
```

## What it does

1. Prompts for a project name, default network (Preview or Preprod), and whether to
   initialize Git, install dependencies, and run project setup.
2. Downloads the official Midnight starter template, **version-locked** to this CLI
   release (see [Version locking](#version-locking) below).
3. Configures the project — renames `package.json`, writes `web/.env.local` for the
   selected network, and strips template-only files.
4. Installs dependencies with the fastest package manager available on your system
   (Bun → pnpm → Yarn → npm, in that order — see [Package manager
   detection](#package-manager-detection)), or the one forced via `--use-npm` /
   `--use-pnpm` / `--use-yarn` / `--use-bun`.
5. Initializes a Git repository with an initial commit.
6. Optionally runs `npm run setup` (installs/checks prerequisites, builds contracts,
   starts Docker + the Proof Server, and runs health checks).

## Non-interactive usage

All prompts can be skipped with flags, useful for CI or scripting:

```bash
npx create-midnight my-app \
  --network preview \
  --git \
  --install \
  --setup \
  --yes
```

| Flag | Description |
| --- | --- |
| `[project-name]` | Name of the project / target directory |
| `--template <name>` | Template to scaffold (default: `starter`) |
| `--network <network>` | `preview` or `preprod` |
| `--git` / `--no-git` | Initialize a git repository |
| `--install` / `--no-install` | Install dependencies |
| `--setup` / `--no-setup` | Run `npm run setup` after installation (requires `--install`) |
| `--use-npm` / `--use-pnpm` / `--use-yarn` / `--use-bun` | Force a package manager instead of auto-detecting |
| `--ref <ref>` | **Development only.** Override the version-locked template ref — see below |
| `-y, --yes` | Accept defaults for every prompt |
| `--verbose` | Print full error output for debugging |

## Package manager detection

`create-midnight` automatically picks the fastest package manager you have installed
— no manual configuration, no interactive prompt. It probes for each executable on
your `PATH`, in this priority order:

1. **Bun** — preferred when installed, since it installs dependencies and starts dev
   servers faster than the alternatives.
2. **pnpm**
3. **Yarn**
4. **npm** — always available (it ships with Node), so it's the guaranteed fallback.

Detection checks for the executable itself (e.g. `bun --version`), not for a
lockfile — the project doesn't exist yet at detection time. Whichever one is found
first is used for every subsequent command (`install`, `run setup`, `run dev`,
`run deploy`), and the CLI prints which one it picked:

```
✓ Using Bun
```

To skip auto-detection and force a specific package manager, pass one of
`--use-bun`, `--use-pnpm`, `--use-yarn`, or `--use-npm` — these always take
precedence over what's detected on your system.

If the detected (or forced) package manager fails unexpectedly during install or
setup, the CLI shows a friendly error with the manual command to retry, and — if
you're on Bun — suggests falling back to `--use-npm` or `--use-pnpm`. Stack traces
are hidden unless you pass `--verbose`.

## Version locking

Every published `create-midnight` release scaffolds from a specific Git tag of the
template repository, not from `main`. The tag is derived directly from the CLI's own
version:

```
create-midnight@1.2.0  →  wolf1276/Midnight-starter-template@v1.2.0
```

This makes project generation **deterministic and reproducible**: re-running an older
`create-midnight` version always produces the same starting point, and template
changes on `main` can never silently break a released CLI version.

If the matching tag doesn't exist in the template repository, the CLI fails loudly
instead of silently falling back to `main`:

```
✖ Compatible template version not found.

  Expected:   v1.2.0
  Repository: wolf1276/Midnight-starter-template
```

When this happens: upgrade `create-midnight` to a version whose tag exists, or (for
development only) pass `--ref` to bypass version locking entirely:

```bash
npx create-midnight my-app --ref main          # track the latest, unreleased template
npx create-midnight my-app --ref develop       # a feature branch
npx create-midnight my-app --ref v1.1.0        # an explicit different tag
```

`--ref` is **not** intended for end users scaffolding production apps — it trades away
the reproducibility guarantee above. `CREATE_MIDNIGHT_LOCAL_TEMPLATE` (see
[Local development](#local-development)) is unaffected by any of this and continues to
bypass ref resolution entirely, since it reads a template straight off disk.

## Templates

The CLI is not coupled to a single template. Additional templates can be registered
in `src/downloader.ts` (`TEMPLATE_REGISTRY`) and selected with `--template <name>`,
e.g. `--template contract` or `--template dashboard`, without changing any
download/scaffold/install logic. Every registered template is version-locked the same
way, against its own repository's tags.

## Local development

```bash
cd create-midnight
npm install
npm run dev -- my-test-app --verbose
```

To iterate without hitting the network, point at a local template checkout:

```bash
CREATE_MIDNIGHT_LOCAL_TEMPLATE=/path/to/template npm run dev -- my-test-app
```

This bypasses version locking entirely (no ref is resolved or requested), so it works
regardless of whether a matching template tag exists yet. To exercise the real
version-locked download path against `main` during development, use `--ref main`
instead of the local override.

## Testing

```bash
npm run typecheck
npm run build
npm test              # fast, offline: runs the CLI against a local fixture template
                       # + version-lock unit tests with a mocked network
CREATE_MIDNIGHT_TEST_NETWORK=1 npm test   # also exercises the real GitHub download path,
                       # including the current "no matching tag" error state
```

> **Note for maintainers:** once the template repository is tagged to match a released
> CLI version (e.g. `v1.0.0`), update the real-network test in
> `tests/cli.integration.test.ts` that currently asserts "no matching tag exists yet" —
> it should be replaced with (or supplemented by) a test that scaffolds successfully
> without `--ref`, proving the default version-locked path works end-to-end.

## Architecture

```
src/
├── cli.ts        # Entry point: arg parsing + orchestration
├── prompts.ts     # Interactive prompts (@clack/prompts)
├── downloader.ts  # Template registry + version-locked ref resolution + download/extract
├── version.ts     # Reads the CLI's own version (drives the default template tag)
├── scaffold.ts    # Post-download project configuration
├── installer.ts   # Dependency installation
├── git.ts         # Git init + initial commit
├── setup.ts       # Runs the template's own `npm run setup`
├── errors.ts      # Typed errors + user-facing recovery messages
├── logger.ts      # Banner/section helpers
└── utils.ts       # Shell exec, package-manager detection, name validation
```

## FAQ

**Which package managers are supported?**
npm, pnpm, Yarn, and Bun. By default the CLI auto-detects the fastest one installed
on your system (Bun → pnpm → Yarn → npm — see [Package manager
detection](#package-manager-detection)); use `--use-npm` / `--use-pnpm` /
`--use-yarn` / `--use-bun` to force a specific one.

**What Node version do I need?**
Node 18.18 or newer (see `engines` in `package.json`).

**Can I use this without installing dependencies or running setup?**
Yes — pass `--no-install`. Note that `--setup` requires `--install`; the CLI warns
and skips setup rather than failing if you request setup without installation.

**Does `create-midnight` ever scaffold from `main`?**
No, by default. Every release is version-locked to a matching template tag (see
[Version locking](#version-locking)). `main` is only used if you explicitly pass
`--ref main`.

**How do I add a new template?**
Register it in `src/downloader.ts` (`TEMPLATE_REGISTRY`) with an `owner`/`repo`
(and optional `subdir`), then select it with `--template <name>`. No other code
needs to change — download, version locking, and extraction are template-agnostic.

**Is it safe to run non-interactively in CI?**
Yes — pass `-y`/`--yes` plus explicit flags for every choice (`--network`,
`--git`/`--no-git`, `--install`/`--no-install`, `--setup`/`--no-setup`) so no
prompt blocks on stdin.

## Troubleshooting

**`Compatible template version not found`**
The template repository doesn't yet have a tag matching this CLI's version. Either
upgrade the CLI (`npm install -g create-midnight@latest`) or, for development only,
scaffold from a branch with `--ref main`. See [Version locking](#version-locking).

**`A file or directory already exists at "..."`**
Choose a different project name, or remove/rename the existing directory.

**Git is not installed / initialization fails**
Install Git, or re-run with `--no-git` to scaffold without a repository. A failed
*commit* (e.g. missing `git config user.name`/`user.email`) doesn't fail the whole
run — the project is still created; initialize Git manually afterwards if needed.

**Dependency installation fails**
Re-run with `--verbose` to see the full installer output. Common causes: no network
access, a missing package manager binary (`npm`/`pnpm`/`yarn`/`bun` not on `PATH`),
or insufficient disk space/permissions — the CLI's error message tells you which.

**I don't see a stack trace and need one**
Every command accepts `--verbose`, which prints the full error output (including
the underlying stack/cause) instead of just the friendly recovery message.

**I want to test against a template on disk, without hitting the network**
Set `CREATE_MIDNIGHT_LOCAL_TEMPLATE=/path/to/template`. This bypasses both the
network download and version-lock ref resolution entirely.

## Publishing

Maintainer workflow for cutting a release:

1. Update `CHANGELOG.md` with the new version's notes (follow
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
2. Bump the version in `package.json` (`npm version patch|minor|major`, or edit
   directly — this repo does not use `npm version`'s git-tagging behavior since
   the package lives in a subdirectory).
3. Verify everything is release-ready:
   ```bash
   npm run typecheck
   npm run build
   npm test
   npm pack --dry-run   # confirm: dist/ + README/LICENSE/CHANGELOG only, no src/tests
   ```
4. Tag the corresponding template repository release (`v<version>`) — the CLI's
   version-locked default depends on that tag existing before publishing.
5. Publish:
   ```bash
   npm login
   npm publish --access public
   ```
6. Verify on the registry: `npm view create-midnight version`, then smoke-test with
   `npx create-midnight@latest smoke-test-app`.

### Release checklist

- [ ] `CHANGELOG.md` updated
- [ ] `package.json` version bumped
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm pack --dry-run` contents look correct (no `src/`, `tests/`, or dev config)
- [ ] Matching template tag (`v<version>`) exists upstream
- [ ] `npm publish --access public`
- [ ] Post-publish smoke test via `npx create-midnight@latest`
