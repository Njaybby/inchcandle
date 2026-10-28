import { useMemo, type ReactNode } from "react";
import { At, Bank, Coins, Cube, FileLock, LockSimple, Package, Tag, Vault } from "@phosphor-icons/react";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64Url, utf8 } from "../lib/bytes";
import { formatName } from "../lib/formats";
import { formatZec } from "../lib/money";
import { Link } from "../lib/router";
import { phase, type Seen } from "../lib/rooms";
import { roundTime } from "../lib/rounds";
import { moment, spell } from "../lib/time";
import type { LotKind, RoomTerms } from "../lib/types";
import { chainByKey } from "../lib/chains";
import { Hash } from "./Hash";
import { Seal } from "./Seal";

export const lotIcon: Record<LotKind, ReactNode> = {
  nft: <Cube size={14} />,
  token: <Coins size={14} />,
  name: <At size={14} />,
  collateral: <Bank size={14} />,
  physical: <Package size={14} />,
  file: <FileLock size={14} />,
  other: <Tag size={14} />,
};

export const lotName: Record<LotKind, string> = {
  nft: "NFT",
  token: "Token allocation",
  name: "Name",
  collateral: "Collateral",
  physical: "Physical item",
  file: "Digital file",
  other: "Lot",
};

/** The time line on a ticket: what is happening next, and when exactly. */
export function timeLine(terms: RoomTerms, now: number): { head: string; exact: string; tone?: "ember" | "gold" } {
  const p = phase(terms, now);
  if (p === "opened") return { head: "Opened", exact: moment(roundTime(terms.round), now), tone: "gold" };
  if (p === "waiting") return { head: "Opening now", exact: `Round ${terms.round.toLocaleString("en-US")}` };
  const head = `${terms.format === "candle" ? "Ends by" : "Closes in"} ${spell(terms.closesAt - now)}`;
  return { head, exact: moment(terms.closesAt, now), tone: p === "closing" ? "ember" : undefined };
}

/** A row of frost ticks, one per sealed bid, up to twelve. */
export function SealedCount({ count, sealed }: { count: number; sealed: boolean }) {
  return (
    <span className="sealed-count" data-sealed={sealed}>
      <span className="ticks" aria-hidden="true">
        {Array.from({ length: Math.min(count, 12) }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <span className="num">
        {count} {sealed ? (count === 1 ? "sealed bid" : "sealed bids") : count === 1 ? "bid" : "bids"}
      </span>
    </span>
  );
}

/** Ciphertext that never resolves: what a concealed room shows where its details would be. */
export function CipherBlock({ seed, lines = 16 }: { seed: string; lines?: number }) {
  const text = useMemo(() => {
    const out: string[] = [];
    let h = sha256(utf8.encode(`inchcandle/cipher/${seed}`));
    for (let i = 0; i < lines; i++) {
      h = sha256(h);
      out.push((toBase64Url(h) + toBase64Url(sha256(h)) + toBase64Url(sha256(sha256(h)))).slice(0, 120));
    }
    return out;
  }, [seed, lines]);
  return (
    <div className="cipher" aria-hidden="true">
      <div className="cipher-text mono">
        {text.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </div>
      <span className="cipher-sheen" />
    </div>
  );
}

export function RoomTicket({ seen, now, bids }: { seen: Seen; now: number; bids?: number }) {
  const { room, terms, role } = seen;
  if (!terms) return <ConcealedTicket seen={seen} />;
  const time = timeLine(terms, now);
  const count = bids ?? room.bids ?? 0;
  const vaultChain = terms.vault ? chainByKey(terms.vault.chain) : undefined;
  const p = phase(terms, now);
  const progress = Math.min(1, Math.max(0, (terms.closesAt - now) / Math.max(1, terms.closesAt - terms.createdAt)));

  return (
    <Link to={`/r/${room.id}`} className="ticket" data-phase={p}>
      <div className="ticket-media">
        {terms.photo && terms.photo !== "local" ? <img src={terms.photo.replace("-1200", "-600")} alt="" loading="lazy" /> : <Seal seed={room.id} />}
        <div className="ticket-flags">
          {terms.example && <span className="chip">Example</span>}
          {role === "host" && <span className="chip" data-tone="gold">Hosting</span>}
          {role === "member" && <span className="chip">Paddle {seen.paddle}</span>}
        </div>
      </div>
      <div className="ticket-perf" aria-hidden="true" />
      <div className="ticket-body">
        <div className="ticket-time" data-tone={time.tone}>
          <span className="ticket-wick" aria-hidden="true">
            <span style={{ transform: `scaleY(${p === "open" || p === "closing" ? progress : 0})` }} />
          </span>
          <span className="ticket-when">
            <b>{time.head}</b>
            <span>{time.exact}</span>
          </span>
        </div>
        <h3 className="ticket-title">{terms.name}</h3>
        <p className="ticket-line">
          {formatName[terms.format]}
          <span className="sep" aria-hidden="true" />
          {formatZec(BigInt(terms.deposit))} ZEC deposit
        </p>
        <div className="ticket-meta">
          <SealedCount count={count} sealed={terms.format !== "candle"} />
          {terms.lot && (
            <span className="chip">
              {lotIcon[terms.lot.kind]}
              {lotName[terms.lot.kind]}
            </span>
          )}
          {vaultChain && (
            <span className="chip" data-tone="frost">
              <Vault size={14} />
              {vaultChain.name}
            </span>
          )}
        </div>
        <Hash value={room.fingerprint} keep={0} scramble={false} />
      </div>
    </Link>
  );
}

export function ConcealedTicket({ seen }: { seen: Seen }) {
  const { room } = seen;
  return (
    <Link to={`/r/${room.id}`} className="ticket concealed">
      <div className="ticket-media">
        <CipherBlock seed={room.id} />
        <span className="concealed-lock">
          <LockSimple size={22} weight="regular" />
        </span>
      </div>
      <div className="ticket-perf" aria-hidden="true" />
      <div className="ticket-body">
        <span className="chip" data-tone="frost">
          <LockSimple size={13} />
          Invite only
        </span>
        <h3 className="ticket-title">{room.name ?? "Hidden room"}</h3>
        <p className="ticket-line">Its lot, rules and bids are sealed to the people holding a code.</p>
        <Hash value={room.fingerprint} keep={0} scramble={false} />
      </div>
    </Link>
  );
}
