import { Hono, type Context } from "hono";
import type { Db } from "./db";
import { canonical, clockSkew, deviceId, keyHeader, sigHeader, timeHeader, verifyDevice } from "../../app/src/lib/wire";
import { fromBase64Url } from "../../app/src/lib/bytes";
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
} from "../../app/src/lib/api-types";

// The directory: where rooms are listed, where code books live and, on the preview network, where sealed bids wait.
// It stores code lookup ids and sealed admissions, never a code, a room key or a private room's terms.

export interface Options {
  db: Db;
  committee: Attester[];
  relayToken: string;
  now?: () => number;
}

interface Device {
  id: string;
  key: string;
}

type Env = { Variables: { device: Device | null; body: string } };

const roomIdPattern = /^[abcdefghijkmnpqrstuvwxyz23456789]{12}$/;
const codeIdPattern = /^[0-9a-f]{32}$/;
const b64url = /^[A-Za-z0-9_-]+$/;
// "regtest" rooms pay on a local Zcash chain; the directory keeps a copy of each bid beside the chain, which the attesters read.
const networks = ["preview", "regtest", "test", "main"];
const listings = ["public", "private", "hidden"];

interface RoomRow {
  id: string;
  network: string;
  listing: string;
  name: string | null;
  fingerprint: string;
  terms: string | null;
  sealed: string | null;
  host: string;
  host_key: string;
  closes_at: number | null;
  opens_round: number | null;
  vault: string | null;
  paddles: number;
  paddle_cap: number;
  created_at: number;
}

class Refused extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 429,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createApp({ db, committee, relayToken, now = Date.now }: Options) {
  const app = new Hono<Env>().basePath("/api");
  const attempts = new Map<string, number[]>();

  /** A sliding window per key, enough to slow anyone fishing for codes. Codes have 80 bits, so this is a courtesy, not the defence. */
  function limit(key: string, max: number, windowMs: number) {
    const t = now();
    const recent = (attempts.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) throw new Refused(429, "slow-down", "Too many attempts. Wait a minute and try again.");
    recent.push(t);
    attempts.set(key, recent);
  }

  // Reads the body once and checks the device signature when one is present.
  app.use("*", async (c, next) => {
    const body = c.req.method === "GET" || c.req.method === "HEAD" ? "" : await c.req.text();
    c.set("body", body);
    c.set("device", null);
    const key = c.req.header(keyHeader);
    const sig = c.req.header(sigHeader);
    const time = c.req.header(timeHeader);
    if (key && sig && time) {
      const url = new URL(c.req.url);
      const skew = Math.abs(now() - Number(time));
      if (!Number.isFinite(skew) || skew > clockSkew) return c.json({ error: "clock", message: "This device's clock is too far off. Check the time and try again." }, 401);
      const ok = await verifyDevice(key, canonical(c.req.method, url.pathname + url.search, time, body), sig);
      if (!ok) return c.json({ error: "signature", message: "The request's signature didn't verify." }, 401);
      c.set("device", { id: deviceId(fromBase64Url(key)), key });
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof Refused) return c.json({ error: error.code, message: error.message }, error.status);
    console.error(error);
    return c.json({ error: "server", message: "Something went wrong on the directory." }, 500);
  });

  const json = <T>(c: Context<Env>): T => {
    try {
      return JSON.parse(c.get("body") || "null") as T;
    } catch {
      throw new Refused(400, "body", "The request body isn't valid JSON.");
    }
  };

  const signed = (c: Context<Env>): Device => {
    const device = c.get("device");
    if (!device) throw new Refused(401, "unsigned", "This needs a signed request from a device.");
    return device;
  };

  async function room(id: string): Promise<RoomRow> {
    if (!roomIdPattern.test(id)) throw new Refused(404, "room", "There's no room with that id.");
    const row = await db.get<RoomRow>("select * from rooms where id = ?", id);
    if (!row) throw new Refused(404, "room", "There's no room with that id.");
    return row;
  }

  async function roleOf(row: RoomRow, device: Device | null): Promise<RoomRecord["you"]> {
    if (!device) return undefined;
    if (row.host === device.id) return { role: "host" };
    const member = await db.get<{ paddle: number }>("select paddle from members where room_id = ? and device = ? and removed_at is null", row.id, device.id);
    if (member) return { role: "member", paddle: member.paddle };
    const grant = await db.get("select 1 from grants where room_id = ? and attester = ?", row.id, device.id);
    if (grant) return { role: "attester" };
    return undefined;
  }

  async function bidCount(roomId: string) {
    return (await db.get<{ n: number }>("select count(*) as n from bids where room_id = ?", roomId))?.n ?? 0;
  }

  async function memberCount(roomId: string) {
    return (await db.get<{ n: number }>("select count(*) as n from members where room_id = ? and removed_at is null", roomId))?.n ?? 0;
  }

  async function directoryEntry(row: RoomRow): Promise<DirectoryRoom> {
    const base: DirectoryRoom = {
      id: row.id,
      network: row.network as DirectoryRoom["network"],
      listing: row.listing as DirectoryRoom["listing"],
      name: row.listing === "hidden" ? null : row.name,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
    };
    if (row.listing !== "public") return base;
    return { ...base, terms: row.terms ? JSON.parse(row.terms) : undefined, bids: await bidCount(row.id), members: await memberCount(row.id) };
  }

  async function record(row: RoomRow, device: Device | null): Promise<RoomRecord> {
    const you = await roleOf(row, device);
    const inside = !!you;
    if (row.listing === "hidden" && !inside) throw new Refused(404, "room", "There's no room with that id.");
    const entry = await directoryEntry(row);
    return {
      ...entry,
      name: row.listing === "hidden" ? (inside ? row.name : null) : row.name,
      ...(inside && row.listing !== "public" ? { sealed: row.sealed ?? undefined, bids: await bidCount(row.id), members: await memberCount(row.id) } : {}),
      host: row.host,
      paddleCap: row.paddle_cap,
      you,
    };
  }

  function requireHost(row: RoomRow, device: Device) {
    if (row.host !== device.id) throw new Refused(403, "not-host", "Only the host's device can do this.");
  }

  function checkCodes(codes: CodeIn[], cap: number) {
    for (const code of codes) {
      if (!codeIdPattern.test(code.id) || !b64url.test(code.admission) || code.admission.length > 4096) throw new Refused(400, "code", "A code in the book is malformed.");
      if (!Number.isInteger(code.paddle) || code.paddle < 1 || code.paddle > cap) throw new Refused(400, "paddle", "A code's paddle is outside the room's range.");
    }
  }

  async function insertCodes(roomId: string, codes: CodeIn[]) {
    const t = now();
    for (const code of codes) {
      const taken = await db.get("select 1 from codes where id = ?", code.id);
      if (taken) throw new Refused(409, "code-exists", "A code in the book already exists. Make a new book.");
      await db.run("insert into codes (id, room_id, paddle, admission, created_at) values (?, ?, ?, ?, ?)", code.id, roomId, code.paddle, code.admission, t);
    }
  }

  app.get("/health", (c) => c.json({ ok: true, time: now() }));

  app.get("/directory", async (c) => {
    const rows = await db.all<RoomRow>("select * from rooms where listing != 'hidden' order by created_at desc limit 200");
    return c.json({ rooms: await Promise.all(rows.map(directoryEntry)) });
  });

  app.get("/stats", async (c) => {
    const t = now();
    const n = async (sql: string, ...p: unknown[]) => (await db.get<{ n: number }>(sql, ...p))?.n ?? 0;
    const stats: Stats = {
      rooms: await n("select count(*) as n from rooms where listing != 'hidden'"),
      open: await n("select count(*) as n from rooms where listing = 'public' and closes_at > ?", t),
      sealedBids: await n("select count(*) as n from bids"),
      codesIssued: await n("select count(*) as n from codes"),
      codesUsed: await n("select count(*) as n from codes where used_at is not null"),
      vaults: await n("select count(*) as n from rooms where vault is not null"),
    };
    return c.json(stats);
  });

  app.get("/attesters", (c) => c.json({ attesters: committee }));

  app.post("/rooms", async (c) => {
    const device = signed(c);
    limit(`create:${device.id}`, 20, 60 * 60_000);
    const body = json<NewRoomBody>(c);
    if (!body || !roomIdPattern.test(body.id)) throw new Refused(400, "id", "The room id is malformed.");
    if (!networks.includes(body.network) || !listings.includes(body.listing)) throw new Refused(400, "kind", "Unknown network or listing.");
    if (!Number.isInteger(body.paddleCap) || body.paddleCap < 1 || body.paddleCap > 500) throw new Refused(400, "paddles", "A room has between 1 and 500 paddles.");
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : null;
    if (body.listing !== "hidden" && !name) throw new Refused(400, "name", "A listed room needs a name.");
    if (body.listing === "public") {
      if (!body.terms || body.terms.id !== body.id) throw new Refused(400, "terms", "A public room needs its terms.");
    } else if (!body.sealed || !b64url.test(body.sealed) || body.sealed.length > 400_000) {
      throw new Refused(400, "sealed", "A private room needs its terms sealed under the room key.");
    }
    if (await db.get("select 1 from rooms where id = ?", body.id)) throw new Refused(409, "exists", "A room with that id already exists.");
    const codes = body.codes ?? [];
    checkCodes(codes, body.paddleCap);
    const grants = body.grants ?? [];
    for (const g of grants) {
      if (!committee.some((a) => a.id === g.attester) || !b64url.test(g.sealed)) throw new Refused(400, "grant", "A grant names an unknown attester.");
    }
    const terms = body.listing === "public" ? body.terms! : null;
    await db.run(
      "insert into rooms (id, network, listing, name, fingerprint, terms, sealed, host, host_key, closes_at, opens_round, vault, paddle_cap, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      body.id,
      body.network,
      body.listing,
      body.listing === "hidden" ? name : name,
      body.fingerprint,
      terms ? JSON.stringify(terms) : null,
      terms ? null : body.sealed,
      device.id,
      device.key,
      terms?.closesAt ?? null,
      terms?.round ?? null,
      terms?.vault ? JSON.stringify(terms.vault) : grants.length ? "sealed" : null,
      body.paddleCap,
      now(),
    );
    await insertCodes(body.id, codes);
    for (const g of grants) await db.run("insert into grants (room_id, attester, sealed) values (?, ?, ?)", body.id, g.attester, g.sealed);
    return c.json(await record(await room(body.id), device), 201);
  });

  app.get("/rooms/:id", async (c) => c.json(await record(await room(c.req.param("id")), c.get("device"))));

  app.get("/me", async (c) => {
    const device = signed(c);
    const hosted = await db.all<RoomRow>("select * from rooms where host = ? order by created_at desc", device.id);
    const joined = await db.all<RoomRow>(
      "select rooms.* from rooms join members on members.room_id = rooms.id where members.device = ? and members.removed_at is null order by members.joined_at desc",
      device.id,
    );
    return c.json({ hosted: await Promise.all(hosted.map((r) => record(r, device))), joined: await Promise.all(joined.map((r) => record(r, device))) });
  });

  app.get("/rooms/:id/codes", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    requireHost(row, device);
    const rows = await db.all<{ id: string; paddle: number; created_at: number; used_at: number | null; revoked_at: number | null }>(
      "select id, paddle, created_at, used_at, revoked_at from codes where room_id = ? order by paddle",
      row.id,
    );
    const codes: CodeRow[] = rows.map((r) => ({ id: r.id, paddle: r.paddle, createdAt: r.created_at, usedAt: r.used_at, revokedAt: r.revoked_at }));
    return c.json({ codes });
  });

  app.post("/rooms/:id/codes", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    requireHost(row, device);
    const { codes } = json<{ codes: CodeIn[] }>(c);
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > 200) throw new Refused(400, "codes", "Add between 1 and 200 codes at a time.");
    checkCodes(codes, row.paddle_cap);
    const used = await db.all<{ paddle: number }>("select paddle from codes where room_id = ?", row.id);
    const paddles = new Set(used.map((u) => u.paddle));
    for (const code of codes) {
      if (paddles.has(code.paddle)) throw new Refused(409, "paddle-taken", `Paddle ${code.paddle} already has a code.`);
      paddles.add(code.paddle);
    }
    await insertCodes(row.id, codes);
    return c.json({ added: codes.length }, 201);
  });

  app.post("/rooms/:id/codes/:code/revoke", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    requireHost(row, device);
    const { changes } = await db.run("update codes set revoked_at = ? where id = ? and room_id = ? and used_at is null and revoked_at is null", now(), c.req.param("code"), row.id);
    if (!changes) throw new Refused(409, "not-revocable", "That code was already used or revoked.");
    return c.json({ revoked: true });
  });

  app.post("/redeem", async (c) => {
    const device = signed(c);
    limit(`redeem:${device.id}`, 12, 60_000);
    limit(`redeem-ip:${c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "local"}`, 40, 60_000);
    const { code } = json<{ code: string }>(c);
    if (typeof code !== "string" || !codeIdPattern.test(code)) throw new Refused(400, "code", "That isn't a code.");
    const row = await db.get<{ id: string; room_id: string; paddle: number; admission: string; used_at: number | null; used_by: string | null; revoked_at: number | null }>(
      "select * from codes where id = ?",
      code,
    );
    if (!row) throw new Refused(404, "unknown", "That code doesn't open any room. Check it with the host.");
    if (row.revoked_at) throw new Refused(410, "revoked", "The host withdrew this code.");
    let again = false;
    if (row.used_at) {
      if (row.used_by !== device.id) throw new Refused(409, "used", "This code was already used on another device. Each code works once.");
      again = true;
    } else {
      // One conditional write decides who gets the code, so two devices racing for it can't both win.
      const { changes } = await db.run("update codes set used_at = ?, used_by = ? where id = ? and used_at is null and revoked_at is null", now(), device.id, code);
      if (!changes) throw new Refused(409, "used", "This code was already used on another device. Each code works once.");
    }
    const target = await room(row.room_id);
    if (!again) {
      await db.run(
        "insert into members (room_id, device, device_key, paddle, code_id, joined_at) values (?, ?, ?, ?, ?, ?) on conflict (room_id, device) do update set paddle = excluded.paddle, code_id = excluded.code_id, removed_at = null",
        row.room_id,
        device.id,
        device.key,
        row.paddle,
        code,
        now(),
      );
    }
    const removed = await db.get<{ removed_at: number | null }>("select removed_at from members where room_id = ? and device = ?", row.room_id, device.id);
    if (removed?.removed_at) throw new Refused(403, "removed", "The host removed this device from the room.");
    const result: RedeemResult = { room: await record(target, device), admission: row.admission, paddle: row.paddle, again };
    return c.json(result);
  });

  app.post("/rooms/:id/join", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    if (row.listing !== "public") throw new Refused(403, "invite-only", "This room needs a code from the host.");
    if (row.host === device.id) throw new Refused(409, "host", "The host can't take a paddle in their own room.");
    const existing = await db.get<{ paddle: number; removed_at: number | null }>("select paddle, removed_at from members where room_id = ? and device = ?", row.id, device.id);
    if (existing?.removed_at) throw new Refused(403, "removed", "The host removed this device from the room.");
    if (existing) return c.json({ paddle: existing.paddle, again: true });
    const { changes } = await db.run("update rooms set paddles = paddles + 1 where id = ? and paddles < paddle_cap", row.id);
    if (!changes) throw new Refused(409, "full", "Every paddle in this room is taken.");
    const paddle = (await db.get<{ paddles: number }>("select paddles from rooms where id = ?", row.id))!.paddles;
    await db.run("insert into members (room_id, device, device_key, paddle, joined_at) values (?, ?, ?, ?, ?)", row.id, device.id, device.key, paddle, now());
    return c.json({ paddle, again: false });
  });

  app.get("/rooms/:id/members", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    requireHost(row, device);
    const rows = await db.all<{ device: string; paddle: number; joined_at: number; removed_at: number | null; code_id: string | null }>(
      "select device, paddle, joined_at, removed_at, code_id from members where room_id = ? order by paddle",
      row.id,
    );
    const members: MemberRow[] = rows.map((r) => ({ device: r.device, paddle: r.paddle, joinedAt: r.joined_at, removedAt: r.removed_at, viaCode: !!r.code_id }));
    return c.json({ members });
  });

  app.post("/rooms/:id/members/:device/remove", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    requireHost(row, device);
    const { changes } = await db.run("update members set removed_at = ? where room_id = ? and device = ? and removed_at is null", now(), row.id, c.req.param("device"));
    if (!changes) throw new Refused(404, "member", "That device isn't in the room.");
    return c.json({ removed: true });
  });

  app.get("/rooms/:id/bids", async (c) => {
    const row = await room(c.req.param("id"));
    if (row.listing !== "public" && !(await roleOf(row, c.get("device")))) throw new Refused(403, "members-only", "Only the room's members can read its bids.");
    const rows = await db.all<WireBid>("select id, paddle, envelope, deposit, at, seq from bids where room_id = ? order by seq", row.id);
    return c.json({ bids: rows });
  });

  app.post("/rooms/:id/bids", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    if (row.network !== "preview" && row.network !== "regtest") throw new Refused(409, "network", "This room runs on Zcash. Send your bid from your wallet.");
    const member = await db.get<{ paddle: number }>("select paddle from members where room_id = ? and device = ? and removed_at is null", row.id, device.id);
    if (!member) throw new Refused(403, "not-member", "Join the room before bidding.");
    limit(`bid:${device.id}`, 20, 60_000);
    const { id, envelope, deposit } = json<{ id: string; envelope: string; deposit: string }>(c);
    if (typeof id !== "string" || !/^[a-z0-9]{8,32}$/.test(id)) throw new Refused(400, "id", "The bid id is malformed.");
    if (typeof envelope !== "string" || !b64url.test(envelope) || envelope.length > 700) throw new Refused(400, "envelope", "The sealed bid is malformed.");
    if (typeof deposit !== "string" || !/^\d{1,16}$/.test(deposit)) throw new Refused(400, "deposit", "The deposit is malformed.");
    if (await db.get("select 1 from bids where id = ?", id)) return c.json({ duplicate: true });
    const seq = ((await db.get<{ m: number | null }>("select max(seq) as m from bids where room_id = ?", row.id))?.m ?? 0) + 1;
    const at = now();
    await db.run("insert into bids (id, room_id, paddle, envelope, deposit, at, seq) values (?, ?, ?, ?, ?, ?, ?)", id, row.id, member.paddle, envelope, deposit, at, seq);
    const bid: WireBid = { id, paddle: member.paddle, envelope, deposit, at, seq };
    return c.json(bid, 201);
  });

  // On the preview network a winner's balance payment is recorded here, the way a shielded payment with an "IC1 pay" memo would arrive on Zcash.
  app.post("/rooms/:id/payments", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    if (row.network !== "preview" && row.network !== "regtest") throw new Refused(409, "network", "This room runs on Zcash. Pay from your wallet.");
    const member = await db.get<{ paddle: number }>("select paddle from members where room_id = ? and device = ? and removed_at is null", row.id, device.id);
    if (!member) throw new Refused(403, "not-member", "Only a member can pay into the room.");
    const { claimKey, amount } = json<{ claimKey: string; amount: string }>(c);
    if (!/^0x[0-9a-fA-F]{40}$/.test(claimKey ?? "") || !/^\d{1,16}$/.test(amount ?? "")) throw new Refused(400, "payment", "The payment is malformed.");
    const id = `${row.id}:${claimKey.toLowerCase()}`;
    await db.run(
      "insert into payments (id, room_id, paddle, claim_key, amount, at) values (?, ?, ?, ?, ?, ?) on conflict (id) do update set amount = excluded.amount, at = excluded.at",
      id,
      row.id,
      member.paddle,
      claimKey.toLowerCase(),
      amount,
      now(),
    );
    return c.json({ paid: true }, 201);
  });

  app.get("/rooms/:id/payments", async (c) => {
    const row = await room(c.req.param("id"));
    if (row.listing !== "public" && !(await roleOf(row, c.get("device")))) throw new Refused(403, "members-only", "Only the room's members can read its payments.");
    const rows = await db.all<{ paddle: number; claim_key: string; amount: string; at: number }>("select paddle, claim_key, amount, at from payments where room_id = ? order by at", row.id);
    return c.json({ payments: rows.map((r) => ({ paddle: r.paddle, claimKey: r.claim_key, amount: r.amount, at: r.at })) });
  });

  // An attester's worklist: private rooms whose key was sealed to it, and public rooms whose vault names its address.
  app.get("/attester/rooms", async (c) => {
    const device = signed(c);
    const attester = committee.find((a) => a.id === device.id);
    if (!attester) throw new Refused(403, "not-attester", "Only a committee attester has a worklist.");
    const granted = await db.all<RoomRow>("select rooms.* from rooms join grants on grants.room_id = rooms.id where grants.attester = ?", device.id);
    const vaulted = (await db.all<RoomRow>("select * from rooms where listing = 'public' and vault is not null")).filter((r) => {
      const v = r.vault ? (JSON.parse(r.vault) as { attesters?: string[] }) : null;
      return v?.attesters?.some((a) => a.toLowerCase() === attester.address.toLowerCase());
    });
    const rows = [...granted, ...vaulted];
    return c.json({ rooms: await Promise.all(rows.map((r) => record(r, device))) });
  });

  app.get("/rooms/:id/grant", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    const grant = await db.get<{ sealed: string }>("select sealed from grants where room_id = ? and attester = ?", row.id, device.id);
    if (!grant) throw new Refused(404, "grant", "This attester has no key for the room.");
    return c.json({ sealed: grant.sealed, room: await record(row, device) });
  });

  app.get("/rooms/:id/attestations", async (c) => {
    const row = await room(c.req.param("id"));
    const rows = await db.all<{ attester: string; body: string; signature: string; at: number }>("select attester, body, signature, at from attestations where room_id = ?", row.id);
    const list: AttestationRow[] = rows.map((r) => ({ attester: r.attester, body: JSON.parse(r.body), signature: r.signature, at: r.at }));
    return c.json({ attestations: list });
  });

  app.post("/rooms/:id/attestations", async (c) => {
    const device = signed(c);
    const row = await room(c.req.param("id"));
    const attester = committee.find((a) => a.id === device.id);
    if (!attester) throw new Refused(403, "not-attester", "Only a committee attester can attest.");
    const { body, signature } = json<{ body: Settlement; signature: string }>(c);
    if (!body || body.roomId !== row.id || !["settle", "nosale"].includes(body.kind) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Refused(400, "attestation", "The attestation is malformed.");
    await db.run(
      "insert into attestations (room_id, attester, kind, body, signature, at) values (?, ?, ?, ?, ?, ?) on conflict (room_id, attester) do update set kind = excluded.kind, body = excluded.body, signature = excluded.signature, at = excluded.at",
      row.id,
      attester.address.toLowerCase(),
      body.kind,
      JSON.stringify(body),
      signature,
      now(),
    );
    return c.json({ stored: true }, 201);
  });

  app.post("/claims", async (c) => {
    limit(`claim:${c.req.header("x-forwarded-for") ?? "local"}`, 20, 60_000);
    const { vault, roomId, destination, signature } = json<{ vault: string; roomId: string; destination: string; signature: string }>(c);
    if (!/^0x[0-9a-fA-F]{40}$/.test(vault ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(destination ?? "") || !/^0x[0-9a-fA-F]{130}$/.test(signature ?? "")) {
      throw new Refused(400, "claim", "The claim is malformed.");
    }
    await room(roomId);
    const existing = await db.get<{ status: string }>("select status from claims where vault = ?", vault.toLowerCase());
    if (existing && existing.status !== "failed") throw new Refused(409, "claimed", "This lot already has a claim on its way.");
    await db.run(
      "insert into claims (vault, room_id, destination, signature, status, at) values (?, ?, ?, ?, 'pending', ?) on conflict (vault) do update set destination = excluded.destination, signature = excluded.signature, status = 'pending', error = null, at = excluded.at",
      vault.toLowerCase(),
      roomId,
      destination,
      signature,
      now(),
    );
    return c.json({ queued: true }, 202);
  });

  app.get("/vaults/:roomId", async (c) => {
    const row = await room(c.req.param("roomId"));
    const settlement = await db.get<{ kind: string; status: string; tx: string | null; error: string | null }>("select kind, status, tx, error from settlements where room_id = ?", row.id);
    const claim = await db.get<{ destination: string; status: string; tx: string | null; error: string | null }>("select destination, status, tx, error from claims where room_id = ?", row.id);
    const rows = await db.all<{ attester: string; body: string; signature: string; at: number }>("select attester, body, signature, at from attestations where room_id = ?", row.id);
    const status: VaultStatus = {
      roomId: row.id,
      settlement: settlement ?? null,
      claim: claim ?? null,
      attestations: rows.map((r) => ({ attester: r.attester, body: JSON.parse(r.body), signature: r.signature, at: r.at })),
    };
    return c.json(status);
  });

  // The relay's side: what is waiting to be sent, and what happened when it was. It needs the relay token, and it holds no authority over the vaults.
  const relayOnly = (c: Context<Env>) => {
    if (!relayToken || c.req.header("authorization") !== `Bearer ${relayToken}`) throw new Refused(401, "relay", "Relay token required.");
  };

  app.get("/relay/pending", async (c) => {
    relayOnly(c);
    const attested = await db.all<{ room_id: string; attester: string; kind: string; body: string; signature: string }>(
      "select attestations.room_id, attester, attestations.kind, body, signature from attestations left join settlements on settlements.room_id = attestations.room_id where settlements.room_id is null or settlements.status = 'failed'",
    );
    const claims = await db.all<{ vault: string; room_id: string; destination: string; signature: string }>("select vault, room_id, destination, signature from claims where status = 'pending'");
    return c.json({ attested: attested.map((a) => ({ ...a, body: JSON.parse(a.body) })), claims });
  });

  app.post("/relay/settlements", async (c) => {
    relayOnly(c);
    const { roomId, vault, kind, status, tx, error } = json<{ roomId: string; vault: string; kind: string; status: string; tx?: string; error?: string }>(c);
    await db.run(
      "insert into settlements (room_id, vault, kind, status, tx, error, at) values (?, ?, ?, ?, ?, ?, ?) on conflict (room_id) do update set kind = excluded.kind, status = excluded.status, tx = excluded.tx, error = excluded.error, at = excluded.at",
      roomId,
      vault.toLowerCase(),
      kind,
      status,
      tx ?? null,
      error ?? null,
      now(),
    );
    return c.json({ ok: true });
  });

  app.post("/relay/claims", async (c) => {
    relayOnly(c);
    const { vault, status, tx, error } = json<{ vault: string; status: string; tx?: string; error?: string }>(c);
    await db.run("update claims set status = ?, tx = ?, error = ?, at = ? where vault = ?", status, tx ?? null, error ?? null, now(), vault.toLowerCase());
    return c.json({ ok: true });
  });

  return app;
}
