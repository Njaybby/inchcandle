import { toBase64Url } from "./bytes";
import { envelopeFromMemo, headLength, memoFor } from "./envelope";
import type { RoomTerms, SealedBid } from "./types";
import { paymentUri } from "./zip321";
import { mine, pay, shared, sync, zcashNetwork } from "./wallet";
import * as z from "./zcash";

// A room on a Zcash network. The host's browser makes the room account; every member imports its viewing key and reads the bids from the chain.

const views = new Map<string, Promise<number>>();

/** Makes a room account and returns its seed, which the host keeps, and what goes into the terms. */
export async function makeRoomAccount(roomId: string): Promise<{ seed: string; zcash: NonNullable<RoomTerms["zcash"]> }> {
  const light = await shared();
  const seed = z.newSeedPhrase();
  const birthday = Math.max(2, (await z.tip(light)) - 2);
  const account = await z.addRoomAccount(light, seed, birthday);
  const ufvk = await light.wallet.account_ufvk(account);
  // The host's page already holds the room with its spending key, so it reads the room through that account.
  views.set(roomId, Promise.resolve(account));
  return { seed, zcash: { ufvk, birthday } };
}

/** The room as a view-only account in this page, imported once. */
function view(terms: RoomTerms): Promise<number> {
  if (!terms.zcash) throw new Error("This room is not on a Zcash network.");
  let id = views.get(terms.id);
  if (!id) {
    const { ufvk, birthday } = terms.zcash;
    id = shared().then((light) => light.wallet.create_account_view_ufvk(`room ${terms.id}`, ufvk, birthday));
    views.set(terms.id, id);
  }
  return id;
}

export async function paddleAddress(terms: RoomTerms, paddle: number): Promise<string> {
  const light = await shared();
  return z.paddleAddress(light, await view(terms), paddle);
}

/** Pays a sealed bid's deposit to the bidder's paddle, with the envelope as the memo. Returns the transaction id. */
export async function payBid(terms: RoomTerms, paddle: number, envelope: Uint8Array): Promise<string> {
  const to = await paddleAddress(terms, paddle);
  const txid = await pay(paymentUri(to, BigInt(terms.deposit), memoFor(envelope)));
  await mine(10);
  return txid;
}

/** Pays the winner's balance to their paddle. */
export async function payBalance(terms: RoomTerms, paddle: number, amount: bigint): Promise<string> {
  const to = await paddleAddress(terms, paddle);
  const txid = await pay(paymentUri(to, amount, "IC1 pay"));
  await mine(10);
  return txid;
}

export interface ChainBid extends SealedBid {
  txid: string;
  height: number;
}

/** Every sealed bid the room's account received, read from the chain: a note at a paddle whose memo is an envelope. */
export async function chainBids(terms: RoomTerms): Promise<ChainBid[]> {
  const light = await shared();
  const account = await view(terms);
  await sync();
  const notes = await z.roomNotes(light, account);
  const out: ChainBid[] = [];
  for (const n of notes) {
    if (n.change || n.address_index === null || n.height === null || !n.memo) continue;
    const envelope = envelopeFromMemo(n.memo);
    // A balance payment carries "IC1 pay", which is not an envelope.
    if (!envelope || envelope.length < headLength) continue;
    const time = await z.blockTime(light, n.height);
    out.push({
      id: `${n.txid.slice(0, 16)}${n.index}`,
      envelope: toBase64Url(envelope),
      deposit: String(n.value),
      at: time * 1000,
      seq: n.height * 1000 + n.index,
      paddle: Number(n.address_index),
      txid: n.txid,
      height: n.height,
    });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export const onChain = (terms: RoomTerms) => terms.network === zcashNetwork && !!terms.zcash;
