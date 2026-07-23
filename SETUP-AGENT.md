# Setup

Prerequisites: Node.js >= 24.11.1, Docker, the Compact compiler (`compactc`).

```bash
npm install
npm run deploy --network preview   # or --network preprod
```

`npm run deploy` (`scripts/deploy/deploy.mjs`) verifies prerequisites, compiles the contract, builds
the CLI, starts the proof server, and deploys the contract, printing the deployed contract address.

For the web frontend:

```bash
cd web
cp .env.example .env.local
npm run dev
```

See `README.md` for the full walkthrough and `web/README.md` for frontend-specific details.
