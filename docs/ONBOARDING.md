# Onboarding

Start here. This links out to the docs that already exist — it doesn't replace them.

## 1. What is this project?

A Midnight (privacy blockchain) DApp monorepo: a Compact smart contract, a shared
API layer, a CLI, and a Next.js web frontend. See [WHAT_IS_MIDNIGHT.md](WHAT_IS_MIDNIGHT.md)
if you're new to Midnight itself.

## 2. Get it running

```bash
./setup.sh
```

One-command bootstrap: checks prerequisites, builds contracts, starts Docker + the
Proof Server, deploys, and wires up `web/.env.local`. If something fails, check
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) first — it's the largest doc here for a reason.

## 3. Understand the shape of the repo

Read [ARCHITECTURE.md](ARCHITECTURE.md) — it has the data-flow diagram and the
directory-by-directory breakdown (`contracts/`, `api/`, `cli/`, `web/`, `infra/`).

## 4. Scaffolding a new project from this template

If you're working on the `create-midnight` CLI itself (the tool that generates
projects like this one), see [`create-midnight/README.md`](../create-midnight/README.md) —
it covers version locking, local template development, and the release process.

## 5. Other references

- [ENVIRONMENT.md](ENVIRONMENT.md) — env vars across workspaces
- [DOCKER.md](DOCKER.md) — the local Docker stack (node, indexer, proof server)
- [CHANGELOG.md](CHANGELOG.md) — what's changed release to release
