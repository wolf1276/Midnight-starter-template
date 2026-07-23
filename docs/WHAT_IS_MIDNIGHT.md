# What Is Midnight?

A plain-language introduction for anyone new to Midnight, zero-knowledge proofs, or this repo.
If you just want to run the app, see the [README](../README.md) — come back here when you want
to understand *why* things work the way they do.

## What is Midnight?

[Midnight](https://midnight.network/) is a blockchain network built for **data protection**.
Most blockchains (Ethereum, Bitcoin, ...) make every transaction and every piece of contract
state permanently public — that's fine for a currency ledger, but bad for an app that needs to
keep some things private (a salary, a vote, who posted a message). Midnight lets a smart
contract prove it followed its own rules *without* revealing the private data behind that proof.

## What is Compact?

[Compact](https://docs.midnight.network/compact/writing) is the language this repo's smart
contract (`contracts/src/bboard.compact`) is written in. It looks similar to TypeScript, but the
compiler does something extra: for every function that touches private state, it generates the
zero-knowledge circuitry needed to prove "this function ran correctly" without exposing its
inputs. `npm run contracts:build` runs the Compact compiler and produces the compiled artifacts
in `contracts/src/managed/`.

## What does the Proof Server do?

Building a zero-knowledge proof is computationally heavy — too heavy to do in a browser tab
quickly. The **proof server** (a container this repo starts for you, port `6300`) is a
dedicated service that takes a transaction's private inputs and the compiled circuit, and does
that proving work. The wallet sends it what it needs, gets a proof back, and attaches that proof
to the transaction it submits to the network. Nothing private ever leaves your machine — the
proof server only ever sees inputs for transactions *you're* submitting.

## Why does an Indexer exist?

Querying a blockchain node directly for "what's the current state of contract X" is slow and
node-unfriendly at scale. The **indexer** (port `8088`) is a service that watches the chain,
extracts the *public* parts of contract state as they change, and exposes them over a fast
GraphQL API. The frontend (`web/`) and CLI (`cli/`) both read contract state through the indexer
rather than hitting the node directly.

## What actually gets deployed?

Running `npm run contracts:deploy` does three things on-chain:

1. Compiles `contracts/src/bboard.compact` into a circuit + verifier key (if not already built).
2. Submits a deploy transaction containing the contract's initial public state and its verifier
   key, proven by the proof server.
3. Once the network confirms it, the indexer picks up the new contract's state and the deployed
   **contract address** becomes queryable by anyone.

The contract's *logic* (what counts as a valid "post a message" or "take it down" transaction)
lives in the verifier key on-chain forever. The contract's *private state* (e.g. a secret key
proving ownership) never touches the chain at all — it stays local, in the private state store
this CLI/wallet manages on your machine.

## How does privacy work here, concretely?

In this bulletin board example: anyone can see *that* a message was posted and *what* it says
(that's public state, by design, since it's a public board). What's private is **who is allowed
to take the message down** — provable ownership without a public "author" field anyone can read
off-chain. The `takeDown` transaction includes a zero-knowledge proof that the caller knows the
secret associated with the original post, without revealing that secret or linking it to any
other on-chain activity.

## Why do developers need test tokens?

Every transaction on Midnight (including "free" testnet ones) costs a small amount of the
network's native token to submit — this is what stops the network from being spammed. On
`preview`/`preprod` these tokens are worthless test tokens (`tNIGHT`), given out for free by a
**faucet**. This repo's deploy CLI shows you the deployment wallet's address automatically and
pauses for funding — see the main [README](../README.md#deploy-a-contract) for what that looks
like in practice. You never need to find or bookmark a faucet URL yourself; the CLI prints it.

## Further reading

- [Official Midnight docs](https://docs.midnight.network/)
- [Compact language guide](https://docs.midnight.network/compact/writing)
- [This repo's architecture](ARCHITECTURE.md)
