import { encryptOnG2RFC9380, decryptOnG2 } from "tlock-js/crypto/ibe";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { quicknet, roundId } from "./rounds";
import { concat, hexToBytes, randomBytes } from "./bytes";
import { headLength, keyEnd, magic, readHead } from "./envelope";

/** Seals a payload so that only the given drand round's signature can open it. */
export async function seal(round: number, tag: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
  const key = randomBytes(32);
  const ct = await encryptOnG2RFC9380(hexToBytes(quicknet.publicKey), roundId(round), key);
  const head = new Uint8Array(headLength);
  head.set(magic);
  new DataView(head.buffer).setUint32(2, round);
  head.set(tag, 6);
  const body = chacha20poly1305(key, new Uint8Array(12), head).encrypt(payload);
  return concat(head, ct.U, ct.V, ct.W, body);
}

/** Opens an envelope with the round's signature. Throws if the envelope was altered. */
export async function unseal(envelope: Uint8Array, signature: string): Promise<Uint8Array> {
  if (!readHead(envelope)) throw new Error("Not an Inchcandle envelope");
  const head = envelope.subarray(0, headLength);
  const key = await decryptOnG2(hexToBytes(signature), {
    U: envelope.subarray(headLength, headLength + 96),
    V: envelope.subarray(headLength + 96, headLength + 128),
    W: envelope.subarray(headLength + 128, keyEnd),
  });
  return chacha20poly1305(key, new Uint8Array(12), head).decrypt(envelope.subarray(keyEnd));
}
