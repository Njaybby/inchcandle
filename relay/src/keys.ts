import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { canonical, deviceId, keyHeader, sigHeader, timeHeader } from "../../app/src/lib/wire";
import { fromBase64Url, toBase64Url } from "../../app/src/lib/bytes";

// An attester's keys: an EVM key that signs settlements, a P-256 device key that signs its requests to the directory,
// and a P-256 box key the host seals private rooms' keys to. The files live in relay/keys, which is never committed.

export interface AttesterKeys {
  name: string;
  evmKey: `0x${string}`;
  deviceSecret: string;
  boxSecret: string;
}

export const root = new URL("../", import.meta.url).pathname;

export function loadAttester(n: number): AttesterKeys {
  return JSON.parse(readFileSync(`${root}keys/attester-${n}.json`, "utf8"));
}

/** Keys from IC_ATTESTER_KEYS (the key file's JSON) when hosted, else from relay/keys. */
export function attesterFromEnv(n: number): AttesterKeys {
  return process.env.IC_ATTESTER_KEYS ? JSON.parse(process.env.IC_ATTESTER_KEYS) : loadAttester(n);
}

export function devicePublic(secret: string): Uint8Array {
  return p256.getPublicKey(fromBase64Url(secret), false);
}

export function deviceIdOf(secret: string): string {
  return deviceId(devicePublic(secret));
}

/** Signs one request to the directory the way a browser device does, so the directory treats an attester like any other device. */
export function signRequest(secret: string, method: string, path: string, body: string): Record<string, string> {
  const time = String(Date.now());
  const sig = p256.sign(new TextEncoder().encode(canonical(method, path, time, body)), fromBase64Url(secret), { prehash: true, format: "compact" } as never) as Uint8Array;
  return { [keyHeader]: toBase64Url(devicePublic(secret)), [timeHeader]: time, [sigHeader]: toBase64Url(sig) };
}
