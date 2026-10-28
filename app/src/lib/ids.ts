import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8 } from "./bytes";

const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";

/** A random id from an alphabet without look-alike characters. */
export function newId(length = 12): string {
  return Array.from(randomBytes(length), (b) => alphabet[b % alphabet.length]).join("");
}

/** The 8-byte tag every sealed bid in a room carries, so a bid can't be replayed into another room. */
export function roomTag(id: string): Uint8Array {
  return sha256(utf8.encode(`inchcandle room ${id}`)).slice(0, 8);
}

export function isRoomId(text: string): boolean {
  return new RegExp(`^[${alphabet}]{12}$`).test(text);
}
