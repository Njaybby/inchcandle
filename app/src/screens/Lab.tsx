import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { BidCard } from "../ui/BidCard";
import { encodePayload, memoFor, memoPrefix, readHead, decodePayload } from "../lib/envelope";
import { fromBase64Url, randomBytes, toBase64Url } from "../lib/bytes";
import { roundAt, roundTime } from "../lib/rounds";
import { fetchBeacon, TooEarly } from "../lib/drand";
import { paymentUri } from "../lib/zip321";
import { zecDecimal } from "../lib/money";
import * as z from "../lib/zcash";

// Development only: one room account on the real chain, one paddle, one sealed bid, read back from the chain.
// It proves the light client round trip before the room screens are moved onto it.

interface Saved {
  seed: string;
  birthday: number;
  tag: string;
}

const deposit = 100_000n;
const tagLength = 8;

function key(network: z.Network) {
  return `ic.lab.${network}`;
}

function load(network: z.Network): Saved | null {
  const raw = localStorage.getItem(key(network));
  return raw ? (JSON.parse(raw) as Saved) : null;
}

interface Row extends z.RoomNote {
  opened?: string;
  round?: number;
  time?: number;
}

const names: Record<z.Network, string> = { main: "Mainnet", test: "Testnet", regtest: "Local chain" };

export function Lab() {
  const [network, setNetwork] = useState<z.Network>(() => {
    const net = new URL(location.href).searchParams.get("net");
    return net === "main" || net === "regtest" ? net : "test";
  });
  const [light, setLight] = useState<z.Light | null>(null);
  const [account, setAccount] = useState<number | null>(null);
  const [saved, setSaved] = useState<Saved | null>(() => load(network));
  const [height, setHeight] = useState<number | null>(null);
  const [paddle, setPaddle] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const say = (line: string) => setLog((l) => [...l, `${new Date().toISOString().slice(11, 19)} ${line}`]);

  async function step<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    const started = performance.now();
    try {
      const out = await run();
      say(`${label}: done in ${Math.round(performance.now() - started)} ms`);
      return out;
    } catch (error) {
      say(`${label}: failed. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let live = true;
    setLight(null);
    setAccount(null);
    setPaddle(null);
    setRows(null);
    setSaved(load(network));
    step("Start the light client", async () => {
      const l = await z.openWallet(network);
      const h = await z.tip(l);
      if (!live) return;
      setLight(l);
      setHeight(h);
      say(`${names[network]} tip is ${h}`);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  async function attach(l: z.Light, s: Saved) {
    const id = await z.addRoomAccount(l, s.seed, s.birthday);
    setAccount(id);
    const address = await z.paddleAddress(l, id, 1);
    setPaddle(address);
    return id;
  }

  async function makeRoom() {
    if (!light || height === null) return;
    const s: Saved = { seed: z.newSeedPhrase(), birthday: Math.max(1, height - 2), tag: toBase64Url(randomBytes(tagLength)) };
    localStorage.setItem(key(network), JSON.stringify(s));
    setSaved(s);
    await step("Add the room account", () => attach(light, s));
  }

  async function reuseRoom() {
    if (!light || !saved) return;
    await step("Add the saved room account", () => attach(light, saved));
  }

  async function sealBid(minutes: number) {
    if (!paddle || !saved) return;
    await step("Seal a bid", async () => {
      const round = roundAt(Date.now() + minutes * 60_000);
      const { seal } = await import("../lib/seal");
      const payload = encodePayload({ amount: 123_456n, claim: sha256(randomBytes(32)), name: 7 });
      const envelope = await seal(round, fromBase64Url(saved.tag), payload);
      setUri(paymentUri(paddle, deposit, memoFor(envelope)));
      say(`Sealed to round ${round}, which drand signs at ${new Date(roundTime(round)).toLocaleTimeString()}`);
    });
  }

  async function sync() {
    if (!light || account === null) return;
    await step("Sync", async () => {
      await light.wallet.sync();
      const notes = await z.roomNotes(light, account);
      const out: Row[] = [];
      for (const n of notes) {
        const row: Row = { ...n };
        if (n.height !== null) row.time = await z.blockTime(light, n.height);
        if (n.memo?.startsWith(memoPrefix)) {
          const envelope = fromBase64Url(n.memo.slice(memoPrefix.length).trim());
          const head = readHead(envelope);
          if (head) {
            row.round = head.round;
            try {
              const signature = await fetchBeacon(head.round);
              const { unseal } = await import("../lib/seal");
              const p = decodePayload(await unseal(envelope, signature));
              row.opened = `${zecDecimal(p.amount)} ZEC, name ${p.name ?? "none"}`;
            } catch (error) {
              row.opened = error instanceof TooEarly ? "sealed until its round" : `does not open: ${error instanceof Error ? error.message : error}`;
            }
          }
        }
        out.push(row);
      }
      setRows(out);
      setHeight(await z.tip(light));
      say(`${notes.length} note${notes.length === 1 ? "" : "s"} received by the room account`);
    });
  }

  return (
    <section className="page" style={{ display: "grid", gap: 24, maxWidth: 880 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1>Chain lab</h1>
        <p className="caption">Development only. A room account on the real chain, a sealed bid to paddle 1, and the bid read back by the light client.</p>
      </header>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className={network === "test" ? "button" : "button quiet"} onClick={() => setNetwork("test")}>
          Testnet
        </button>
        <button type="button" className={network === "main" ? "button" : "button quiet"} onClick={() => setNetwork("main")}>
          Mainnet
        </button>
        <button type="button" className={network === "regtest" ? "button" : "button quiet"} onClick={() => setNetwork("regtest")}>
          Local chain
        </button>
        <span className="caption" data-testid="tip">
          {height === null ? "Reaching the light server…" : `Tip ${height}`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="button" disabled={!light || !!busy} onClick={makeRoom}>
          New room account
        </button>
        {saved && (
          <button type="button" className="button quiet" disabled={!light || !!busy || account !== null} onClick={reuseRoom}>
            Use the saved one (birthday {saved.birthday})
          </button>
        )}
      </div>

      {paddle && (
        <div style={{ display: "grid", gap: 12 }}>
          <p className="caption">Paddle 1</p>
          <code data-testid="paddle" style={{ wordBreak: "break-all" }}>
            {paddle}
          </code>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="button quiet" disabled={!!busy} onClick={() => sealBid(3)}>
              Seal a bid that opens in 3 minutes
            </button>
            <button type="button" className="button quiet" disabled={!!busy} onClick={() => sealBid(60)}>
              Seal one that opens in an hour
            </button>
            <button type="button" className="button quiet" disabled={!!busy} onClick={sync}>
              Sync and read the room
            </button>
          </div>
        </div>
      )}

      {uri && <BidCard uri={uri} title="Lab bid" note={`${zecDecimal(deposit)} ZEC deposit to paddle 1`} fileName="inchcandle-lab-bid.png" />}
      {uri && (
        <code data-testid="uri" style={{ wordBreak: "break-all", fontSize: 12 }}>
          {uri}
        </code>
      )}

      {rows && (
        <table data-testid="notes" style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Paddle</th>
              <th align="left">Value</th>
              <th align="left">Height</th>
              <th align="left">Block time</th>
              <th align="left">Pool</th>
              <th align="left">Bid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.txid}:${r.index}`}>
                <td>{r.change ? "change" : r.address_index}</td>
                <td>{zecDecimal(BigInt(r.value))}</td>
                <td>{r.height ?? "pending"}</td>
                <td>{r.time ? new Date(r.time * 1000).toLocaleTimeString() : ""}</td>
                <td>{r.pool}</td>
                <td>{r.opened ?? (r.memo ? "memo, not a bid" : "no memo")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <pre data-testid="log" className="caption" style={{ whiteSpace: "pre-wrap" }}>
        {busy ? `${busy}…\n` : ""}
        {log.join("\n")}
      </pre>
    </section>
  );
}
