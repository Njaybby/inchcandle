import { describe, expect, it } from "vitest";
import { candleOut, candleWindow, judge } from "./rules";
import type { RoomTerms, SealedBid } from "./types";

const zec = (n: number) => BigInt(Math.round(n * 1e8));

const terms: RoomTerms = {
  v: 1,
  id: "abcdefghijkm",
  name: "Test",
  line: "",
  closesAt: 1_000_000,
  round: 1,
  deposit: zec(2).toString(),
  format: "second",
  access: "link",
  after: "private",
  createdAt: 0,
};

function bid(id: string, seq: number, at = 500_000, deposit = 2, envelope = id): SealedBid {
  return { id, seq, at, deposit: zec(deposit).toString(), envelope };
}

function run(bids: SealedBid[], amounts: Record<string, number | null>, extra: Partial<RoomTerms> = {}, reserve: number | null = null, out?: number) {
  const opened = new Map(Object.entries(amounts).map(([k, v]) => [k, v === null ? null : { amount: zec(v), name: 7 }]));
  return judge({ ...terms, ...extra }, bids, opened, reserve === null ? null : zec(reserve), out);
}

const winner = (out: ReturnType<typeof run>) => out.winners[0] ?? null;

describe("judge", () => {
  it("gives the item to the highest bid at the second-highest price", () => {
    const out = run([bid("a", 1), bid("b", 2), bid("c", 3)], { a: 16, b: 21.4, c: 20.1 });
    expect(winner(out)?.id).toBe("b");
    expect(out.price).toBe(zec(20.1));
    expect(out.bids.map((b) => b.id)).toEqual(["b", "c", "a"]);
  });

  it("charges the winner's own bid in a first-price room", () => {
    const out = run([bid("a", 1), bid("b", 2)], { a: 16, b: 21.4 }, { format: "first" });
    expect(out.price).toBe(zec(21.4));
  });

  it("breaks ties by the earlier bid", () => {
    const out = run([bid("late", 2, 600_000), bid("early", 1, 400_000)], { late: 20, early: 20 });
    expect(winner(out)?.id).toBe("early");
    expect(out.price).toBe(zec(20));
  });

  it("does not count a bid that arrived after closing", () => {
    const out = run([bid("a", 1), bid("b", 2, 1_000_001)], { a: 10, b: 50 });
    expect(winner(out)?.id).toBe("a");
    expect(out.bids.find((b) => b.id === "b")?.void).toBe("late");
  });

  it("does not count a bid whose deposit is short", () => {
    const out = run([bid("a", 1), bid("b", 2, 500_000, 1.5)], { a: 10, b: 50 });
    expect(winner(out)?.id).toBe("a");
    expect(out.bids.find((b) => b.id === "b")?.void).toBe("deposit");
  });

  it("counts a copied envelope only where it first appeared", () => {
    const out = run([bid("orig", 1, 400_000, 2, "same"), bid("copy", 2, 450_000, 2, "same"), bid("c", 3)], { orig: 30, copy: 30, c: 10 });
    expect(winner(out)?.id).toBe("orig");
    expect(out.bids.find((b) => b.id === "copy")?.void).toBe("copy");
    expect(out.price).toBe(zec(10));
  });

  it("does not count an envelope that would not open", () => {
    const out = run([bid("a", 1), bid("b", 2)], { a: 10, b: null });
    expect(winner(out)?.id).toBe("a");
    expect(out.bids.find((b) => b.id === "b")?.void).toBe("unreadable");
  });

  it("charges at least the reserve, and sells nothing below it", () => {
    expect(run([bid("a", 1), bid("b", 2)], { a: 12, b: 20 }, {}, 15).price).toBe(zec(15));
    const unmet = run([bid("a", 1)], { a: 12 }, {}, 15);
    expect(winner(unmet)).toBeNull();
    expect(unmet.reserveMet).toBe(false);
  });

  it("charges a lone bidder the deposit when there is no reserve", () => {
    expect(run([bid("a", 1)], { a: 12 }).price).toBe(zec(2));
  });

  it("sells nothing when no bid came in", () => {
    const out = run([], {});
    expect(winner(out)).toBeNull();
    expect(out.price).toBeNull();
  });

  it("carries each bid's room name through to the result", () => {
    expect(winner(run([bid("a", 1)], { a: 12 }))?.name).toBe(7);
  });
});

describe("several winners", () => {
  const several = { format: "several" as const, units: 3 };

  it("gives the top bids one each, all at the highest bid that missed out", () => {
    const out = run([bid("a", 1), bid("b", 2), bid("c", 3), bid("d", 4), bid("e", 5)], { a: 7.5, b: 9.2, c: 6.8, d: 11, e: 8.4 }, several);
    expect(out.winners.map((w) => w.id)).toEqual(["d", "b", "e"]);
    expect(out.price).toBe(zec(7.5));
  });

  it("charges the reserve when fewer bids than units reach it", () => {
    const out = run([bid("a", 1), bid("b", 2), bid("c", 3)], { a: 4, b: 9, c: 7 }, several, 6);
    expect(out.winners.map((w) => w.id)).toEqual(["b", "c"]);
    expect(out.price).toBe(zec(6));
  });

  it("never charges a winner more than the lowest winning bid", () => {
    const out = run([bid("a", 1), bid("b", 2)], { a: 10, b: 10 }, several);
    expect(out.winners).toHaveLength(2);
    expect(out.price).toBe(zec(2));
  });
});

describe("candle sale", () => {
  const candle = { format: "candle" as const, candleFrom: 900_000 };

  it("counts only the bids that arrived before the candle went out", () => {
    const out = run([bid("a", 1, 500_000), bid("b", 2, 950_000), bid("c", 3, 980_000)], { a: 10, b: 12, c: 15 }, candle, null, 960_000);
    expect(winner(out)?.id).toBe("b");
    expect(out.price).toBe(zec(12));
    expect(out.bids.find((b) => b.id === "c")?.void).toBe("candle");
    expect(out.candleOut).toBe(960_000);
  });

  it("lets the last bid win when the candle burns to the end", () => {
    const out = run([bid("a", 1, 500_000), bid("c", 3, 980_000)], { a: 10, c: 15 }, candle, null, 1_000_000);
    expect(winner(out)?.id).toBe("c");
  });

  it("picks the same moment from the same signature, inside the window", () => {
    const room = { ...terms, ...candle };
    const signature = "8086ff9fb7829494ce55233ff19498147b391fccbed2b750d589a10f53fdd99306c9ffba630e7d36ff04f74566b21ac3";
    const at = candleOut(room, signature);
    expect(candleOut(room, signature)).toBe(at);
    expect(at).toBeGreaterThanOrEqual(900_000);
    expect(at).toBeLessThanOrEqual(1_000_000);
  });

  it("moves to a different moment when the signature changes", () => {
    const room = { ...terms, ...candle };
    const a = candleOut(room, "8086ff9fb7829494ce55233ff19498147b391fccbed2b750d589a10f53fdd99306c9ffba630e7d36ff04f74566b21ac3");
    const b = candleOut(room, "8086ff9fb7829494ce55233ff19498147b391fccbed2b750d589a10f53fdd99306c9ffba630e7d36ff04f74566b21ac4");
    expect(a).not.toBe(b);
  });

  it("burns for the last quarter of the room, between a minute and a day", () => {
    expect(candleWindow(0, 4 * 3_600_000)).toBe(3_600_000);
    expect(candleWindow(0, 60_000)).toBe(60_000);
    expect(candleWindow(0, 30 * 86_400_000)).toBe(86_400_000);
  });
});

describe("paddles", () => {
  it("count a bid only at a paddle the room issued", () => {
    const terms = { v: 1, id: "abcdefghijkm", name: "x", line: "", closesAt: 10_000, round: 1, deposit: "100", format: "first", access: "invite", after: "private", createdAt: 0, paddles: 3 } as const;
    const bids = [
      { id: "a", envelope: "A", deposit: "100", at: 1, seq: 1, paddle: 1 },
      { id: "b", envelope: "B", deposit: "100", at: 2, seq: 2, paddle: 4 },
      { id: "c", envelope: "C", deposit: "100", at: 3, seq: 3 },
    ];
    const opened = new Map([
      ["a", { amount: 500n, name: null }],
      ["b", { amount: 900n, name: null }],
      ["c", { amount: 800n, name: null }],
    ]);
    const outcome = judge(terms, bids, opened, null);
    // Positive control: the issued paddle's bid wins.
    expect(outcome.winners.map((w) => w.id)).toEqual(["a"]);
    expect(outcome.bids.find((b) => b.id === "b")?.void).toBe("paddle");
    expect(outcome.bids.find((b) => b.id === "c")?.void).toBe("paddle");
  });
});
