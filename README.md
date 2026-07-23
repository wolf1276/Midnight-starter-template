# Midnight Starter Template

A one-item bulletin board dApp built on [Midnight](https://midnight.network/): anyone can post a
message, but only the author can remove it. Zero-knowledge proofs enforce the rules without
revealing who anyone is on-chain. Use this repo as a starting point for your own Midnight project.

## Prerequisites

- [Git](https://git-scm.com/)
- [Docker](https://docs.docker.com/get-docker/)
- Node.js — `setup.sh` will install/check this for you

## Quick Start

```bash
git clone <this-repo-url>
cd example-bboard
./setup.sh
npm run dev
```

Open http://localhost:3000 with the [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk)
or [1AM](https://1am.com/) wallet extension installed.

## Deploy a Contract

```bash
cd contracts
npm run deploy -- --network preview
```

Follow the on-screen prompts to fund your wallet from the faucet. Once deployed, the contract
address is saved automatically for the frontend to use.

## Learn More

- [What Is Midnight?](docs/WHAT_IS_MIDNIGHT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Midnight Documentation](https://docs.midnight.network/examples/dapps/bboard)
