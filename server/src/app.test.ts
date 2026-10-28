import { describe, expect, it, beforeEach } from "vitest";
import { openSqlite } from "./db";
import { openLibsql } from "./libsql";
import { createApp } from "./app";
import { canonical, keyHeader, sigHeader, timeHeader } from "../../app/src/lib/wire";
import { toBase64Url } from "../../app/src/lib/bytes";
import { codeId, makeBook, newCode, newRoomKey, openAdmission, openTerms, sealTerms } from "../../app/src/lib/codes";

interface Dev { raw: string; priv: CryptoKey }

async function device(): Promise<Dev> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { raw: toBase64Url(raw), priv: pair.privateKey };
}

// The whole suite runs against node:sqlite and against libSQL, the store used when hosted.
const backend = process.env.IC_TEST_DB === "libsql" ? () => openLibsql(":memory:") : () => openSqlite(":memory:");

let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  app = createApp({ db: await backend(), committee: [], relayToken: "t" });
});

async function call(method: string, path: string, body?: unknown, dev?: Dev, tamper = false) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (dev) {
    const time = String(Date.now());
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, dev.priv, new TextEncoder().encode(canonical(method, path, time, text))));
    headers[keyHeader] = dev.raw;
    headers[timeHeader] = time;
    headers[sigHeader] = toBase64Url(sig);
  }
  const res = await app.request(`http://x${path}`, { method, headers, body: method === "GET" ? undefined : tamper ? text.replace("}", ',"x":1}') : text });
  return { status: res.status, body: (await res.json()) as any };
}

const terms = (id: string) => ({ v: 1, id, name: "Public lot", line: "", closesAt: Date.now() + 3600_000, round: 1, deposit: "100000", format: "second", access: "link", after: "private", createdAt: Date.now() });

describe("directory access", () => {
  it("lists a public room in full and a private room by name only, and never a hidden one", async () => {
    const host = await device();
    const key = newRoomKey();
    expect((await call("POST", "/api/rooms", { id: "aaaaaaaaaaaa", network: "preview", listing: "public", name: "Public lot", fingerprint: "f", paddleCap: 10, terms: terms("aaaaaaaaaaaa") }, host)).status).toBe(201);
    expect((await call("POST", "/api/rooms", { id: "bbbbbbbbbbbb", network: "preview", listing: "private", name: "Quiet lot", fingerprint: "f", paddleCap: 10, sealed: sealTerms(key, "bbbbbbbbbbbb", { secret: "reserve 9" }) }, host)).status).toBe(201);
    expect((await call("POST", "/api/rooms", { id: "cccccccccccc", network: "preview", listing: "hidden", name: "Ghost lot", fingerprint: "f", paddleCap: 10, sealed: sealTerms(key, "cccccccccccc", {}) }, host)).status).toBe(201);
    const { body } = await call("GET", "/api/directory");
    const ids = body.rooms.map((r: any) => r.id);
    expect(ids).toContain("aaaaaaaaaaaa");
    expect(ids).toContain("bbbbbbbbbbbb");
    expect(ids).not.toContain("cccccccccccc");
    const priv = body.rooms.find((r: any) => r.id === "bbbbbbbbbbbb");
    expect(priv.name).toBe("Quiet lot");
    expect(priv.terms).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("reserve 9");
    expect((await call("GET", "/api/rooms/cccccccccccc")).status).toBe(404);
    expect((await call("GET", "/api/rooms/cccccccccccc", undefined, host)).status).toBe(200);
  });

  it("lets a code in once, on one device, and keeps everyone else out", async () => {
    const host = await device();
    const alice = await device();
    const mallory = await device();
    const key = newRoomKey();
    const book = makeBook("dddddddddddd", key, [1, 2, 3]);
    await call("POST", "/api/rooms", { id: "dddddddddddd", network: "preview", listing: "private", name: "Lot", fingerprint: "f", paddleCap: 3, sealed: sealTerms(key, "dddddddddddd", { reserve: "x" }), codes: book.map((b) => b.entry) }, host);

    // Unsigned and tampered requests are refused before anything is looked up.
    expect((await call("POST", "/api/redeem", { code: book[0].entry.id })).status).toBe(401);
    expect((await call("POST", "/api/redeem", { code: book[0].entry.id }, alice, true)).status).toBe(401);

    // Positive control: the first device in gets the admission, and the code opens it.
    const first = await call("POST", "/api/redeem", { code: book[0].entry.id }, alice);
    expect(first.status).toBe(200);
    expect(first.body.paddle).toBe(1);
    const admission = openAdmission(book[0].code, first.body.admission);
    expect(openTerms<any>(new Uint8Array(Buffer.from(admission.key, "base64url")), "dddddddddddd", first.body.room.sealed).reserve).toBe("x");

    // The same device can come back; another device can't reuse the code.
    expect((await call("POST", "/api/redeem", { code: book[0].entry.id }, alice)).body.again).toBe(true);
    const reuse = await call("POST", "/api/redeem", { code: book[0].entry.id }, mallory);
    expect(reuse.status).toBe(409);
    expect(reuse.body.error).toBe("used");

    // A made-up code and a revoked one both fail.
    expect((await call("POST", "/api/redeem", { code: codeId(newCode()) }, mallory)).status).toBe(404);
    expect((await call("POST", `/api/rooms/dddddddddddd/codes/${book[1].entry.id}/revoke`, {}, mallory)).status).toBe(403);
    expect((await call("POST", `/api/rooms/dddddddddddd/codes/${book[1].entry.id}/revoke`, {}, host)).status).toBe(200);
    expect((await call("POST", "/api/redeem", { code: book[1].entry.id }, mallory)).status).toBe(410);

    // Only members read a private room's bids; the host sees the book's state.
    expect((await call("GET", "/api/rooms/dddddddddddd/bids", undefined, mallory)).status).toBe(403);
    expect((await call("GET", "/api/rooms/dddddddddddd/bids", undefined, alice)).status).toBe(200);
    const codes = (await call("GET", "/api/rooms/dddddddddddd/codes", undefined, host)).body.codes;
    expect(codes.filter((c: any) => c.usedAt).length).toBe(1);
    expect(codes.filter((c: any) => c.revokedAt).length).toBe(1);
    expect((await call("GET", "/api/rooms/dddddddddddd/codes", undefined, alice)).status).toBe(403);

    // A removed device loses the room even with its code.
    const alicesDevice = (await call("GET", "/api/rooms/dddddddddddd/members", undefined, host)).body.members[0].device;
    expect((await call("POST", `/api/rooms/dddddddddddd/members/${alicesDevice}/remove`, {}, host)).status).toBe(200);
    expect((await call("GET", "/api/rooms/dddddddddddd/bids", undefined, alice)).status).toBe(403);
    expect((await call("POST", "/api/redeem", { code: book[0].entry.id }, alice)).status).toBe(403);
  });

  it("gives two racing devices one code exactly once", async () => {
    const host = await device();
    const key = newRoomKey();
    const book = makeBook("eeeeeeeeeeee", key, [1]);
    await call("POST", "/api/rooms", { id: "eeeeeeeeeeee", network: "preview", listing: "private", name: "Lot", fingerprint: "f", paddleCap: 1, sealed: sealTerms(key, "eeeeeeeeeeee", {}), codes: book.map((b) => b.entry) }, host);
    const devices = await Promise.all(Array.from({ length: 8 }, device));
    const results = await Promise.all(devices.map((d) => call("POST", "/api/redeem", { code: book[0].entry.id }, d)));
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(7);
  });

  it("hands out public paddles in order up to the cap and takes bids only from members", async () => {
    const host = await device();
    await call("POST", "/api/rooms", { id: "ffffffffffff", network: "preview", listing: "public", name: "Lot", fingerprint: "f", paddleCap: 2, terms: terms("ffffffffffff") }, host);
    const [a, b, c] = await Promise.all([device(), device(), device()]);
    expect((await call("POST", "/api/rooms/ffffffffffff/join", {}, host)).status).toBe(409);
    expect((await call("POST", "/api/rooms/ffffffffffff/join", {}, a)).body.paddle).toBe(1);
    expect((await call("POST", "/api/rooms/ffffffffffff/join", {}, a)).body.again).toBe(true);
    expect((await call("POST", "/api/rooms/ffffffffffff/join", {}, b)).body.paddle).toBe(2);
    expect((await call("POST", "/api/rooms/ffffffffffff/join", {}, c)).status).toBe(409);
    expect((await call("POST", "/api/rooms/ffffffffffff/bids", { id: "bidbidbid1", envelope: "SUM", deposit: "100000" }, c)).status).toBe(403);
    const bid = await call("POST", "/api/rooms/ffffffffffff/bids", { id: "bidbidbid1", envelope: "SUM", deposit: "100000" }, b);
    expect(bid.status).toBe(201);
    expect(bid.body.paddle).toBe(2);
    expect((await call("GET", "/api/rooms/ffffffffffff/bids")).body.bids.length).toBe(1);
  });
});
