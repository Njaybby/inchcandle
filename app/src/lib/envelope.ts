import { concat, fromBase64Url, randomBytes, toBase64Url } from "./bytes";

// A sealed envelope starts with a 14-byte head: "IC", the round as a big-endian u32, and the 8-byte room tag.
// Next comes a one-time key, encrypted to the round with Boneh-Franklin IBE on G2 as U, V and W (96, 32 and 32 bytes).
// Last is the payload, sealed with ChaCha20-Poly1305 under that key with the head as associated data.
// The key is used once, so a zero nonce is safe.
// A candle sale's bids are meant to be seen, so its envelopes are open: "IO", the room tag, then the payload as it is.

export const magic = [0x49, 0x43];
export const openMagic = [0x49, 0x4f];
export const headLength = 14;
export const keyEnd = headLength + 160;
export const memoPrefix = "IC1 ";

export interface Payload {
  amount: bigint;
  /** SHA-256 of the bidder's claim secret. */
  claim: Uint8Array;
  /** The bidder's room name. Version 1 payloads have none. */
  name: number | null;
}

/** Version 2: the version byte, the amount as a u64, the claim hash, the name as a u16, and 16 random bytes. */
export function encodePayload({ amount, claim, name }: Payload): Uint8Array {
  const out = new Uint8Array(1 + 8 + 32 + 2 + 16);
  const view = new DataView(out.buffer);
  out[0] = 2;
  view.setBigUint64(1, amount);
  out.set(claim, 9);
  view.setUint16(41, name ?? 0xffff);
  out.set(randomBytes(16), 43);
  return out;
}

export function decodePayload(bytes: Uint8Array): Payload {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 57 && bytes[0] === 1) return { amount: view.getBigUint64(1), claim: bytes.slice(9, 41), name: null };
  if (bytes.length === 59 && bytes[0] === 2) {
    const name = view.getUint16(41);
    return { amount: view.getBigUint64(1), claim: bytes.slice(9, 41), name: name === 0xffff ? null : name };
  }
  throw new Error("Unknown payload");
}

export function readHead(envelope: Uint8Array): { round: number; tag: Uint8Array } | null {
  if (envelope.length < keyEnd + 16 || envelope[0] !== magic[0] || envelope[1] !== magic[1]) return null;
  return {
    round: new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(2),
    tag: envelope.slice(6, headLength),
  };
}

export function openEnvelope(tag: Uint8Array, payload: Uint8Array): Uint8Array {
  return concat(new Uint8Array(openMagic), tag, payload);
}

/** Reads an open envelope. Returns null for anything else, sealed envelopes included. */
export function readOpen(envelope: Uint8Array): { tag: Uint8Array; payload: Payload } | null {
  if (envelope.length < 10 || envelope[0] !== openMagic[0] || envelope[1] !== openMagic[1]) return null;
  try {
    return { tag: envelope.slice(2, 10), payload: decodePayload(envelope.subarray(10)) };
  } catch {
    return null;
  }
}

export function memoFor(envelope: Uint8Array): string {
  return memoPrefix + toBase64Url(envelope);
}

export function envelopeFromMemo(memo: string): Uint8Array | null {
  if (!memo.startsWith(memoPrefix)) return null;
  try {
    return fromBase64Url(memo.slice(memoPrefix.length).trim());
  } catch {
    return null;
  }
}
