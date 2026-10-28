# INCHCANDLE
*Sealed auction rooms on Zcash. NJay, October 2026.*

## ABSTRACT

Sealed-bid auctions on public chains leak in one of two ways. Either the bidders are public and only the amounts are hidden, or the amounts are hidden from the public but the auctioneer reads every bid as it arrives. We built Inchcandle to close both gaps at once. Bidders pay from unlinkable shielded addresses in the Zcash Sapling pool, and each bid is sealed with drand timelock encryption, so nobody, the host included, can read a bid before the room's unsealing round. At that round every member recomputes the result from chain data, so no one has to be trusted to announce it. Lots that live on EVM chains are held in vaults that release to the winner on signatures from a small attester committee.

## 1. INTRODUCTION

The record of on-chain auctions shows why both kinds of privacy matter. ConstitutionDAO lost a $41M auction at Sotheby's in 2021 partly because its ceiling was public, so anyone could see exactly how far it could go. Zama's January 2026 token sale hid bid amounts with FHE and drew $118.5M from 11,103 bidders, which shows real demand for encrypted bids, but every bidder's address was still public. Arbitrum's Timeboost runs a sealed-bid second-price auction every round, and three entities won 99.74% of them, which is what happens when a small set of known players can watch each other.

The Zcash entries we found before starting, ShieldBid and the zkSNARKs NFT auction demo, hide bidders well, but in both the seller reads every bid on arrival. Timelock auction demos on EVM chains stop the auctioneer from peeking, but the wallets are public. Shutter's sealed bids on Ethereum rely on a threshold of keypers and also leave wallets public. As far as we could find, nothing combines anonymous bidders with a seal nobody can open early.

Section 2 describes a room. Section 3 covers lots on other chains, section 4 access, and the later sections cover what is private, the threats, the assumptions and the current status.

## 2. A ROOM

**2.1 Keys.** The host's browser generates a fresh seed and the room is ZIP 32 account 0 of that seed. The host keeps the spending key. Members receive the room's unified full viewing key, because the WebZjs memory wallet only imports full viewing keys. A full viewing key would normally also show the room's outgoing payments, and with them every refund address, so the host signs every outgoing transaction with the outgoing viewing key discarded. Members still see that a deposit note was spent, which is how they confirm refunds went out, but they can't read where it went.

**2.2 Paddles.** Paddle `n` is the room's Sapling address at the first valid diversifier index from `n << 16`. Not every Sapling index gives a valid address, which is why the index is searched rather than used directly. Members can derive other addresses from the viewing key too, so a bid only counts at a paddle the host issued, and a paddle only counts its first bid.

**2.3 The bid.** The bidder's browser builds a payload with the bid amount, a claim key address (section 3) and the room's tag, and seals it to the room's unsealing round using drand quicknet, which publishes a BLS signature every 3 seconds. The sealed envelope goes in the memo of a payment of the fixed deposit to the bidder's paddle. The browser checks drand signatures with its own pairing check against the quicknet public key, so the drand HTTP API doesn't have to be trusted.

**2.4 Validity.** Every member applies the same rules, in order:

1. The note arrived at an issued paddle.
2. It was mined at or before the close height, in a block whose time is before the unsealing round minus a margin. The second condition stops a slow chain from keeping bidding open after bids can be read.
3. Its value is at least the deposit.
4. The envelope opens with the checked beacon and carries this room's tag.
5. A duplicate envelope counts only where it first appeared, so copying someone's sealed bid gets you nothing.
6. Ties go to the earlier block, then the earlier transaction.

**2.5 Sale types.** A room is one of four types: second price, where the winner pays the runner-up's bid; pay what you bid; several winners at one clearing price; and a candle sale, where drand picks the real end from a window after the fact, as Polkadot did for its parachain slots.

**2.6 Refunds.** The host returns every losing deposit in one transaction built from a ZIP 321 request with one output per refund. Zodl only uses the first payment of a multi-payment request, which is why the room builds refunds itself instead of handing them to a wallet.

## 3. LOTS ON OTHER CHAINS

Zcash has no contracts, so a lot stays on the chain where it lives.

`InchcandleVaultFactory` deploys one `LotVault` clone per lot, and the vault address is part of the room terms. Each bid seals the address of a fresh secp256k1 claim key made in the bidder's browser, so the winner's claim key becomes known exactly when the winner does.

`settle` takes the claim key, the price and a hash of the result, with EIP-712 signatures from at least k of the vault's n attesters. An attester reads the room, opens every bid with the checked beacon, runs the same rules the browsers run and checks the winner's balance arrived. The relay collects signatures and submits them. It pays gas but has no authority: it can delay a settlement, but it can't forge one, and anyone else can submit the same signatures. This follows the Hyperlane model of signing validators and an untrusted relayer.

`claim` takes a destination signed by the claim key. Because anyone can submit it, the winner needs no funds or history on that chain, and the destination can be a fresh address, so nothing links the Zcash bidder, the claim key and the receiving wallet. `settleNoSale` returns the lot when the reserve isn't met, and `reclaim` returns it to the seller after a deadline, so a dead relay can't freeze a lot.

## 4. ACCESS

Private rooms admit people with one-use codes. A code is 80 random bits, written as 16 Crockford base32 characters. From each code the browser derives a lookup id and a wrap key. The server stores, per code, the lookup id and an admission (the room key and that code's paddle) encrypted under the wrap key, so it never sees a code, a room key or a paddle.

Redeeming a code is one conditional update that only succeeds while the code is unused, so only the first caller gets the admission. The browser then makes a non-extractable device key and signs every later request for the room with it, so a copied database row or a forwarded link doesn't carry membership to another machine. On chain, a code carries one paddle and a paddle counts one bid, so a code shared before use still buys only one bid.

## 5. WHAT IS PRIVATE

| | Public | Room members | Host |
|---|---|---|---|
| Bid amounts | Never | From the unsealing round | From the unsealing round, never before |
| Who bid | Never | Never | Never |
| How many bid | Never | Yes | Yes |
| The winner's bid | Never | From the unsealing round | From the unsealing round |
| Settled price | Only if the room publishes it | Yes | Yes |

The settled price can't be hidden from the people who settle it. After a room closes it can keep its results to its members, publish only the hammer price, or publish the viewing key, which makes the amounts public and keeps the bidders hidden.

## 6. THREATS

- **The host peeks.** Stopped by the timelock.
- **The host bids in its own room.** Still possible, but blind, because the host can't see the other bids either. In a first-price room it gains nothing, and in a second-price room it risks winning its own lot.
- **Sniping after the close.** A bid only counts before the close, and the close comes before the unsealing.
- **drand collusion.** A threshold of the League of Entropy could open bids early. We've designed a dual seal that needs both the drand round and a host share, which stops that at the cost of letting the host stall. It isn't built.
- **Custody.** The host holds deposits until refunds go out. A FROST 2-of-3 room treasury would remove that.
- **Attester collusion.** A majority of a vault's attesters could settle to a claim key of their own. Every member recomputes the result, so the room would see it, but the vault can't judge it. The seller picks the committee per vault.
- **The light server.** Fetching a transaction by id tells the proxy which ones you care about (ZIP 307). This is open in the current build.

## 7. ASSUMPTIONS

- drand quicknet keeps publishing, and fewer than its threshold of operators collude.
- Sapling stays open to new deposits. NU7 still allows it.
- Members run the client, or trust someone who does. The point of recomputing in every browser is that nobody has to.

## 8. LIMITATIONS

The pinned `zcash_client_memory` drops Ironwood notes, and since NU6.3 every payment to an Orchard receiver lands in Ironwood, so an Orchard paddle would be invisible to the room. That's why we put rooms in Sapling. A deposit sent from an Ironwood wallet crosses pools, which makes its amount public, but deposits are all the same amount, so it only shows the deposit.

The compact block scan carries no memos, and the memory store keeps an old memo when a note is updated, so the room fetches each Sapling transaction whole and decrypts the memo and the paddle itself.

## 9. CURRENT STATUS

- Sealing, the beacon check and the opening run in the browser, with tests that include positive controls.
- We ran the chain layer in the browser light client against a local regtest chain with every upgrade through NU6.3 active. A funder paid paddle 7 a deposit with a memo, the room read back the value, memo and paddle, the room refunded it with a memo, and the funder read the refund. The public testnet runs NU7, which the pinned `librustzcash` can't build transactions for.
- The room screens run on a preview network, where the directory stores sealed bids the way the chain would and can't read them, since they're timelocked.
- We've run the vaults and a 2-of-3 attester committee end to end on a local EVM chain, from a sealed bid to the winner claiming an NFT, including with one attester stopped.

## 10. FUTURE WORK

- Move the room screens from the preview network onto the light client.
- Blind admission tickets, so neither the server nor the host can link a code to a bid.
- A dark-room tier where only the host can open bids and members check a zero-knowledge proof of the result.
- A Solana program with the same four vault instructions.
- FROST 2-of-3 shielded escrow for physical items, so the ZEC waits for delivery.

## 11. CONCLUSION

Hiding who bid and stopping anyone from reading bids early are both possible today, and they've only been done separately. Zcash's shielded pool provides the first and drand timelock encryption the second, and putting them together needs no new chain, no contract on Zcash and no trusted server. What we have left is moving the room screens onto the chain itself.
