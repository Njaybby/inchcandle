import { bls12_381 } from "@noble/curves/bls12-381.js";
import { quicknet, roundId } from "./rounds";

const hosts = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh", "https://drand.cloudflare.com"];
const dst = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

/** Checks a round's signature against the quicknet key, so no drand server has to be trusted. */
export function verifyBeacon(round: number, signature: string): boolean {
  try {
    const message = bls12_381.G1.hashToCurve(roundId(round), { DST: dst });
    const sig = bls12_381.G1.Point.fromHex(signature);
    const key = bls12_381.G2.Point.fromHex(quicknet.publicKey);
    const left = bls12_381.pairing(sig, bls12_381.G2.Point.BASE);
    const right = bls12_381.pairing(message as unknown as typeof sig, key);
    return bls12_381.fields.Fp12.eql(left, right);
  } catch {
    return false;
  }
}

export class TooEarly extends Error {}

/** Fetches a round's signature from the first drand server that answers, and verifies it. */
export async function fetchBeacon(round: number, signal?: AbortSignal): Promise<string> {
  let last: unknown = new Error("No drand server answered");
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/${quicknet.chainHash}/public/${round}`, { signal, cache: "no-store" });
      if (res.status === 425) throw new TooEarly(`Round ${round} has not been signed yet`);
      if (!res.ok) throw new Error(`${host} answered ${res.status}`);
      const body = (await res.json()) as { round: number; signature: string };
      if (body.round !== round) throw new Error(`${host} sent round ${body.round}`);
      if (!verifyBeacon(round, body.signature)) throw new Error(`${host} sent a signature that does not verify`);
      return body.signature;
    } catch (error) {
      if (error instanceof TooEarly || signal?.aborted) throw error;
      last = error;
    }
  }
  throw last;
}
