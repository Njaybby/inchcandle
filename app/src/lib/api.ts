import { useEffect, useRef, useState } from "react";
import { signRequest } from "./device";
import type {
  Attester,
  AttestationRow,
  CodeIn,
  CodeRow,
  DirectoryRoom,
  MemberRow,
  NewRoomBody,
  RedeemResult,
  RoomRecord,
  Settlement,
  Stats,
  VaultStatus,
  WireBid,
} from "./api-types";

// The app's only door to the directory. Requests that need to say who is asking are signed by this device.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, sign = false): Promise<T> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const url = `/api${path}`;
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  if (sign) Object.assign(headers, await signRequest(method, url, text));
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: method === "GET" ? undefined : text, cache: "no-store" });
  } catch {
    throw new ApiError(0, "offline", "Couldn't reach the directory. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `The directory answered ${res.status}.`);
  return data as T;
}

export const api = {
  directory: () => call<{ rooms: DirectoryRoom[] }>("GET", "/directory").then((r) => r.rooms),
  stats: () => call<Stats>("GET", "/stats"),
  attesters: () => call<{ attesters: Attester[] }>("GET", "/attesters").then((r) => r.attesters),
  room: (id: string) => call<RoomRecord>("GET", `/rooms/${id}`, undefined, true),
  me: () => call<{ hosted: RoomRecord[]; joined: RoomRecord[] }>("GET", "/me", undefined, true),
  createRoom: (body: NewRoomBody) => call<RoomRecord>("POST", "/rooms", body, true),
  codes: (id: string) => call<{ codes: CodeRow[] }>("GET", `/rooms/${id}/codes`, undefined, true).then((r) => r.codes),
  addCodes: (id: string, codes: CodeIn[]) => call<{ added: number }>("POST", `/rooms/${id}/codes`, { codes }, true),
  revokeCode: (id: string, codeId: string) => call<{ revoked: true }>("POST", `/rooms/${id}/codes/${codeId}/revoke`, {}, true),
  redeem: (codeId: string) => call<RedeemResult>("POST", "/redeem", { code: codeId }, true),
  join: (id: string) => call<{ paddle: number; again: boolean }>("POST", `/rooms/${id}/join`, {}, true),
  members: (id: string) => call<{ members: MemberRow[] }>("GET", `/rooms/${id}/members`, undefined, true).then((r) => r.members),
  removeMember: (id: string, device: string) => call<{ removed: true }>("POST", `/rooms/${id}/members/${device}/remove`, {}, true),
  bids: (id: string) => call<{ bids: WireBid[] }>("GET", `/rooms/${id}/bids`, undefined, true).then((r) => r.bids),
  placeBid: (id: string, bid: { id: string; envelope: string; deposit: string }) => call<WireBid>("POST", `/rooms/${id}/bids`, bid, true),
  pay: (id: string, body: { claimKey: string; amount: string }) => call<{ paid: true }>("POST", `/rooms/${id}/payments`, body, true),
  payments: (id: string) => call<{ payments: { paddle: number; claimKey: string; amount: string; at: number }[] }>("GET", `/rooms/${id}/payments`, undefined, true).then((r) => r.payments),
  attestations: (id: string) => call<{ attestations: AttestationRow[] }>("GET", `/rooms/${id}/attestations`).then((r) => r.attestations),
  vault: (roomId: string) => call<VaultStatus>("GET", `/vaults/${roomId}`),
  claim: (body: { vault: string; roomId: string; destination: string; signature: string }) => call<{ queued: true }>("POST", "/claims", body),
};

export type { Settlement };

/** Loads something from the directory and reloads it every `ms` while the tab is visible. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []): { data: T | undefined; error: ApiError | null; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const next = await loader.current();
          if (live) {
            setData(next);
            setError(null);
          }
        } catch (e) {
          if (live) setError(e instanceof ApiError ? e : new ApiError(0, "error", String(e)));
        }
      }
      if (live && ms > 0) timer = setTimeout(run, ms);
    };
    run();
    const wake = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms, tick, ...deps]);

  return { data, error, reload: () => setTick((t) => t + 1) };
}
