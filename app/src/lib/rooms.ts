import { sha256 } from "@noble/hashes/sha2.js";
import { api, ApiError } from "./api";
import type { Attester, DirectoryRoom, Listing, Network, RoomRecord } from "./api-types";
import { fromBase64Url, randomBytes, toBase64Url, bytesToHex } from "./bytes";
import { codeId, makeBook, newRoomKey, normalizeCode, openAdmission, openTerms, sealTerms, sealToBox } from "./codes";
import { secrets } from "./device";
import { encodePayload, openEnvelope } from "./envelope";
import { newId, roomTag } from "./ids";
import { roundAt, roundTime } from "./rounds";
import { candleWindow } from "./rules";
import { local } from "./store";
import type { Format, LotKind, MyBid, RoomTerms, VaultRef } from "./types";
import { claimField, newClaimKey } from "./vault";

// Rooms as the app sees them: what the directory lists, opened with this device's keys where it holds them.

/** How long after closing the room opens: enough for the last bids to settle. */
export const openingDelay = 20_000;

export function openingRound(closesAt: number): number {
  return roundAt(closesAt + openingDelay);
}

export function fingerprint(id: string): string {
  return bytesToHex(roomTag(id));
}

export type Phase = "open" | "closing" | "waiting" | "opened";

/** Where a room is in its life: open, closing within the hour, closed and waiting for its round, or opened. */
export function phase(terms: RoomTerms, now = Date.now()): Phase {
  if (now >= roundTime(terms.round)) return "opened";
  if (now >= terms.closesAt) return "waiting";
  if (terms.closesAt - now < 60 * 60_000) return "closing";
  return "open";
}

export interface Seen {
  room: DirectoryRoom | RoomRecord;
  /** The terms, when they are public or this device holds the room key. */
  terms: RoomTerms | null;
  /** What this device is in the room. */
  role: "host" | "member" | null;
  paddle?: number;
}

/** Opens a directory entry with whatever this device knows about it. */
export function see(room: DirectoryRoom | RoomRecord): Seen {
  const secret = secrets.room(room.id);
  let terms: RoomTerms | null = room.terms ?? null;
  if (!terms && "sealed" in room && room.sealed) {
    const key = secrets.roomKey(room.id);
    if (key) {
      try {
        terms = openTerms<RoomTerms>(key, room.id, room.sealed);
      } catch {
        terms = null;
      }
    }
  }
  const you = "you" in room ? room.you : undefined;
  const role = you?.role === "host" || secret?.role === "host" ? "host" : you?.role === "member" || secret?.role === "member" ? "member" : null;
  return { room, terms, role, paddle: you?.paddle ?? secret?.paddle };
}

export interface NewRoomInput {
  name: string;
  line: string;
  about?: string;
  photo?: string;
  credit?: string;
  lot: { kind: LotKind; detail?: string };
  format: Format;
  units?: number;
  closesAt: number;
  deposit: bigint;
  reserve: bigint | null;
  network: Network;
  listing: Listing;
  /** Paddles: the code count for a private room, the cap for a public one. */
  paddles: number;
  vault?: VaultRef;
  /** The committee that attests for the vault, to seal the room key to. */
  committee?: Attester[];
  /** Fixed in advance when a vault was opened under it. */
  id?: string;
}

export interface Created {
  record: RoomRecord;
  terms: RoomTerms;
  book: { code: string; paddle: number }[];
}

export async function createRoom(input: NewRoomInput): Promise<Created> {
  const id = input.id ?? newId();
  const createdAt = Date.now();
  const round = openingRound(input.closesAt);
  const { seal } = await import("./seal");
  const reserve = input.reserve === null ? undefined : toBase64Url(await seal(round, roomTag(id), encodePayload({ amount: input.reserve, claim: new Uint8Array(32), name: null })));
  const terms: RoomTerms = {
    v: 1,
    id,
    name: input.name.trim(),
    line: input.line.trim(),
    about: input.about?.trim() || undefined,
    closesAt: input.closesAt,
    round,
    deposit: input.deposit.toString(),
    format: input.format,
    ...(input.format === "several" ? { units: input.units ?? 2 } : {}),
    ...(input.format === "candle" ? { candleFrom: input.closesAt - candleWindow(createdAt, input.closesAt) } : {}),
    access: input.listing === "public" ? "link" : "invite",
    after: "private",
    reserve,
    photo: input.photo,
    credit: input.credit,
    createdAt,
    network: input.network,
    listing: input.listing,
    paddles: input.paddles,
    lot: input.lot,
    vault: input.vault,
  };

  const coded = input.listing !== "public";
  const key = coded ? newRoomKey() : null;
  const book = key ? makeBook(id, key, Array.from({ length: input.paddles }, (_, i) => i + 1)) : [];
  // Attesters get the room key sealed to their box key, so they can read a private room's bids at the opening and nothing more.
  const grants = key && input.vault && input.committee ? input.committee.filter((a) => input.vault!.attesters.map((x) => x.toLowerCase()).includes(a.address.toLowerCase())).map((a) => ({ attester: a.id, sealed: sealToBox(fromBase64Url(a.boxKey), id, key) })) : [];

  const record = await api.createRoom({
    id,
    network: input.network,
    listing: input.listing,
    name: input.listing === "hidden" ? input.name.trim() : input.name.trim(),
    fingerprint: fingerprint(id),
    paddleCap: input.paddles,
    ...(coded ? { sealed: sealTerms(key!, id, terms) } : { terms }),
    codes: book.map((b) => b.entry),
    grants,
  });
  await secrets.saveRoom(id, { role: "host", key: key ? toBase64Url(key) : undefined, book: book.map(({ code, paddle }) => ({ code, paddle })), name: terms.name, at: createdAt });
  local.addHosted(id);
  return { record, terms, book: book.map(({ code, paddle }) => ({ code, paddle })) };
}

/** Adds codes to a private room's book, for the paddles that don't have one yet. */
export async function extendBook(id: string, count: number): Promise<{ code: string; paddle: number }[]> {
  const secret = secrets.room(id);
  const key = secrets.roomKey(id);
  if (!secret || !key) throw new Error("This device doesn't hold the room's key.");
  const record = await api.room(id);
  const taken = new Set((secret.book ?? []).map((b) => b.paddle));
  const free: number[] = [];
  for (let p = 1; p <= record.paddleCap && free.length < count; p++) if (!taken.has(p)) free.push(p);
  if (!free.length) throw new Error("Every paddle in this room already has a code.");
  const book = makeBook(id, key, free);
  await api.addCodes(id, book.map((b) => b.entry));
  const added = book.map(({ code, paddle }) => ({ code, paddle }));
  await secrets.updateRoom(id, { book: [...(secret.book ?? []), ...added] });
  return added;
}

export type RedeemOutcome = { ok: true; id: string; terms: RoomTerms; paddle: number; again: boolean } | { ok: false; reason: string; code?: string };

/** Turns a typed code into membership: the directory checks its fingerprint once, and the code itself opens the admission here. */
export async function redeem(input: string): Promise<RedeemOutcome> {
  const code = normalizeCode(input);
  if (!code) return { ok: false, reason: "A code is 16 letters and digits, like 7KQM-2X9D-H4TA-PW3C." };
  try {
    const result = await api.redeem(codeId(code));
    const admission = openAdmission(code, result.admission);
    const key = fromBase64Url(admission.key);
    const terms = openTerms<RoomTerms>(key, admission.room, result.room.sealed!);
    await secrets.saveRoom(admission.room, { role: "member", key: admission.key, paddle: admission.paddle, code, name: terms.name, at: Date.now() });
    local.addJoined(admission.room);
    return { ok: true, id: admission.room, terms, paddle: admission.paddle, again: result.again };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, reason: error.message, code: error.code };
    return { ok: false, reason: "That code opened something that isn't a room admission. Check it with the host." };
  }
}

/** Takes a paddle in a public room. */
export async function joinPublic(id: string, name: string): Promise<number> {
  const { paddle } = await api.join(id);
  await secrets.saveRoom(id, { role: "member", paddle, name, at: Date.now() });
  local.addJoined(id);
  return paddle;
}

/** Seals a bid in this browser. In a room with a vault the bid carries a fresh claim key, kept only on this device. */
export async function sealBid(terms: RoomTerms, amount: bigint, name: number): Promise<MyBid> {
  let claim: Uint8Array;
  let claimKey: string | undefined;
  let secret: Uint8Array | null = null;
  if (terms.vault) {
    const key = newClaimKey();
    claim = claimField(key.address);
    claimKey = key.secret;
  } else {
    secret = randomBytes(32);
    claim = sha256(secret);
  }
  const payload = encodePayload({ amount, claim, name });
  const envelope = terms.format === "candle" ? openEnvelope(roomTag(terms.id), payload) : await (await import("./seal")).seal(terms.round, roomTag(terms.id), payload);
  const bid: MyBid = {
    id: newId(16),
    amount: amount.toString(),
    name,
    envelope: toBase64Url(envelope),
    claim: secret ? toBase64Url(secret) : "",
    sealedAt: Date.now(),
    paid: false,
  };
  if (claimKey) await secrets.saveClaimKey(bid.id, claimKey);
  return bid;
}

/** On the preview network the directory stands in for the chain: the sealed bid goes there, exactly as it would sit in a memo. */
export async function sendPreviewBid(terms: RoomTerms, bid: MyBid): Promise<void> {
  await api.placeBid(terms.id, { id: bid.id, envelope: bid.envelope, deposit: terms.deposit });
  local.saveMyBid(terms.id, { ...bid, paid: true });
}
