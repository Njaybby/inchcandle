import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle, Key, LockKey, Plus, X } from "@phosphor-icons/react";
import { toBase64Url, randomBytes } from "../lib/bytes";
import { encodePayload } from "../lib/envelope";
import { roomTag } from "../lib/ids";
import { useLive } from "../lib/live";
import { useMobile } from "../lib/layout";
import { parseZec } from "../lib/money";
import { roundAt } from "../lib/rounds";
import { Link, navigate } from "../lib/router";
import { steps } from "../shell/Shell";
import { Hash } from "../ui/Hash";

const detail: Record<string, { body: string; hood: string }> = {
  open: {
    body: "A host opens a room for one lot and picks how it sells. The room gets its own key, and in a private room everything about it is sealed under that key before it leaves the browser.",
    hood: "Room key: 32 random bytes. Terms sealed with AES-256-GCM, bound to the room id. Room seal: the first 8 bytes of SHA-256 over the id.",
  },
  codes: {
    body: "The host hands out one code per bidder. The first device to use a code keeps it, and the directory only ever sees a one-way fingerprint of it, so even a leaked database gives nobody a way in.",
    hood: "80-bit Crockford base32 codes. Lookup id: SHA-256 of the code. Admission: room key and paddle under AES-GCM with an HKDF key from the code. Redemption is one conditional write, bound to a non-extractable P-256 device key.",
  },
  seal: {
    body: "Your browser locks the amount to a drand round in the future. Until that round, no key that opens it exists anywhere: not on a server, not with the host, not with you.",
    hood: "Timelock encryption: Boneh-Franklin IBE on BLS12-381 to the round's identity, then ChaCha20-Poly1305 over the payload. The payload holds the amount, a claim key and your room name.",
  },
  send: {
    body: "The sealed bid travels as a shielded Zcash payment, with a deposit, inside the memo. Nobody outside the room can see who paid, how much or that a bid was placed at all.",
    hood: "A ZIP 321 request to your paddle's diversified address, scanned in Zodl. The memo is 'IC1' plus the envelope in base64url, under the 512-byte limit. On the preview network the directory holds it instead.",
  },
  "open-together": {
    body: "At the round, the League of Entropy publishes its signature. Every member's browser checks it, opens every bid at the same moment, applies the same rules and lands on the same result.",
    hood: "drand quicknet signs a round every 3 seconds. The browser verifies the BLS signature against the network key with its own pairing check, so no drand server is trusted.",
  },
  vault: {
    body: "The lot has been waiting in a vault on its own chain. Attesters open the bids the same way, check the winner paid, and sign. The winner names any address, and the vault sends the lot there.",
    hood: "LotVault clones from InchcandleVaultFactory. settle() needs 2 of 3 EIP-712 attester signatures over the room, the winning claim key, the price and the result hash. claim() needs the claim key's signature over the destination. reclaim() after the seller's deadline.",
  },
  verify: {
    body: "Anyone in the room can recompute the result from the same data. If an attester signed something else, the room sees it.",
    hood: "The result hash covers every judged bid, its amount and why it counted or not. It is what attesters sign and what every browser recomputes.",
  },
};

const record = [
  { what: "A copy of the US Constitution", when: "Sotheby's, 2021", how: "ConstitutionDAO raised 11,600 ETH in public and lost at $41M. Everyone could read its ceiling on chain.", lesson: "Sealed bids from shielded wallets hide the ceiling." },
  { what: "880 million tokens", when: "Zama, January 2026", how: "A sealed-bid Dutch auction with amounts encrypted under FHE drew $118M from 11,103 bidders.", lesson: "Encrypted bids draw real money. Bidders' wallets were still public." },
  { what: "The express lane", when: "Arbitrum Timeboost, 2025", how: "A sealed-bid second-price auction every round. Three entities won 99.74% of them.", lesson: "Second price is the professional's format." },
  { what: "A parachain slot", when: "Polkadot, 2021", how: "A candle auction: the real end was picked afterwards at random. A later block would have flipped the winner.", lesson: "Our candle sale, with drand as the randomness." },
  { what: "62,842 ETH of collateral", when: "MakerDAO, March 2020", how: "Under congestion, bots won 1,461 open auctions with bids of zero.", lesson: "A fixed sealed round doesn't race the last block." },
];

/** A live seal: type an amount and watch this browser lock it to a real drand round. */
function SealDemo() {
  const [value, setValue] = useState("12.5");
  const [result, setResult] = useState<{ envelope: string; round: number; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(e: FormEvent) {
    e.preventDefault();
    const amount = parseZec(value);
    if (amount === null) return;
    setBusy(true);
    const t0 = performance.now();
    const { seal } = await import("../lib/seal");
    const round = roundAt(Date.now() + 60 * 60_000);
    const env = await seal(round, roomTag("howitworks00"), encodePayload({ amount, claim: randomBytes(32), name: 141 }));
    setResult({ envelope: toBase64Url(env), round, ms: Math.round(performance.now() - t0) });
    setBusy(false);
  }
  return (
    <form className="seal-demo" onSubmit={run}>
      <label className="field-label" htmlFor="demo-amount">
        Try it: seal an amount
      </label>
      <div className="row">
        <div className="input-unit">
          <input id="demo-amount" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <span>ZEC</span>
        </div>
        <button type="submit" className="btn" disabled={busy}>
          <LockKey size={16} />
          {busy ? "Sealing…" : "Seal it"}
        </button>
      </div>
      {result && (
        <p className="t-small">
          Sealed to round <span className="mono">{result.round.toLocaleString("en-US")}</span>, an hour from now, in {result.ms} ms. Nothing can open it before then:
          <Hash value={result.envelope} keep={22} />
        </p>
      )}
    </form>
  );
}

function LiveRoundLine() {
  const live = useLive();
  return live.status === "verified" ? (
    <p className="status" data-tone="done">
      <CheckCircle size={16} weight="fill" />
      Round <span className="mono">{live.round.toLocaleString("en-US")}</span> just verified in this browser.
    </p>
  ) : (
    <p className="t-small">Checking drand…</p>
  );
}

export function How() {
  const mobile = useMobile();
  useEffect(() => {
    document.title = "How it works. Inchcandle";
    const id = location.hash.slice(1);
    if (id && !mobile) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);
  return mobile ? <Stories /> : <HowPage />;
}

function HowPage() {
  return (
    <div className="page how">
      <header className="step-head">
        <h1 className="t-title">How a sealed room works</h1>
        <p className="t-lead">Seven steps from a lot to a delivered lot. Each says what happens in plain words, with what runs underneath one line below.</p>
      </header>
      <ol className="how-steps">
        {steps.map((s) => (
          <li key={s.id} id={s.id} className="how-step">
            <span className="how-icon">{s.icon}</span>
            <div className="how-text">
              <h2 className="t-h2">{s.title}</h2>
              <p>{detail[s.id].body}</p>
              <p className="how-hood mono">{detail[s.id].hood}</p>
              {s.id === "seal" && <SealDemo />}
              {s.id === "open-together" && <LiveRoundLine />}
            </div>
          </li>
        ))}
      </ol>

      <section className="section">
        <div className="section-head">
          <h2>Who sees what</h2>
        </div>
        <table className="board">
          <thead>
            <tr>
              <th />
              <th>The public</th>
              <th>Room members</th>
              <th>The host</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Bid amounts</th>
              <td>Never</td>
              <td>From the opening</td>
              <td>From the opening, never before</td>
            </tr>
            <tr>
              <th>Who bid</th>
              <td>Never</td>
              <td>Never</td>
              <td>Never</td>
            </tr>
            <tr>
              <th>How many bid</th>
              <td>Never</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <th>The winner's top price</th>
              <td>Never</td>
              <td>From the opening</td>
              <td>From the opening</td>
            </tr>
            <tr>
              <th>Where the lot went</th>
              <td>A fresh address</td>
              <td>A fresh address</td>
              <td>A fresh address</td>
            </tr>
          </tbody>
        </table>
        <p className="t-small">On the preview network the directory stands in for Zcash and sees which device sent which sealed bid. On Zcash nobody does.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Auctions that ran on chain, and what they teach</h2>
        </div>
        <div className="record">
          {record.map((r) => (
            <article key={r.what} className="record-item">
              <p className="t-label">{r.when}</p>
              <h3 className="t-h3">{r.what}</h3>
              <p className="t-small">{r.how}</p>
              <p className="record-lesson">{r.lesson}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** On a phone, how it works is a story: one step per screen, tap to go on. */
function Stories() {
  const [i, setI] = useState(0);
  const total = steps.length + 1;
  const go = (n: number) => setI(Math.max(0, Math.min(total - 1, n)));
  useEffect(() => {
    const t = setTimeout(() => i < total - 1 && go(i + 1), 7000);
    return () => clearTimeout(t);
  }, [i]);
  const s = steps[i];
  return (
    <div className="stories" onClick={(e) => go(e.clientX < innerWidth / 3 ? i - 1 : i + 1)}>
      <div className="story-bars" aria-hidden="true">
        {Array.from({ length: total }, (_, k) => (
          <span key={k} data-state={k < i ? "done" : k === i ? "now" : "todo"}>
            <i key={`${k}-${i}`} />
          </span>
        ))}
      </div>
      <button type="button" className="icon-btn story-close" aria-label="Close" onClick={(e) => (e.stopPropagation(), navigate("/"))}>
        <X size={20} />
      </button>
      {s ? (
        <div className="story" key={s.id}>
          <span className="story-icon">{s.icon}</span>
          <h2>{s.title}</h2>
          <p>{detail[s.id].body}</p>
          <p className="how-hood mono">{detail[s.id].hood}</p>
          <span className="t-micro">Tap to continue</span>
        </div>
      ) : (
        <div className="story" key="end">
          <h2>That's the whole room.</h2>
          <p>Bids nobody can peek at, results everyone can check, and lots that only move on an attested result.</p>
          <div className="story-ctas" onClick={(e) => e.stopPropagation()}>
            <Link to="/new" className="btn gold lg block">
              <Plus size={18} weight="bold" />
              Create a room
            </Link>
            <Link to="/join" className="btn lg block">
              <Key size={18} />
              Join with a code
            </Link>
            <button type="button" className="btn ghost block" onClick={() => go(0)}>
              Watch again
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
