import { useSyncExternalStore } from "react";
import { quicknet, roundAt } from "./rounds";

// The drand network's latest round, fetched every 3 seconds and checked against the network's key in this browser.
// One poller serves the whole app: the hero's sweep, the sidebar and the floor all read the same verified round.

export type Live =
  | { status: "checking" }
  | { status: "verified"; round: number; at: number; signature: string; ms: number }
  | { status: "offline" };

let state: Live = { status: "checking" };
const listeners = new Set<() => void>();
let started = false;

function set(next: Live) {
  state = next;
  listeners.forEach((l) => l());
}

async function tick() {
  if (document.hidden) {
    setTimeout(tick, 1000);
    return;
  }
  try {
    const { fetchBeacon, TooEarly } = await import("./drand");
    let round = roundAt(Date.now());
    let signature: string;
    const t0 = performance.now();
    try {
      signature = await fetchBeacon(round);
    } catch (error) {
      if (!(error instanceof TooEarly)) throw error;
      round -= 1;
      signature = await fetchBeacon(round);
    }
    if (state.status !== "verified" || state.round !== round) set({ status: "verified", round, at: Date.now(), signature, ms: Math.round(performance.now() - t0) });
  } catch {
    if (!(state.status === "verified" && Date.now() - state.at < 15_000)) set({ status: "offline" });
  }
  setTimeout(tick, quicknet.period * 1000);
}

export function useLive(): Live {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!started) {
        started = true;
        tick();
      }
      return () => listeners.delete(l);
    },
    () => state,
  );
}
