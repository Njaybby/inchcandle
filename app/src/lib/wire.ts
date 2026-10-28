import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase64Url, toBase64Url, utf8 } from "./bytes";

// How a browser proves which device is asking. Shared by the app, which signs, and the directory, which checks.
// A device is a P-256 key made with WebCrypto and kept non-extractable, so the key never leaves the browser that made it.

export const keyHeader = "x-ic-key";
export const timeHeader = "x-ic-time";
export const sigHeader = "x-ic-sig";

/** How far a request's clock may be from the directory's. */
export const clockSkew = 120_000;

/** The text a request signs: method, path with query, time and the body's hash. */
export function canonical(method: string, path: string, time: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${time}\n${toBase64Url(sha256(utf8.encode(body)))}`;
}

/** A device's id: the first 16 bytes of the SHA-256 of its raw public key. */
export function deviceId(rawKey: Uint8Array): string {
  return toBase64Url(sha256(rawKey).slice(0, 16));
}

const p256 = { name: "ECDSA", namedCurve: "P-256" } as const;

export async function verifyDevice(rawKeyB64: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const raw = fromBase64Url(rawKeyB64);
    if (raw.length !== 65 || raw[0] !== 4) return false;
    const key = await crypto.subtle.importKey("raw", raw as BufferSource, p256, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64Url(sigB64) as BufferSource, utf8.encode(message) as BufferSource);
  } catch {
    return false;
  }
}
