import { sha256 } from "@noble/hashes/sha2.js";

/** drand quicknet: a new BLS signature every 3 seconds from the League of Entropy. */
export const quicknet = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesis: 1692803367,
  period: 3,
} as const;

export function roundAt(ms: number): number {
  return Math.floor((ms / 1000 - quicknet.genesis) / quicknet.period) + 1;
}

export function roundTime(round: number): number {
  return (quicknet.genesis + (round - 1) * quicknet.period) * 1000;
}

/** The identity a round signs: SHA-256 of the round number as 8 big-endian bytes. */
export function roundId(round: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(round));
  return sha256(bytes);
}
