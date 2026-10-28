import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from "./bytes";

// The code book. A code is 80 random bits in Crockford base32, read aloud or pasted.
// From a code the browser derives two things that can't be turned back into it: the lookup id the directory stores,
// and the key that seals the code's admission (the room key and a paddle). The directory sees neither the code nor the admission's contents.

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const codeLength = 16;

/** A new code: 16 characters, 80 bits. */
export function newCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < codeLength; i++) {
    out = crockford[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

/** Reads what someone typed: case, spaces and dashes don't matter, and look-alike letters read as the digits they resemble. */
export function normalizeCode(input: string): string | null {
  const text = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (text.length !== codeLength) return null;
  for (const ch of text) if (!crockford.includes(ch)) return null;
  return text;
}

/** Groups a code in fours for reading. */
export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** The id the directory files a code under: a hash, so a leaked database gives nobody a code. */
export function codeId(code: string): string {
  return bytesToHex(sha256(utf8.encode(`inchcandle/code/id/${code}`))).slice(0, 32);
}

function wrapKey(code: string): Uint8Array {
  return hkdf(sha256, utf8.encode(code), utf8.encode("inchcandle/code"), utf8.encode("wrap"), 32);
}

/** Seals bytes under a 32-byte key with AES-GCM: a random 12-byte nonce, then the ciphertext. */
export function sealWith(key: Uint8Array, plain: Uint8Array, aad: Uint8Array = new Uint8Array()): Uint8Array {
  const nonce = randomBytes(12);
  return concat(nonce, gcm(key, nonce, aad).encrypt(plain));
}

export function openWith(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array = new Uint8Array()): Uint8Array {
  return gcm(key, sealed.subarray(0, 12), aad).decrypt(sealed.subarray(12));
}

/** What a code opens: the room, its key and the paddle this code holds. */
export interface Admission {
  v: 1;
  room: string;
  /** The room key, base64url. It opens the room's terms. */
  key: string;
  paddle: number;
}

export function sealAdmission(code: string, admission: Admission): string {
  return toBase64Url(sealWith(wrapKey(code), utf8.encode(JSON.stringify(admission)), utf8.encode(codeId(code))));
}

/** Opens an admission with the code that made it. Throws if the code is wrong or the admission was altered. */
export function openAdmission(code: string, sealed: string): Admission {
  const admission = JSON.parse(fromUtf8.decode(openWith(wrapKey(code), fromBase64Url(sealed), utf8.encode(codeId(code))))) as Admission;
  if (admission.v !== 1 || typeof admission.room !== "string" || typeof admission.key !== "string") throw new Error("Not an admission");
  return admission;
}

/** A room key: 32 random bytes that seal a private room's terms. */
export const newRoomKey = () => randomBytes(32);

export function sealTerms(roomKey: Uint8Array, roomId: string, terms: unknown): string {
  return toBase64Url(sealWith(roomKey, utf8.encode(JSON.stringify(terms)), utf8.encode(`inchcandle/terms/${roomId}`)));
}

export function openTerms<T>(roomKey: Uint8Array, roomId: string, sealed: string): T {
  return JSON.parse(fromUtf8.decode(openWith(roomKey, fromBase64Url(sealed), utf8.encode(`inchcandle/terms/${roomId}`)))) as T;
}

/** Makes a code book: one code per paddle, each with its sealed admission. The codes stay with the host; only ids and admissions go to the directory. */
export function makeBook(roomId: string, roomKey: Uint8Array, paddles: number[]) {
  return paddles.map((paddle) => {
    const code = newCode();
    return { code, paddle, entry: { id: codeId(code), paddle, admission: sealAdmission(code, { v: 1, room: roomId, key: toBase64Url(roomKey), paddle }) } };
  });
}

// Attesters receive the room key sealed to their P-256 box key: an ephemeral ECDH share, HKDF, then AES-GCM.

export function sealToBox(boxKey: Uint8Array, roomId: string, roomKey: Uint8Array): string {
  const ephemeral = p256.utils.randomSecretKey();
  const shared = p256.getSharedSecret(ephemeral, boxKey).subarray(1);
  const key = hkdf(sha256, shared, utf8.encode("inchcandle/box"), utf8.encode(roomId), 32);
  return toBase64Url(concat(p256.getPublicKey(ephemeral, false), sealWith(key, roomKey, utf8.encode(roomId))));
}

export function openFromBox(boxSecret: Uint8Array, roomId: string, sealed: string): Uint8Array {
  const bytes = fromBase64Url(sealed);
  const shared = p256.getSharedSecret(boxSecret, bytes.subarray(0, 65)).subarray(1);
  const key = hkdf(sha256, shared, utf8.encode("inchcandle/box"), utf8.encode(roomId), 32);
  return openWith(key, bytes.subarray(65), utf8.encode(roomId));
}
