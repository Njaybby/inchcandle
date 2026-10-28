import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Check, CheckCircle, Eye, Key, LockSimple, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { api, usePoll } from "../lib/api";
import { chainBids, onChain } from "../lib/chainRoom";
import { useSecretsVersion } from "../lib/device";
import { formatName, formatSentence, sealed as isSealed } from "../lib/formats";
import { useNow } from "../lib/hooks";
import { useMobile } from "../lib/layout";
import { formatZec } from "../lib/money";
import { nameText, randomName } from "../lib/names";
import { openBids, useOpening } from "../lib/opening";
import { fingerprint, joinPublic, phase, redeem, see } from "../lib/rooms";
import { roundTime } from "../lib/rounds";
import { navigate } from "../lib/router";
import { local, useStoreVersion } from "../lib/store";
import { moment, momentInline, spell } from "../lib/time";
import { toast } from "../lib/toast";
import type { Outcome } from "../lib/rules";
import type { MyBid, RoomTerms, SealedBid } from "../lib/types";
import { BidList } from "../ui/BidList";
import { CodeInput } from "../ui/CodeInput";
import { Dust } from "../ui/Dust";
import { Hash } from "../ui/Hash";
import { Name } from "../ui/Name";
import { Seal } from "../ui/Seal";
import { CipherBlock, lotIcon, lotName } from "../ui/Ticket";
import { Wick } from "../ui/Wick";
import { BidTray } from "./room/BidTray";
import { CodeBook } from "./room/CodeBook";
import { VaultPanel } from "./room/VaultPanel";

const rerolls = 3;

export function RoomPage({ id, url }: { id: string; url: URL }) {
  useSecretsVersion();
  const record = usePoll(() => api.room(id), 5000, [id]);
  const seen = useMemo(() => (record.data ? see(record.data) : null), [record.data]);

  useEffect(() => {
    document.title = `${seen?.terms?.name ?? seen?.room.name ?? "Room"}. Inchcandle`;
  }, [seen?.terms?.name, seen?.room.name]);

  if (record.error && !record.data)
    return (
      <div className="page">
        <div className="empty">
          <h3>{record.error.status === 404 ? "There's no room here" : "Couldn't load this room"}</h3>
          <p className="t-small">{record.error.status === 404 ? "The link may be wrong, or the room is hidden and this device holds no code for it." : record.error.message}</p>
          <button type="button" className="btn" onClick={() => navigate("/join")}>
            <Key size={16} />
            Join with a code
          </button>
        </div>
      </div>
    );
  if (!seen) return <div className="skeleton" style={{ height: 520 }} />;
  if (!seen.terms) return <Locked id={id} name={seen.room.name} onIn={record.reload} />;
  return <Room terms={seen.terms} role={seen.role} paddle={seen.paddle} listing={seen.room.listing} tab={url.searchParams.get("tab")} onChange={record.reload} />;
}

/** A private room seen from outside: its name, its seal, and a way in with a code. */
function Locked({ id, name, onIn }: { id: string; name: string | null; onIn: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(value = code) {
    setBusy(true);
    setError("");
    const result = await redeem(value);
    setBusy(false);
    if (!result.ok) return setError(result.reason);
    if (result.id !== id) return navigate(`/r/${result.id}`);
    toast("You're in. This device now holds the room's key.");
    onIn();
  }
  return (
    <div className="locked">
      <div className="locked-art">
        <CipherBlock seed={id} lines={30} />
        <span className="concealed-lock">
          <LockSimple size={24} />
        </span>
      </div>
      <div className="locked-body">
        <span className="chip" data-tone="frost">
          <LockSimple size={13} />
          Invite only
        </span>
        <h1 className="t-title">{name ?? "A hidden room"}</h1>
        <p className="t-lead">The lot, its rules and its bids are sealed under a key that only the host's codes open. The directory itself can't read them.</p>
        <div className="panel marks locked-form">
          <CodeInput value={code} onChange={setCode} onComplete={go} invalid={!!error} label="Your code for this room" />
          {error && (
            <p className="status" data-tone="error">
              <WarningCircle size={16} />
              {error}
            </p>
          )}
          <button type="button" className="btn gold lg block" disabled={code.length !== 16 || busy} onClick={() => go()}>
            <Key size={18} />
            {busy ? "Checking…" : "Unlock room"}
          </button>
        </div>
        <Hash value={fingerprint(id)} keep={0} label="Room seal" />
      </div>
    </div>
  );
}

function Room({ terms, role, paddle, listing, tab, onChange }: { terms: RoomTerms; role: "host" | "member" | null; paddle?: number; listing: string; tab: string | null; onChange: () => void }) {
  const mobile = useMobile();
  const version = useStoreVersion();
  const now = useNow(1000, [terms.closesAt, roundTime(terms.round)]);
  const canRead = listing === "public" || !!role;
  const wire = usePoll(() => (canRead ? api.bids(terms.id) : Promise.resolve([])), 3000, [terms.id, canRead]);
  const committee = usePoll(() => api.attesters(), 0).data ?? [];
  // On a Zcash network every browser reads the bids from the room's notes on the chain, not from the directory.
  const chain = onChain(terms) && canRead;
  const notes = usePoll(() => (chain ? chainBids(terms) : Promise.resolve(null)), 5000, [terms.id, chain]);
  const myBids = useMemo(() => local.myBids(terms.id).filter((b) => b.paid), [terms.id, version]);
  const arrived: SealedBid[] = useMemo(() => {
    if (chain) {
      const ids = new Map(myBids.map((b) => [b.envelope, b.id]));
      return (notes.data ?? []).map((b) => ({ ...b, id: ids.get(b.envelope) ?? b.id }));
    }
    return (wire.data ?? []).map((b) => ({ id: b.id, envelope: b.envelope, deposit: b.deposit, at: b.at, seq: b.seq, paddle: b.paddle }));
  }, [chain, notes.data, wire.data, myBids]);
  const mine = useMemo(() => new Set(myBids.map((b) => b.id)), [myBids]);
  const opening = useOpening(terms, arrived, now);
  const candle = terms.format === "candle";
  const live = useMemo(() => (candle ? openBids(terms, arrived) : undefined), [candle, terms, arrived]);
  const [tray, setTray] = useState(false);
  const [view, setView] = useState<"room" | "codes">(tab === "codes" && role === "host" ? "codes" : "room");
  const [settled, setSettled] = useState(false);
  const p = phase(terms, now);
  const open = now < terms.closesAt;
  const host = role === "host";
  const myName = local.name(terms.id);
  const outcome: Outcome | null = opening.status === "opened" ? opening.outcome : null;
  const leadingId = live ? [...live].filter(([, v]) => v).sort(([, a], [, b]) => (a!.amount === b!.amount ? 0 : a!.amount > b!.amount ? -1 : 1))[0]?.[0] : undefined;
  const leading = leadingId ? live!.get(leadingId)!.amount : null;
  const iLead = !!leadingId && mine.has(leadingId);
  const myTop = myBids.length ? myBids.reduce((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? b : a)) : null;
  const canBid = open && role === "member" && myName !== null && (!myTop || (candle && !iLead));
  const needsJoin = open && !host && (role !== "member" || myName === null);

  useEffect(() => {
    if (!open) Promise.all([import("../lib/drand"), import("../lib/seal")]);
  }, [open]);

  const head = (
    <header className="room-head">
      <div className="room-chips">
        {terms.example && <span className="chip">Example room</span>}
        <span className="chip">{formatName[terms.format]}</span>
        {terms.lot && (
          <span className="chip">
            {lotIcon[terms.lot.kind]}
            {lotName[terms.lot.kind]}
          </span>
        )}
        <span className="chip" data-tone={listing === "public" ? undefined : "frost"}>
          {listing === "public" ? "Public" : listing === "private" ? "Private" : "Hidden"}
        </span>
        <span className="chip" data-tone="frost">
          Preview network
        </span>
        {host && (
          <span className="chip" data-tone="gold">
            You're hosting
          </span>
        )}
        {role === "member" && paddle && <span className="chip">Paddle {paddle}</span>}
        {onChain(terms) && <span className="chip" data-tone="gold">Local Zcash chain</span>}
      </div>
      <h1 className="t-title room-title">{terms.name}</h1>
      {terms.line && <p className="t-lead">{terms.line}</p>}
    </header>
  );

  const when = (
    <div className="room-when" data-phase={p}>
      {open && <Wick start={terms.createdAt} end={terms.closesAt} height={58} />}
      <div>
        <p className="room-when-head">
          {p === "opened" ? "Opened" : p === "waiting" ? "Closed. Opening at the round" : `${candle ? "The candle goes out by" : "Closes in"} ${spell(terms.closesAt - now)}`}
        </p>
        <p className="t-small">
          {p === "opened" ? moment(roundTime(terms.round), now) : p === "waiting" ? `drand round ${terms.round.toLocaleString("en-US")}, ${moment(roundTime(terms.round), now)}` : moment(terms.closesAt, now)}
        </p>
      </div>
    </div>
  );

  const bidsSection = (
    <section className="room-section">
      <div className="section-head">
        <h2>{isSealed(terms) ? (p === "opened" ? "Opened bids" : "Sealed bids") : "Bids"}</h2>
        <span className="t-small">
          {arrived.length} {arrived.length === 1 ? "bid" : "bids"}
          {isSealed(terms) && open ? ", none readable until the round" : ""}
        </span>
      </div>
      {!canRead ? (
        <p className="t-small">Only members read the bids.</p>
      ) : arrived.length ? (
        <BidList terms={terms} arrived={arrived} state={opening} mine={mine} live={opening.status === "opened" ? undefined : live} onSettled={() => setSettled(true)} />
      ) : (
        <p className="t-small">{open ? (host ? "No bids yet. Hand out codes to bring bidders in." : "No bids yet.") : "No bids came in."}</p>
      )}
      {!open && opening.status === "fetching" && (
        <p className="status">
          <span className="waiting">
            <span />
            <span />
            <span />
          </span>
          {opening.retrying ? "Couldn't reach drand. Trying again." : `Fetching round ${terms.round.toLocaleString("en-US")} and checking its signature`}
        </p>
      )}
    </section>
  );

  const action = needsJoin ? null : canBid ? (
    <button type="button" className="btn gold lg block" onClick={() => setTray(true)}>
      {candle ? (myTop ? "Raise your bid" : "Place a bid") : "Place a sealed bid"}
    </button>
  ) : null;

  const body = (
    <>
      {when}
      {needsJoin && <JoinPanel terms={terms} role={role} paddle={paddle} listing={listing} onJoined={onChange} />}
      {open && myTop && <YourBid terms={terms} bid={myTop} leading={candle ? iLead : null} />}
      {outcome && (settled || opening.status === "opened") && <ResultPanel terms={terms} outcome={outcome} mine={mine} host={host} />}
      {bidsSection}
      {!mobile && action && <div className="room-action">{action}</div>}
      {terms.vault && <VaultPanel terms={terms} outcome={outcome} myBids={myBids} host={host} committee={committee} />}
      <ProofPanel terms={terms} arrived={arrived.length} opening={opening.status === "opened" ? { signature: opening.signature, opened: opening.opened } : null} />
    </>
  );

  const media = (
    <div className="room-media">
      {terms.photo && terms.photo !== "local" ? <img src={terms.photo} alt={terms.name} /> : <Seal seed={terms.id} />}
    </div>
  );

  const hostTabs = host && listing !== "public" && (
    <div className="tabs room-tabs" role="tablist" aria-label="Host views">
      <button type="button" role="tab" className="tab" aria-selected={view === "room"} onClick={() => setView("room")}>
        Room
      </button>
      <button type="button" role="tab" className="tab" aria-selected={view === "codes"} onClick={() => setView("codes")}>
        Code book
      </button>
    </div>
  );

  return (
    <div className={mobile ? "m-room" : "room"}>
      {mobile ? (
        <>
          {media}
          <div className="m-room-body">
            {head}
            {hostTabs}
            {view === "codes" ? <CodeBook terms={terms} /> : body}
            {terms.about && view === "room" && <p className="room-about">{terms.about}</p>}
            {terms.credit && view === "room" && <p className="t-micro">{terms.credit}</p>}
          </div>
          {action && <div className="m-dock">{action}</div>}
        </>
      ) : (
        <>
          <div className="room-left">
            {media}
            {terms.about && <p className="room-about">{terms.about}</p>}
            {terms.credit && <p className="t-micro">{terms.credit}</p>}
            <p className="t-small">{formatSentence(terms)}</p>
          </div>
          <div className="room-right">
            {head}
            {hostTabs}
            {view === "codes" ? <CodeBook terms={terms} /> : body}
          </div>
        </>
      )}
      {myName !== null && <BidTray terms={terms} open={tray} onClose={() => setTray(false)} name={myName} leading={leading} raising={candle && !!myTop && !iLead} onPlaced={() => wire.reload()} />}
    </div>
  );
}

/** Before bidding: a public room hands out the next paddle; every room asks for the name you'll bid under. */
function JoinPanel({ terms, role, paddle, listing, onJoined }: { terms: RoomTerms; role: "host" | "member" | null; paddle?: number; listing: string; onJoined: () => void }) {
  const [drawn, setDrawn] = useState<number[]>(() => [randomName()]);
  const [busy, setBusy] = useState(false);
  const name = drawn[drawn.length - 1];
  async function join() {
    setBusy(true);
    try {
      if (role !== "member") {
        if (listing !== "public") return navigate("/join");
        await joinPublic(terms.id, terms.name);
      }
      local.join(terms.id, name);
      toast(`You're ${nameText(name)} in this room.`);
      onJoined();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't join.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel join-panel">
      <div className="panel-body">
        <p className="t-label">{role === "member" ? `Your code gave you paddle ${paddle}` : "Take a paddle to bid"}</p>
        <div className="name-pick-row">
          <span className="name-pick-name" aria-live="polite">
            <Name index={name} size={22} />
          </span>
          {drawn.length <= rerolls && (
            <button type="button" className="btn sm ghost" onClick={() => setDrawn([...drawn, randomName(drawn)])}>
              <ArrowsClockwise size={15} />
              Another name
            </button>
          )}
        </div>
        <p className="t-small">{isSealed(terms) ? "A fresh name for this room only, sealed inside your bid. Nobody sees it until the bids open." : "A fresh name for this room only. Everyone sees it next to your bids, and nothing else about you."}</p>
        <button type="button" className="btn gold lg block" onClick={join} disabled={busy}>
          {busy ? "Joining…" : role === "member" ? "Bid under this name" : "Take a paddle"}
        </button>
      </div>
    </section>
  );
}

function YourBid({ terms, bid, leading }: { terms: RoomTerms; bid: MyBid; leading: boolean | null }) {
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!peek) return;
    const t = setTimeout(() => setPeek(false), 4000);
    return () => clearTimeout(t);
  }, [peek]);
  const amount = `${formatZec(BigInt(bid.amount))} ZEC`;
  if (leading !== null)
    return (
      <p className="status" data-tone="done">
        <Check size={18} />
        {leading ? `You're leading at ${amount}.` : `Your bid of ${amount} is in, and someone has bid more.`}
      </p>
    );
  return (
    <section className="your-bid panel">
      <div className="panel-body">
        <p className="status" data-tone="done">
          <CheckCircle size={18} weight="fill" />
          Bid received. Sealed until {momentInline(terms.closesAt)}.
        </p>
        <div className="your-bid-row">
          <span className="t-small">Your bid</span>
          <button type="button" className="peek" aria-pressed={peek} onClick={() => setPeek(!peek)}>
            {peek ? (
              <span className="peek-amount">{amount}</span>
            ) : (
              <span className="sealed" role="img" aria-label="Sealed. Show my bid">
                <Dust />
              </span>
            )}
            {!peek && <Eye size={16} aria-hidden="true" />}
          </button>
          <span className="t-micro">Only this device can show it. Not even the host can.</span>
        </div>
      </div>
    </section>
  );
}

function ResultPanel({ terms, outcome, mine, host }: { terms: RoomTerms; outcome: Outcome; mine: Set<string>; host: boolean }) {
  const { winners, price } = outcome;
  const won = winners.some((w) => mine.has(w.id));
  if (!winners.length || price === null)
    return (
      <section className="result panel">
        <div className="panel-body">
          <p className="t-label">Result</p>
          <h2 className="t-h2">No sale</h2>
          <p className="t-small">{outcome.bids.length === 0 ? "No bids came in." : "No bid reached the reserve."}</p>
        </div>
      </section>
    );
  const who = winners.length > 1 ? `${winners.length} winners` : won ? "You won" : host ? `Sold to ${winners[0].name !== null ? nameText(winners[0].name) : "a bidder"}` : mine.size ? "You didn't win" : `Sold to ${winners[0].name !== null ? nameText(winners[0].name) : "a bidder"}`;
  return (
    <section className="result panel" data-won={won || undefined}>
      <div className="panel-body">
        <p className="t-label">Result</p>
        <h2 className="t-h2">{who}</h2>
        <p className="result-price">
          {formatZec(price)}
          <span>ZEC{winners.length > 1 ? " each" : ""}</span>
        </p>
        <p className="t-small">{terms.format === "second" ? "The highest bid pays the second-highest bid." : terms.format === "several" ? "Each winner pays the highest bid that missed out." : "The highest bid pays what it bid."}</p>
      </div>
    </section>
  );
}

function ProofPanel({ terms, arrived, opening }: { terms: RoomTerms; arrived: number; opening: { signature: string; opened: number } | null }) {
  return (
    <details className="panel proof">
      <summary className="panel-head">
        <ShieldCheck size={17} />
        <h3>Check it yourself</h3>
        <span className="spacer" />
        <span className="t-micro">What every member's browser verifies</span>
      </summary>
      <div className="panel-body">
        <dl className="facts">
          <div className="fact">
            <dt>Room seal</dt>
            <dd>
              <Hash value={fingerprint(terms.id)} keep={0} />
            </dd>
          </div>
          <div className="fact">
            <dt>Sealed to</dt>
            <dd>
              drand quicknet round <span className="mono">{terms.round.toLocaleString("en-US")}</span>
            </dd>
          </div>
          <div className="fact">
            <dt>Envelopes</dt>
            <dd>{arrived} in the room</dd>
          </div>
          {terms.reserve && (
            <div className="fact">
              <dt>Sealed reserve</dt>
              <dd>
                <Hash value={terms.reserve} keep={10} />
              </dd>
            </div>
          )}
          {opening ? (
            <>
              <div className="fact">
                <dt>Round signature</dt>
                <dd>
                  <Hash value={opening.signature} keep={12} />
                </dd>
              </div>
              <div className="fact">
                <dt>Checked</dt>
                <dd className="ok">BLS pairing against the quicknet key, in this browser. {opening.opened} envelopes opened.</dd>
              </div>
            </>
          ) : (
            <div className="fact">
              <dt>Opens</dt>
              <dd>{moment(roundTime(terms.round))}. Until then no key that opens these bids exists anywhere.</dd>
            </div>
          )}
        </dl>
      </div>
    </details>
  );
}
