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
2. Downloads the official Midnight starter template.
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
| `-y, --yes` | Accept defaults for every prompt |
| `--verbose` | Print full error output for debugging |

## Templates

The CLI is not coupled to a single template. Additional templates can be registered
in `src/downloader.ts` (`TEMPLATE_REGISTRY`) and selected with `--template <name>`,
e.g. `--template contract` or `--template dashboard`, without changing any
download/scaffold/install logic.

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

## Testing

```bash
npm run typecheck
npm run build
npm test              # fast, offline: runs the CLI against a local fixture template
CREATE_MIDNIGHT_TEST_NETWORK=1 npm test   # also exercises the real GitHub download path
```

## Architecture

```
src/
├── cli.ts        # Entry point: arg parsing + orchestration
├── prompts.ts     # Interactive prompts (@clack/prompts)
├── downloader.ts  # Template registry + download/extract
├── scaffold.ts    # Post-download project configuration
├── installer.ts   # Dependency installation
├── git.ts         # Git init + initial commit
├── setup.ts       # Runs the template's own `npm run setup`
├── errors.ts      # Typed errors + user-facing recovery messages
├── logger.ts      # Banner/section helpers
└── utils.ts       # Shell exec, package-manager detection, name validation
```
