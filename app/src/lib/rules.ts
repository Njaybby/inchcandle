import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "./bytes";
import type { RoomTerms, SealedBid } from "./types";

export type VoidReason = "late" | "candle" | "deposit" | "copy" | "unreadable" | "low" | "paddle";

export const voidText: Record<VoidReason, string> = {
  late: "Arrived after the room closed",
  candle: "Arrived after the candle went out",
  deposit: "Came with too small a deposit",
  copy: "A copy of an earlier bid",
  unreadable: "Couldn't be opened with this room's seal",
  low: "Lower than the deposit",
  paddle: "Arrived at a paddle the room never issued",
};

/** What a bid's envelope held, once opened. */
export interface Opened {
  amount: bigint;
  name: number | null;
}

export interface Judged {
  id: string;
  seq: number;
  at: number;
  amount: bigint | null;
  name: number | null;
  void?: VoidReason;
}

export interface Outcome {
  /** Counted bids from highest to lowest, then the bids that don't count, in the order they arrived. */
  bids: Judged[];
  /** The winning bids, highest first. One, except in a room with several winners. */
  winners: Judged[];
  /** What each winner pays. */
  price: bigint | null;
  reserve: bigint | null;
  reserveMet: boolean;
  /** When a candle sale's candle went out. */
  candleOut?: number;
}

/** How long a candle sale's candle can burn before going out: the last quarter of the room, between one minute and one day. */
export function candleWindow(createdAt: number, closesAt: number): number {
  return Math.min(Math.max((closesAt - createdAt) / 4, 60_000), 24 * 60 * 60_000);
}

/**
 * When a candle sale ended. drand's randomness for a round is the SHA-256 of its signature,
 * and the room maps it onto the window, so anyone with the signature gets the same moment and nobody knew it in advance.
 */
export function candleOut(terms: RoomTerms, signature: string): number {
  const from = terms.candleFrom ?? terms.closesAt;
  const span = terms.closesAt - from;
  if (span <= 0) return terms.closesAt;
  const r = sha256(hexToBytes(signature));
  const view = new DataView(r.buffer, r.byteOffset, r.byteLength);
  const n = view.getUint32(0) * 2 ** 16 + view.getUint16(4);
  return from + (n % (span + 1));
}

/** The order bids reached the room in. */
export const byArrival = (a: { at: number; seq: number }, b: { at: number; seq: number }) => a.at - b.at || a.seq - b.seq;

const max = (...values: bigint[]) => values.reduce((a, b) => (a > b ? a : b));
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));

/**
 * Applies a room's rules to what arrived. Every member runs this on the same data and gets the same result.
 * `opened` maps a bid id to what its envelope held, or null when it did not open with this room's seal.
 * `out` is when a candle sale's candle went out, from `candleOut`.
 */
export function judge(terms: RoomTerms, arrived: SealedBid[], opened: Map<string, Opened | null>, reserve: bigint | null, out?: number): Outcome {
  const deposit = BigInt(terms.deposit);
  const candle = terms.format === "candle";
  const cutoff = candle && out !== undefined ? out : terms.closesAt;
  const firstSeen = new Map<string, number>();
  for (const bid of [...arrived].sort(byArrival)) {
    if (!firstSeen.has(bid.envelope)) firstSeen.set(bid.envelope, bid.seq);
  }

  const judged: Judged[] = arrived.map((bid) => {
    const inside = opened.get(bid.id) ?? null;
    const base = { id: bid.id, seq: bid.seq, at: bid.at, amount: inside?.amount ?? null, name: inside?.name ?? null };
    if (terms.paddles !== undefined && (bid.paddle === undefined || bid.paddle < 1 || bid.paddle > terms.paddles)) return { ...base, void: "paddle" };
    if (bid.at > terms.closesAt) return { ...base, void: "late" };
    if (bid.at > cutoff) return { ...base, void: "candle" };
    if (BigInt(bid.deposit) < deposit) return { ...base, void: "deposit" };
    if (firstSeen.get(bid.envelope) !== bid.seq) return { ...base, void: "copy" };
    if (inside === null) return { ...base, void: "unreadable" };
    if (inside.amount < deposit) return { ...base, void: "low" };
    return base;
  });

  const counted = judged
    .filter((b) => !b.void)
    .sort((a, b) => (a.amount! === b.amount! ? a.at - b.at || a.seq - b.seq : a.amount! > b.amount! ? -1 : 1));
  const voided = judged.filter((b) => b.void).sort(byArrival);
  const bids = [...counted, ...voided];
  const base = { bids, reserve, ...(candle && out !== undefined ? { candleOut: out } : {}) };

  const units = terms.format === "several" ? Math.max(1, terms.units ?? 1) : 1;
  const floor = max(reserve ?? 0n, deposit);
  const winners = counted.filter((b) => b.amount! >= floor).slice(0, units);
  if (!winners.length) return { ...base, winners: [], price: null, reserveMet: false };

  const lowest = winners[winners.length - 1].amount!;
  let price: bigint;
  if (terms.format === "first" || terms.format === "candle") price = winners[0].amount!;
  else price = min(max(counted[winners.length]?.amount ?? 0n, floor), lowest);
  return { ...base, winners, price, reserveMet: true };
}
