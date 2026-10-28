import { useMemo } from "react";
import { api, usePoll } from "./api";
import type { RoomRecord } from "./api-types";
import { useSecretsVersion } from "./device";
import { phase, see, type Seen } from "./rooms";

/** Everything the floor and the rooms list show: the directory, opened with this device's keys, plus the rooms this device is in. */
export function useRooms() {
  const directory = usePoll(() => api.directory(), 6000);
  const me = usePoll(() => api.me(), 8000);
  const stats = usePoll(() => api.stats(), 8000);
  const version = useSecretsVersion();

  const all = useMemo(() => {
    const mine = new Map<string, RoomRecord>();
    for (const r of [...(me.data?.hosted ?? []), ...(me.data?.joined ?? [])]) mine.set(r.id, r);
    const seen = new Map<string, Seen>();
    for (const r of directory.data ?? []) seen.set(r.id, see(mine.get(r.id) ?? r));
    for (const [id, r] of mine) if (!seen.has(id)) seen.set(id, see(r));
    return [...seen.values()];
  }, [directory.data, me.data, version]);

  const yours = all.filter((s) => s.role);
  return {
    all,
    yours,
    stats: stats.data,
    loading: directory.data === undefined && !directory.error,
    error: directory.error,
    reload: () => {
      directory.reload();
      me.reload();
      stats.reload();
    },
  };
}

/** Sorts rooms by what needs attention first: closing soonest, then waiting to open, then opened, newest first. */
export function byUrgency(now: number) {
  const rank = { closing: 0, open: 1, waiting: 2, opened: 3 } as const;
  return (a: Seen, b: Seen) => {
    if (!a.terms || !b.terms) return a.terms ? -1 : b.terms ? 1 : b.room.createdAt - a.room.createdAt;
    const pa = rank[phase(a.terms, now)];
    const pb = rank[phase(b.terms, now)];
    if (pa !== pb) return pa - pb;
    return pa <= 1 ? a.terms.closesAt - b.terms.closesAt : b.terms.closesAt - a.terms.closesAt;
  };
}
