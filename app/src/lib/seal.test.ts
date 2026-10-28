import { describe, expect, it } from "vitest";
import { seal, unseal } from "./seal";
import { decodePayload, encodePayload, envelopeFromMemo, memoFor, openEnvelope, readHead, readOpen } from "./envelope";
import { nameCount, nameText, randomName } from "./names";
import { verifyBeacon } from "./drand";
import { roundAt, roundTime } from "./rounds";
import { roomTag } from "./ids";
import { paymentUri } from "./zip321";
import { formatZec, parseZec } from "./money";

// A quicknet round that has already been signed, and its published signature.
const round = 32862785;
const signature = "8086ff9fb7829494ce55233ff19498147b391fccbed2b750d589a10f53fdd99306c9ffba630e7d36ff04f74566b21ac3";
const tag = roomTag("abcdefghijkm");
const claim = new Uint8Array(32).fill(7);

describe("drand", () => {
  it("accepts the published signature for its round", () => {
    expect(verifyBeacon(round, signature)).toBe(true);
  });

  it("rejects the same signature for any other round", () => {
    expect(verifyBeacon(round + 1, signature)).toBe(false);
  });

  it("maps rounds to times and back", () => {
    expect(roundAt(roundTime(round))).toBe(round);
  });
});

describe("seal", () => {
  it("opens with the round's signature and returns the sealed amount", async () => {
    const env = await seal(round, tag, encodePayload({ amount: 2_140_000_000n, claim, name: 413 }));
    expect(env.length).toBe(249);
    expect(readHead(env)?.round).toBe(round);
    const payload = decodePayload(await unseal(env, signature));
    expect(payload.amount).toBe(2_140_000_000n);
    expect(payload.claim).toEqual(claim);
    expect(payload.name).toBe(413);
  });

  it("does not open with a signature from another round", async () => {
    const env = await seal(round + 1, tag, encodePayload({ amount: 1n, claim, name: null }));
    await expect(unseal(env, signature)).rejects.toThrow();
  });

  it("refuses an envelope with a changed bit", async () => {
    const env = await seal(round, tag, encodePayload({ amount: 1n, claim, name: null }));
    for (const at of [3, 7, 20, 200, env.length - 1]) {
      const bad = env.slice();
      bad[at] ^= 1;
      await expect(unseal(bad, signature)).rejects.toThrow();
    }
  });

  it("fits a memo and survives the round trip through it", async () => {
    const env = await seal(round, tag, encodePayload({ amount: 1n, claim, name: null }));
    const memo = memoFor(env);
    expect(new TextEncoder().encode(memo).length).toBeLessThanOrEqual(512);
    expect(envelopeFromMemo(memo)).toEqual(env);
  });
});

describe("payloads and names", () => {
  it("still reads a version 1 payload, which has no name", () => {
    const v1 = new Uint8Array(57);
    v1[0] = 1;
    new DataView(v1.buffer).setBigUint64(1, 5n);
    expect(decodePayload(v1)).toMatchObject({ amount: 5n, name: null });
  });

  it("refuses a payload of an unknown version", () => {
    const bad = encodePayload({ amount: 5n, claim, name: 1 });
    bad[0] = 3;
    expect(() => decodePayload(bad)).toThrow();
  });

  it("reads an open envelope, and not a sealed one", async () => {
    const open = openEnvelope(tag, encodePayload({ amount: 9n, claim, name: 2 }));
    expect(readOpen(open)?.payload).toMatchObject({ amount: 9n, name: 2 });
    expect(readOpen(await seal(round, tag, encodePayload({ amount: 9n, claim, name: 2 })))).toBeNull();
  });

  it("gives every index a name, and a reroll never repeats the last one", () => {
    expect(nameText(0)).toBe("Amber Heron");
    expect(new Set(Array.from({ length: nameCount }, (_, i) => nameText(i))).size).toBe(nameCount);
    expect(nameText(nameCount)).toBe("Unnamed bidder");
    const seen = [randomName()];
    for (let i = 0; i < 50; i++) seen.push(randomName([seen[seen.length - 1]]));
    expect(seen.every((n, i) => i === 0 || n !== seen[i - 1])).toBe(true);
  });
});

describe("money and requests", () => {
  it("parses amounts people type", () => {
    expect(parseZec("21.5")).toBe(2_150_000_000n);
    expect(parseZec("21,5")).toBe(2_150_000_000n);
    expect(parseZec(".25")).toBe(25_000_000n);
    expect(parseZec("0")).toBeNull();
    expect(parseZec("1.123456789")).toBeNull();
    expect(parseZec("abc")).toBeNull();
    expect(parseZec("21000001")).toBeNull();
  });

  it("formats amounts for reading", () => {
    expect(formatZec(2_150_000_000n)).toBe("21.50");
    expect(formatZec(123_456_789_000n)).toBe("1,234.56789");
    expect(formatZec(1n)).toBe("0.00000001");
  });

  it("builds a ZIP 321 request with a base64url memo", () => {
    const uri = paymentUri("u1test", 200_000_000n, "IC1 abc");
    expect(uri).toBe("zcash:u1test?amount=2&memo=SUMxIGFiYw");
  });
});
