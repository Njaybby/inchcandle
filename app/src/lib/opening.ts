import { useEffect, useState } from "react";
import { equalBytes, fromBase64Url } from "./bytes";
import { roundTime } from "./rounds";
import { sleep } from "./hooks";
import { roomTag } from "./ids";
import type { Opened, Outcome } from "./rules";
import { readOpen } from "./envelope";
import { local } from "./store";
import type { RoomTerms, SealedBid } from "./types";

export type OpeningState =
  | { status: "sealed" }
  | { status: "fetching"; retrying: boolean }
  | {
      status: "opened";
      outcome: Outcome;
      signature: string;
      /** True when the bids opened while this page was on screen, so the opening is played. */
      live: boolean;
      opened: number;
      reserveOpened: boolean;
    };

/** Reads a candle sale's open bids, which anyone in the room can do at any time. Null marks a bid that isn't a readable open envelope for this room. */
export function openBids(terms: RoomTerms, arrived: SealedBid[]): Map<string, Opened | null> {
  const tag = roomTag(terms.id);
  const out = new Map<string, Opened | null>();
  for (const bid of arrived) {
    try {
      const read = readOpen(fromBase64Url(bid.envelope));
      out.set(bid.id, read && equalBytes(read.tag, tag) ? { amount: read.payload.amount, name: read.payload.name } : null);
    } catch {
      out.set(bid.id, null);
    }
  }
  return out;
}

/** Fetches the room's drand signature once its round is due, opens every bid with it and applies the rules. In a candle sale the signature picks when the candle went out. */
export function useOpening(terms: RoomTerms | null, arrived: SealedBid[], now: number): OpeningState {
  const due = terms ? now >= roundTime(terms.round) : false;
  const [state, setState] = useState<OpeningState>({ status: "sealed" });
  const arrivedKey = arrived.map((b) => b.id).join(",");

  useEffect(() => {
    if (!terms) return;
    const cached = local.opening(terms.id);
    if (!due && !cached) {
      setState({ status: "sealed" });
      return;
    }
    let live = true;
    const abort = new AbortController();
    (async () => {
      const [{ fetchBeacon, TooEarly, verifyBeacon }, { openAll }] = await Promise.all([import("./drand"), import("./openAll")]);
      const usable = cached && cached.round === terms.round && verifyBeacon(terms.round, cached.signature) ? cached.signature : null;
      if (!due && !usable) {
        if (live) setState({ status: "sealed" });
        return;
      }
      let signature = usable;
      let tries = 0;
      while (!signature) {
        setState({ status: "fetching", retrying: tries > 0 });
        try {
          signature = await fetchBeacon(terms.round, abort.signal);
          local.saveOpening(terms.id, { round: terms.round, signature });
        } catch (error) {
          if (!live) return;
          tries++;
          await sleep(error instanceof TooEarly ? 1500 : Math.min(2000 * tries, 10_000));
          if (!live) return;
        }
      }

      const result = await openAll(terms, arrived, signature);
      if (!live) return;
      const { outcome, opened, reserveOpened } = result;
      local.saveResult(terms.id, { winners: outcome.winners.map((w) => w.id), price: outcome.price?.toString() ?? null });
      setState({
        status: "opened",
        outcome,
        signature,
        live: !usable,
        opened,
        reserveOpened,
      });
    })();
    return () => {
      live = false;
      abort.abort();
    };
    // Re-run when the round falls due or a new bid arrives.
  }, [terms?.id, terms?.round, due, arrivedKey]);

  return state;
}
