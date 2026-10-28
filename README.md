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

## WALLETS

Everyone who opens the app can have their own wallet, made in their browser. One seed gives a shielded Zcash account, which pays bid deposits and balances, and an EVM account for sellers. The seed sits in the same encrypted bundle as the room keys and never leaves the browser.

You can also recover a wallet by signing one fixed message with MetaMask or Rabby. The same browser wallet always signs the same bytes, so you get the same Inchcandle wallet back on any device, and signing sends nothing.

On the local chain the wallet page has a faucet button that sends 20 test ZEC from the chain's funder and mines it in.

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
- Rooms can run on the local Zcash chain. Bidders pay deposits and balances from their own wallets, and every member's browser reads the bids from the room's notes on the chain. Rooms on the preview network keep the sealed bids in the directory instead.
- The attesters still read the directory's copy of each bid, because they run in Node and the light client runs in the browser. Members' browsers check the result against the chain.
- The vaults and the 2-of-3 attester committee have run end to end on a local EVM chain, ending with the winner claiming an NFT, including a run with one attester stopped.

## FULL RUN: LOCAL ZCASH CHAIN AND BASE SEPOLIA

We ran the whole thing on 28 October 2026, 21 of 21 checks. Two bidders each made a wallet in their own browser (one on a phone) and took test ZEC from the faucet. A seller put an NFT into a vault on Base Sepolia, and the room ran on the local Zcash chain. Both sealed bids went out as shielded payments from the bidders' wallets to their paddles, with the bid in the memo, and the host's browser read them back from the chain still sealed. At the drand round every browser opened them, the winner paid the balance from her wallet, two of three attesters signed, the relay settled, and the winner claimed the NFT to a fresh address.

| | Base Sepolia |
|---|---|
| Deposit into the vault | [`0x5329a395…`](https://sepolia.basescan.org/tx/0x5329a395afc079f53e5fcd4470a71666f4f71b8a3749370ce4511bc586259457) |
| Lot vault | [`0x9Cb4f63e54e3f23A1073805129d8e2fecCdF4281`](https://sepolia.basescan.org/address/0x9Cb4f63e54e3f23A1073805129d8e2fecCdF4281) |
| Settle | [`0x6c065602…`](https://sepolia.basescan.org/tx/0x6c06560255aeee0cd6c0bb8326c4c05260bcc57ec1e18a9769aff77f3f0cea6d) |
| Claim to a fresh address | [`0x32d882f3…`](https://sepolia.basescan.org/tx/0x32d882f3c523590729c2b6b1c94d7225afebc6ce37d1cb95cf01cf30b429a34b) |

## BASE SEPOLIA RUN

We ran a full room against a real vault on Base Sepolia on 28 October 2026. A seller minted a demo NFT and deposited it into a vault, two bidders joined a private room with one-use codes and placed sealed bids, the room opened at its drand round, two of the three attesters signed, the relay settled, and the winner claimed the NFT to a brand new address. The bids ran on the preview network; every EVM step is on chain.

| | Base Sepolia |
|---|---|
| Vault factory | [`0x5a6e1792739FDCA3C114688FC5562f38B3548758`](https://sepolia.basescan.org/address/0x5a6e1792739FDCA3C114688FC5562f38B3548758) |
| Demo NFT | [`0xf287BE3997af4Bceb958d5353F29f6f5DB07072a`](https://sepolia.basescan.org/address/0xf287BE3997af4Bceb958d5353F29f6f5DB07072a), token 543112 |
| Mint | [`0x90ca16f0…`](https://sepolia.basescan.org/tx/0x90ca16f049e734dca60d8e45d7b73c9d09c8ee5c69f42d4bee0e7fdc7e2cfc76) |
| Approve | [`0x1bfd789b…`](https://sepolia.basescan.org/tx/0x1bfd789b27f472b31cfb22ab947cb416fd3788fbffec6ebcee26992ec01317d9) |
| Deposit into the vault | [`0x3493b8bd…`](https://sepolia.basescan.org/tx/0x3493b8bdf7791488d4117e05f128dc02eddbd082b7f7c6a4d44b3a0334e1ed80) |
| Lot vault | [`0x92522B3D48B890eb42750CD621BD0c468647E588`](https://sepolia.basescan.org/address/0x92522B3D48B890eb42750CD621BD0c468647E588) |
| Settle, 2 of 3 attesters | [`0x9193ecb9…`](https://sepolia.basescan.org/tx/0x9193ecb99b861a6841b3cec6327659e2ee6915bcbef0669786a2b76ebe107a51) |
| Claim to a fresh address | [`0x8239f9ca…`](https://sepolia.basescan.org/tx/0x8239f9ca6f6a7f7992f936cf077ba35f2c25532227e6a202182d0d1d9b992ca0) |
| Winner's new address | [`0x810fb6c8b5075705952285245c41a836b19aabad`](https://sepolia.basescan.org/address/0x810fb6c8b5075705952285245c41a836b19aabad) |

Ethereum Sepolia is not deployed. The factory deploys its implementation in its constructor, and on Sepolia that estimates at 18.75M gas, above the 16.78M per-transaction cap. Splitting the two deploys fixes it.

The public Zcash testnet now runs NU7, and the pinned `librustzcash` can't build NU7 testnet transactions, which is why the chain run uses regtest. The pinned memory wallet doesn't track Ironwood notes either, so rooms receive in Sapling. A deposit from an Ironwood wallet crosses pools and shows its amount, but every deposit in a room is the same amount, so that only shows the deposit.

## LICENSE

MIT
