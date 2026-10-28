# INCHCANDLE

**Sealed auction rooms on Zcash.** Bid from a shielded address, seal it with a timelock, and nobody sees a thing until the room opens. Not the other bidders, not the public, not even the host.

Built for ZECATHON 2026, Private Markets track.

## THE PITCH

Every sealed-bid auction we looked at leaks something. On public chains the bidders are public even when the amounts aren't. On the Zcash auctions we found, the bidders are hidden but the seller reads every bid the moment it lands.

Inchcandle fixes both. A room lives entirely in encrypted memos in the Sapling pool, with no contract and no server holding the bids. Each bidder gets their own unlinkable shielded address (a paddle), and each bid is a fixed deposit whose memo carries the bid sealed with drand timelock encryption. When the unsealing round hits, every member's browser checks the drand beacon, opens every bid and works out the winner itself, so nobody has to be trusted to announce it.

Lots on other chains (NFTs, tokens) sit in a vault on their own chain and go to the winner on signatures from a small attester committee, so the winner can claim to a fresh wallet with nothing linking it back to Zcash.

The full design, threats and limits are in [PAPER.md](PAPER.md).

## BUILT WITH

- Zcash Sapling shielded pool, through a fork of [WebZjs](https://github.com/Njaybby/webzjs/tree/inchcandle) with room bindings added
- drand quicknet timelock encryption, with the BLS beacon check done in the browser
- ZIP 321 payment requests, scanned as QR codes from any shielded wallet
- Solidity vaults (Foundry) with EIP-712 k-of-n attester settlement
- React, Vite and TypeScript, with a Hono directory on libSQL

## WHAT IS IN HERE

- `app/` the browser client (Vite, React, TypeScript): sealing, beacon checks, the opening, and the room screens for desktop and phone
- `server/` the directory, which holds room listings and code books (Hono, on `node:sqlite` locally or libSQL when `TURSO_DATABASE_URL` is set)
- `api/` the directory as a Vercel function
- `contracts/` the vaults that hold lots living on EVM chains (Foundry, solc 0.8.28)
- `relay/` the attesters, the relay that submits their signatures, and a script that seeds example rooms
- `regtest/` a local Zcash chain: a Zakura node, lightwalletd and a gRPC-web proxy

## HOW A ROOM WORKS

**Room keys.** The host's browser makes a fresh seed and the room is account 0 of it. Members get the room's full viewing key, so they can read every deposit and memo. The host signs every outgoing transaction with the outgoing viewing key discarded, which means refunds can't be read by anyone holding the viewing key, the host included.

**Paddles.** Each bidder gets a paddle, which is one of the room's Sapling addresses. Paddle `n` is the first valid diversifier index from `n << 16`. Two paddles can't be linked to each other or to the wallet that paid them, and a paddle only counts its first bid.

**Bids.** The bidder's browser builds the bid (amount, a claim key address and the room's tag), seals it to the unsealing round and shows a payment request for the deposit with the sealed bid as the memo. Any wallet that reads ZIP 321 can send it. Zodl won't open ZIP 321 links, so the request is shown as a QR code to scan.

**Opening.** Every member runs the same checks: the deposit arrived at an issued paddle before the close, it is at least the deposit amount, the envelope opens with the checked beacon and carries this room's tag, a copied envelope only counts where it first appeared, and ties go to the earlier block. There are four sale types: second price, pay what you bid, several winners at one price, and a candle sale where drand picks the real end after the fact.

**Refunds.** The host returns every losing deposit in one transaction with one output per refund.

## LOTS ON OTHER CHAINS

Zcash has no contracts, so a lot is held on the chain it already lives on.

**InchcandleVaultFactory** deploys one **LotVault** clone (EIP-1167) per lot. The vault address goes in the room terms so members can check the lot is really locked. A vault holds an ERC-721, ERC-1155, ERC-20 or the native coin.

Each bid seals a fresh secp256k1 claim key address, so the winner's claim key becomes known at the same moment the winner does. `settle` needs EIP-712 signatures from k of the vault's n attesters, and the attesters run the same opening code the browsers do. `claim` takes a destination signed by the claim key, and anyone can submit it, so the relay pays the gas and the winner can receive at a brand new address. `settleNoSale` returns the lot if the reserve isn't met, and `reclaim` returns it to the seller after a deadline if nobody settles.

## ACCESS

A room is public, private or hidden. Public rooms are listed and anyone can take a paddle. Private rooms are listed by name only and need a code. Hidden rooms aren't listed.

Codes come from a code book of one-use codes the host makes. The server stores a hash of each code and an admission sealed under a key derived from it, so it never sees a code, a room key or a paddle. A code is redeemed in one conditional write, and after that the member's requests are signed by a device key that can't be exported from their browser.

## RUNNING IT

You need Node 22, [Foundry](https://book.getfoundry.sh/), and a nightly Rust toolchain with `wasm-pack` for the light client.

The app uses a fork of WebZjs that adds the room bindings (paddle addresses, room notes with their memos, block time, ZIP 321 proposals and sends that discard the outgoing viewing key). Clone it next to this repo:

```shell
git clone --recurse-submodules https://github.com/Njaybby/inchcandle.git
git clone -b inchcandle https://github.com/Njaybby/webzjs.git
```

Build the fork by following the WebZjs instructions. The finished module is about 60 MB because it bundles the Sapling parameters. Then:

```shell
cd inchcandle && npm install
cd app && npm install && npm run dev        # http://127.0.0.1:5240
cd ../server && npm install && npm run dev  # directory on :5242
```

The app has to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, because the light client uses `SharedArrayBuffer`. The Vite config and `vercel.json` already set both.

For a local chain, `regtest/up.sh` starts the node, lightwalletd and the proxy on `127.0.0.1:18080`, `regtest/mine.sh [n]` mines blocks and `regtest/down.sh` stops it all.

## TESTS

```shell
cd app && npm test          # 40
cd ../server && npm test    # 4
cd ../contracts && forge test   # 12
```

The sealing tests include positive controls: a bid sealed to a past round has to open and read back the exact amount, and one sealed to a future round has to fail.

## STATUS

- Sealing, the beacon check and the opening run in the browser.
- We've run the chain layer in the browser against a local regtest chain: a deposit with a sealed memo was paid to a room paddle and read back with its value, memo and paddle, and a refund was sent and read back by the funder.
- The room screens still run on a preview network, where the directory stores sealed bids the way the chain would. Moving them onto the light client is the next step.
- The vaults and the 2-of-3 attester committee have run end to end on a local EVM chain, ending with the winner claiming an NFT, including a run with one attester stopped.

The public Zcash testnet now runs NU7, and the pinned `librustzcash` can't build NU7 testnet transactions, which is why the chain run uses regtest. The pinned memory wallet doesn't track Ironwood notes either, so rooms receive in Sapling. A deposit from an Ironwood wallet crosses pools and shows its amount, but every deposit in a room is the same amount, so that only shows the deposit.

## LICENSE

MIT
