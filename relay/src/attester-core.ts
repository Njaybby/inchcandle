import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { fromBase64Url } from "../../app/src/lib/bytes";
import { openFromBox, openTerms } from "../../app/src/lib/codes";
import { fetchBeacon, TooEarly } from "../../app/src/lib/drand";
import { openAll, paymentWindow } from "../../app/src/lib/openAll";
import { roundTime } from "../../app/src/lib/rounds";
import { claimAddress, resultHash, roomIdBytes, settlementTypes, noSaleTypes } from "../../app/src/lib/vault";
import type { AttestationRow, RoomRecord, Settlement, WireBid } from "../../app/src/lib/api-types";
import type { RoomTerms, SealedBid } from "../../app/src/lib/types";
import { signRequest, type AttesterKeys } from "./keys";

// One attester. It reads every room whose vault names it, and once a room's round has passed it does what every member's browser does:
// verify the round's signature, open every bid, apply the rules. Then it checks the winner's balance arrived and signs the settlement.
// It signs exactly one result per room and never signs for a room it can't open.
// tick() is one pass over the worklist and keeps no state between passes, so it runs the same in a loop or in a serverless function.

export function attester(keys: AttesterKeys, base: string) {
  const account = privateKeyToAccount(keys.evmKey);
  const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), `[${keys.name}]`, ...a);
  const debug = (...a: unknown[]) => process.env.IC_DEBUG && log(...a);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const url = `/api${path}`;
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", ...signRequest(keys.deviceSecret, method, url, text) }, body: method === "GET" ? undefined : text });
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message ?? ""}`);
    return data as T;
  }

  async function termsOf(room: RoomRecord): Promise<RoomTerms | null> {
    if (room.terms) return room.terms;
    if (!room.sealed) return null;
    const { sealed } = await call<{ sealed: string }>("GET", `/rooms/${room.id}/grant`);
    const key = openFromBox(fromBase64Url(keys.boxSecret), room.id, sealed);
    return openTerms<RoomTerms>(key, room.id, room.sealed);
  }

  async function sign(terms: RoomTerms, body: Settlement): Promise<Hex> {
    const domain = { name: "Inchcandle Vault", version: "1", chainId: terms.vault!.chainId, verifyingContract: terms.vault!.address as Address } as const;
    if (body.kind === "settle")
      return account.signTypedData({ domain, types: settlementTypes, primaryType: "Settlement", message: { roomId: roomIdBytes(terms.id), claimKey: body.claimKey as Address, price: BigInt(body.price), resultHash: body.resultHash as Hex } });
    return account.signTypedData({ domain, types: noSaleTypes, primaryType: "NoSale", message: { roomId: roomIdBytes(terms.id), resultHash: body.resultHash as Hex } });
  }

  const done = new Set<string>();

  async function consider(room: RoomRecord) {
    if (done.has(room.id)) return;
    const terms = await termsOf(room);
    if (!terms?.vault || !terms.vault.attesters.some((a) => a.toLowerCase() === account.address.toLowerCase())) return debug(room.id, "not on this vault's committee");
    if (Date.now() < roundTime(terms.round)) return debug(room.id, "round not reached");
    const existing = await call<{ attestations: AttestationRow[] }>("GET", `/rooms/${room.id}/attestations`);
    if (existing.attestations.some((a) => a.attester.toLowerCase() === account.address.toLowerCase())) {
      done.add(room.id);
      return;
    }

    let signature: string;
    try {
      signature = await fetchBeacon(terms.round);
    } catch (e) {
      if (!(e instanceof TooEarly)) log(room.id, "drand unreachable, will retry");
      return;
    }
    const wire = await call<{ bids: WireBid[] }>("GET", `/rooms/${room.id}/bids`);
    const arrived: SealedBid[] = wire.bids.map((b) => ({ id: b.id, envelope: b.envelope, deposit: b.deposit, at: b.at, seq: b.seq, paddle: b.paddle }));
    const { outcome, claims } = await openAll(terms, arrived, signature);
    const hash = resultHash(terms.id, outcome);
    const base = { vault: terms.vault.address, chainId: terms.vault.chainId, roomId: terms.id, resultHash: hash };

    let body: Settlement | null = null;
    const winner = outcome.winners[0];
    const claim = winner ? claimAddress(claims.get(winner.id) ?? new Uint8Array()) : null;
    if (!winner || outcome.price === null || !claim) {
      body = { ...base, kind: "nosale", claimKey: "0x0000000000000000000000000000000000000000", price: "0" };
      log(room.id, winner ? "winner carries no claim key, attesting no sale" : "no sale");
    } else {
      const balance = outcome.price > BigInt(terms.deposit) ? outcome.price - BigInt(terms.deposit) : 0n;
      let paid = balance === 0n;
      if (!paid) {
        const { payments } = await call<{ payments: { claimKey: string; amount: string }[] }>("GET", `/rooms/${room.id}/payments`);
        paid = payments.some((p) => p.claimKey === claim.toLowerCase() && BigInt(p.amount) >= balance);
      }
      if (paid) {
        body = { ...base, kind: "settle", claimKey: claim, price: outcome.price.toString() };
        log(room.id, `winner ${claim} pays ${outcome.price} zat, balance ${paid ? "paid" : "due"}`);
      } else if (Date.now() > roundTime(terms.round) + paymentWindow(terms)) {
        body = { ...base, kind: "nosale", claimKey: "0x0000000000000000000000000000000000000000", price: "0" };
        log(room.id, "winner never paid the balance, attesting no sale");
      } else {
        return debug(room.id, `waiting for the balance until ${new Date(roundTime(terms.round) + paymentWindow(terms)).toISOString()}`);
      }
    }
    const sig = await sign(terms, body);
    await call("POST", `/rooms/${room.id}/attestations`, { body, signature: sig });
    done.add(room.id);
    log(room.id, `signed ${body.kind}, result ${hash.slice(0, 18)}…`);
  }

  /** One pass over every room on this attester's worklist. Returns how many rooms it looked at. */
  async function tick(): Promise<number> {
    const { rooms } = await call<{ rooms: RoomRecord[] }>("GET", "/attester/rooms");
    for (const room of rooms) {
      try {
        await consider(room);
      } catch (e) {
        log(room.id, "error", e instanceof Error ? e.message : e);
      }
    }
    return rooms.length;
  }

  return { address: account.address, name: keys.name, log, tick };
}
