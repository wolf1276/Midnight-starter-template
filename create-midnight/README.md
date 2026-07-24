# create-midnight

Scaffold a production-ready [Midnight](https://midnight.network) DApp in seconds.

```bash
npx create-midnight my-app
# or
npm create midnight@latest my-app
```

## What it does

1. Prompts for a project name, default network (Preview or Preprod), and whether to
   initialize Git, install dependencies, and run project setup.
2. Downloads the official Midnight starter template, **version-locked** to this CLI
   release (see [Version locking](#version-locking) below).
3. Configures the project — renames `package.json`, writes `web/.env.local` for the
   selected network, and strips template-only files.
4. Installs dependencies with your detected package manager (npm/pnpm/yarn/bun), or
   the one forced via `--use-npm` / `--use-pnpm` / `--use-yarn` / `--use-bun`.
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
