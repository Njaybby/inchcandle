import { useSyncExternalStore } from "react";
import type { MyBid, Opening, ResultNote, RoomTerms, SealedBid } from "./types";

// The local stand-in for the chain: rooms, the bids they received and who returned deposits live in this browser.
// The app talks to it only through `chain` and `local`, which the Zcash light client replaces.

const prefix = "ic.";
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.startsWith(prefix)) changed();
  });
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(prefix + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(prefix + key, JSON.stringify(value));
  changed();
}

/** Re-renders the caller whenever anything in the store changes, in this tab or another. */
export function useStoreVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}

/** What the chain would tell every member of a room. */
export const chain = {
  room: (id: string) => read<RoomTerms | null>(`room.${id}`, null),
  openRoom: (terms: RoomTerms) => write(`room.${terms.id}`, terms),
  /** The bids that have arrived so far. Example rooms schedule some of theirs, so they arrive while the room is on screen. */
  bids: (id: string, now = Date.now()) => read<SealedBid[]>(`bids.${id}`, []).filter((b) => b.at <= now),
  receive(id: string, bid: Omit<SealedBid, "seq">) {
    const bids = read<SealedBid[]>(`bids.${id}`, []);
    write(`bids.${id}`, [...bids, { ...bid, seq: Math.max(0, ...bids.map((b) => b.seq)) + 1 }]);
  },
  receiveAll(id: string, bids: SealedBid[]) {
    write(`bids.${id}`, bids);
  },
  depositsReturned: (id: string) => read<boolean>(`returned.${id}`, false),
  returnDeposits: (id: string) => write(`returned.${id}`, true),
  /** The winning bids whose balance has been paid. */
  balancesPaid: (id: string) => read<string[]>(`balances.${id}`, []),
  payBalance: (id: string, bidId: string) => write(`balances.${id}`, [...new Set([...chain.balancesPaid(id), bidId])]),
};

/** What only this browser knows: rooms it hosts or joined, and its own sealed bids. */
export const local = {
  hosted: () => read<string[]>("hosted", []),
  isHost: (id: string) => local.hosted().includes(id),
  addHosted: (id: string) => write("hosted", [id, ...local.hosted().filter((x) => x !== id)]),
  joined: () => read<string[]>("joined", []),
  addJoined(id: string) {
    if (!local.joined().includes(id)) write("joined", [id, ...local.joined()]);
  },
  /** The name this browser bids under in a room. Joining a room is choosing it. */
  name: (id: string) => read<number | null>(`name.${id}`, null),
  join(id: string, name: number) {
    write(`name.${id}`, name);
    local.addJoined(id);
  },
  result: (id: string) => read<ResultNote | null>(`result.${id}`, null),
  saveResult: (id: string, note: ResultNote) => write(`result.${id}`, note),
  myBids: (id: string) => read<MyBid[]>(`mine.${id}`, []),
  saveMyBid(id: string, bid: MyBid) {
    write(`mine.${id}`, [...local.myBids(id).filter((b) => b.id !== bid.id), bid]);
  },
  dropMyBid(id: string, bidId: string) {
    write(`mine.${id}`, local.myBids(id).filter((b) => b.id !== bidId));
  },
  opening: (id: string) => read<Opening | null>(`opening.${id}`, null),
  saveOpening: (id: string, opening: Opening) => write(`opening.${id}`, opening),
  invites: (id: string) => read<number[]>(`invites.${id}`, []),
  addInvite(id: string): number {
    const list = local.invites(id);
    const next = (list.length ? Math.max(...list) : 0) + 1;
    write(`invites.${id}`, [...list, next]);
    return next;
  },
};
