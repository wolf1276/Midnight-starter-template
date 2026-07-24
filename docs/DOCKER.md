# Docker Setup

`infra/docker/docker-compose.yml` defines the full local stack: `node`, `indexer`, `proof-server`, and a
`web` service (built from the root `Dockerfile`'s `dev` target with hot reload via bind mount).

```bash
npm run docker:start   # equivalent to: docker compose -f infra/docker/docker-compose.yml --profile web up -d --build
```

Fixed host ports: node `9944`, indexer `8088`, proof server `6300`, web `3000`.

The root `Dockerfile` also has a `prod` target producing a minimal standalone Next.js image:

```bash
docker build --target prod -t bboard-web:prod .
docker run -p 3000:3000 bboard-web:prod
```

This is separate from the ephemeral, testcontainers-managed proof server that
`npm run contracts:deploy` spins up per-run (`cli/proof-server.yml`) — that one is
managed automatically by the deploy pipeline and needs no manual Docker commands.

## Other commands

| Command | What it does |
|---|---|
| `npm run docker:stop` | Stop the Docker stack |
| `npm run docker:reset` | Stop the stack and drop its volumes (fresh chain state) |
| `npm run blockchain:start` | Start only node + indexer + proof server (no web container) |
| `npm run blockchain:reset` | Remove the blockchain service containers (chain/indexer data preserved) |
| `npm run blockchain:reset -- --hard` | Also drop the node/indexer volumes (fully fresh chain state) |
