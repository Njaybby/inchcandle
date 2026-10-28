import { useSyncExternalStore } from "react";
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from "./bytes";
import { idbGet, idbPut } from "./idb";
import { canonical, deviceId, keyHeader, sigHeader, timeHeader } from "./wire";

// This browser's identity and secrets.
// The device key signs every request that needs to say who is asking. It is a non-extractable WebCrypto key, so it can be used here but never copied out.
// Room keys, the host's code books and bid claim keys live in one bundle, encrypted under a second non-extractable key, so nothing secret sits in plain storage.

interface Keys {
  sign: CryptoKey;
  raw: Uint8Array;
  local: CryptoKey;
}

export interface Device {
  id: string;
  /** The raw public key, base64url. */
  key: string;
}

/** What this browser knows about one room. */
export interface RoomSecret {
  role: "host" | "member";
  /** The room key, base64url. Absent for a public room joined without a code. */
  key?: string;
  paddle?: number;
  /** The host's code book: each code and its paddle. Only the host holds the codes themselves. */
  book?: { code: string; paddle: number }[];
  /** The code this device joined with, kept so the member can see which one they used. */
  code?: string;
  name?: string | null;
  /** The host's seed for the room's Zcash account, which signs refunds. */
  zseed?: string;
  at: number;
}

interface Bundle {
  v: 1;
  rooms: Record<string, RoomSecret>;
  /** Claim keys by bid id, hex. */
  claims: Record<string, string>;
  /** This visitor's own wallet. */
  wallet?: WalletSecret;
}

/** The seed behind this visitor's Zcash and EVM accounts. "signed" seeds come back from the same wallet signature on any device. */
export interface WalletSecret {
  seed: string;
  /** The first block the Zcash account scans from, per network. */
  birthdays: Record<string, number>;
  source: "fresh" | "signed";
  at: number;
}

let keysPromise: Promise<Keys> | null = null;
let bundle: Bundle = { v: 1, rooms: {}, claims: {} };
let ready: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

async function makeKeys(): Promise<Keys> {
  const stored = await idbGet<{ sign: CryptoKey; public: CryptoKey; local: CryptoKey }>("secrets", "device");
  if (stored) {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", stored.public));
    return { sign: stored.sign, raw, local: stored.local };
  }
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const local = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut("secrets", "device", { sign: pair.privateKey, public: pair.publicKey, local });
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { sign: pair.privateKey, raw, local };
}

function keys(): Promise<Keys> {
  keysPromise ??= makeKeys();
  return keysPromise;
}

/** Loads this device's secrets into memory. The app waits for it once at start. */
export function hydrate(): Promise<void> {
  ready ??= (async () => {
    const { local } = await keys();
    const sealed = await idbGet<{ iv: Uint8Array; data: ArrayBuffer }>("secrets", "bundle");
    if (sealed) {
      try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, local, sealed.data);
        bundle = JSON.parse(fromUtf8.decode(new Uint8Array(plain))) as Bundle;
      } catch {
        bundle = { v: 1, rooms: {}, claims: {} };
      }
    }
    changed();
  })();
  return ready;
}

function changed() {
  version++;
  listeners.forEach((l) => l());
}

async function persist() {
  const { local } = await keys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, local, utf8.encode(JSON.stringify(bundle)));
  await idbPut("secrets", "bundle", { iv, data });
}

/** Re-renders whenever this device's secrets change. */
export function useSecretsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export const secrets = {
  room: (id: string): RoomSecret | undefined => bundle.rooms[id],
  rooms: (): [string, RoomSecret][] => Object.entries(bundle.rooms).sort(([, a], [, b]) => b.at - a.at),
  roomKey(id: string): Uint8Array | null {
    const key = bundle.rooms[id]?.key;
    return key ? fromBase64Url(key) : null;
  },
  async saveRoom(id: string, secret: RoomSecret) {
    bundle = { ...bundle, rooms: { ...bundle.rooms, [id]: secret } };
    changed();
    await persist();
  },
  async updateRoom(id: string, patch: Partial<RoomSecret>) {
    const current = bundle.rooms[id];
    if (!current) return;
    await secrets.saveRoom(id, { ...current, ...patch });
  },
  async forgetRoom(id: string) {
    const rooms = { ...bundle.rooms };
    delete rooms[id];
    bundle = { ...bundle, rooms };
    changed();
    await persist();
  },
  wallet: (): WalletSecret | undefined => bundle.wallet,
  async saveWallet(wallet: WalletSecret | undefined) {
    bundle = { ...bundle, wallet };
    changed();
    await persist();
  },
  claimKey: (bidId: string): string | undefined => bundle.claims[bidId],
  async saveClaimKey(bidId: string, hex: string) {
    bundle = { ...bundle, claims: { ...bundle.claims, [bidId]: hex } };
    changed();
    await persist();
  },
};

export async function device(): Promise<Device> {
  const { raw } = await keys();
  return { id: deviceId(raw), key: toBase64Url(raw) };
}

/** The headers that sign one request as this device. */
export async function signRequest(method: string, path: string, body: string): Promise<Record<string, string>> {
  const { sign, raw } = await keys();
  const time = String(Date.now());
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, sign, utf8.encode(canonical(method, path, time, body)));
  return { [keyHeader]: toBase64Url(raw), [timeHeader]: time, [sigHeader]: toBase64Url(new Uint8Array(sig)) };
}
