import { equalBytes, fromBase64Url } from "./bytes";
import { decodePayload, readHead, readOpen } from "./envelope";
import { roomTag } from "./ids";
import { candleOut, judge, type Opened, type Outcome } from "./rules";
import type { RoomTerms, SealedBid } from "./types";

// Opening a room, with nothing but the room's terms, the envelopes it received and the round's verified signature.
// The browser's opening and every attester run this same function, which is why they land on the same result.

export interface Opening {
  outcome: Outcome;
  /** Each counted bid's claim field, so the winner's claim key can be read. */
  claims: Map<string, Uint8Array>;
  opened: number;
  reserveOpened: boolean;
}

export async function openAll(terms: RoomTerms, arrived: SealedBid[], signature: string): Promise<Opening> {
  const { unseal } = await import("./seal");
  const tag = roomTag(terms.id);
  const candle = terms.format === "candle";
  const opened = new Map<string, Opened | null>();
  const claims = new Map<string, Uint8Array>();
  for (const bid of arrived) {
    try {
      const envelope = fromBase64Url(bid.envelope);
      if (candle) {
        const read = readOpen(envelope);
        if (!read || !equalBytes(read.tag, tag)) throw new Error("Not this room's open envelope");
        opened.set(bid.id, { amount: read.payload.amount, name: read.payload.name });
        claims.set(bid.id, read.payload.claim);
      } else {
        const head = readHead(envelope);
        if (!head || head.round !== terms.round || !equalBytes(head.tag, tag)) throw new Error("Not sealed to this room");
        const payload = decodePayload(await unseal(envelope, signature));
        opened.set(bid.id, { amount: payload.amount, name: payload.name });
        claims.set(bid.id, payload.claim);
      }
    } catch {
      opened.set(bid.id, null);
    }
  }
  let reserve: bigint | null = null;
  let reserveOpened = !terms.reserve;
  if (terms.reserve) {
    try {
      reserve = decodePayload(await unseal(fromBase64Url(terms.reserve), signature)).amount;
      reserveOpened = true;
    } catch {
      reserve = null;
    }
  }
  const outcome = judge(terms, arrived, opened, reserve, candle ? candleOut(terms, signature) : undefined);
  return { outcome, claims, opened: [...opened.values()].filter((v) => v !== null).length, reserveOpened };
}

/** How long a winner has to pay the balance: the room's own length, between five minutes and two days. */
export function paymentWindow(terms: RoomTerms): number {
  return Math.min(Math.max(terms.closesAt - terms.createdAt, 5 * 60_000), 48 * 60 * 60_000);
}
