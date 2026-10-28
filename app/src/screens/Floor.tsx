import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle, Key, Plus, ShieldCheck } from "@phosphor-icons/react";
import { useNow } from "../lib/hooks";
import { useLive } from "../lib/live";
import { useMobile } from "../lib/layout";
import { formatName } from "../lib/formats";
import { nameText, nameCount } from "../lib/names";
import { phase, type Seen } from "../lib/rooms";
import { roundTime } from "../lib/rounds";
import { Link, navigate } from "../lib/router";
import { moment } from "../lib/time";
import { byUrgency, useRooms } from "../lib/useRooms";
import { CipherField } from "../ui/CipherField";
import { CodeInput } from "../ui/CodeInput";
import { Hash } from "../ui/Hash";
import { ConcealedTicket, RoomTicket } from "../ui/Ticket";

type Filter = "all" | "sealed" | "candle" | "private";

const filters: [Filter, string][] = [
  ["all", "All"],
  ["sealed", "Sealed bids"],
  ["candle", "Candle sales"],
  ["private", "Invite only"],
];

function matches(s: Seen, f: Filter) {
  if (f === "all") return true;
  if (f === "private") return !s.terms || s.room.listing !== "public";
  if (!s.terms) return false;
  return f === "candle" ? s.terms.format === "candle" : s.terms.format !== "candle";
}

/** Words the hero's sweep can open into: real room names on the floor and the bidder names rooms hand out. */
function useHeroWords(rooms: Seen[]): string[] {
  return useMemo(() => {
    const names = rooms.map((r) => r.terms?.name ?? r.room.name).filter((n): n is string => !!n).map((n) => n.slice(0, 28));
    const bidders = [3, 141, 287, 402, 519].map((i) => nameText(i % nameCount));
    return [...names, ...bidders, "Sealed bid", "Second price", "Candle out"];
  }, [rooms.map((r) => r.room.id).join(",")]);
}

function HeroProof() {
  const live = useLive();
  if (live.status !== "verified") return <div className="hero-proof">Waiting for the next drand round…</div>;
  return (
    <div className="hero-proof" title="The field sweeps each time a new drand round's BLS signature verifies in this browser">
      <CheckCircle size={15} weight="fill" />
      <span>Round</span>
      <span className="mono num">{live.round.toLocaleString("en-US")}</span>
      <span className="faint">signature checked in this browser</span>
    </div>
  );
}

export function Floor() {
  const mobile = useMobile();
  useEffect(() => {
    document.title = "Inchcandle. Sealed auctions on Zcash";
  }, []);
  return mobile ? <MobileFloor /> : <DesktopFloor />;
}

function Kpis({ stats, live }: { stats: ReturnType<typeof useRooms>["stats"]; live: ReturnType<typeof useLive> }) {
  const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString("en-US"));
  return (
    <div className="kpis" aria-label="The floor right now">
      <div className="kpi">
        <span className="t-label">Open rooms</span>
        <span className="kpi-value">{n(stats?.open)}</span>
      </div>
      <div className="kpi">
        <span className="t-label">Sealed bids waiting</span>
        <span className="kpi-value frost">{n(stats?.sealedBids)}</span>
      </div>
      <div className="kpi">
        <span className="t-label">Codes redeemed</span>
        <span className="kpi-value">
          {n(stats?.codesUsed)} <small>of {n(stats?.codesIssued)}</small>
        </span>
      </div>
      <div className="kpi">
        <span className="t-label">Lots in vaults</span>
        <span className="kpi-value">{n(stats?.vaults)}</span>
      </div>
      <div className="kpi">
        <span className="t-label">
          <CheckCircle size={13} weight="fill" className="ok" />
          drand, checked here
        </span>
        <span className="kpi-value mono" style={{ fontSize: 19, paddingTop: 5 }}>
          {live.status === "verified" ? live.round.toLocaleString("en-US") : "…"}
        </span>
      </div>
    </div>
  );
}

function DesktopFloor() {
  const { all, yours, stats, loading, error } = useRooms();
  const live = useLive();
  const now = useNow(5000);
  const [filter, setFilter] = useState<Filter>("all");
  const words = useHeroWords(all);
  const live_ = all.filter((s) => !s.terms || phase(s.terms, now) !== "opened").sort(byUrgency(now));
  const shown = live_.filter((s) => matches(s, filter));
  const opened = all.filter((s) => s.terms && phase(s.terms, now) === "opened").sort(byUrgency(now)).slice(0, 6);

  return (
    <div className="page">
      <section className="hero" aria-labelledby="hero-title">
        <CipherField words={words} />
        <div className="hero-copy">
          <h1 id="hero-title" className="t-display">
            Auctions where <em>nobody</em> can peek.
          </h1>
          <p className="hero-sub">Bids stay sealed until the room opens, even from the host. Lots wait in vaults on their own chain.</p>
          <div className="hero-ctas">
            <Link to="/new" className="btn gold lg">
              <Plus size={18} weight="bold" />
              Create a room
            </Link>
            <Link to="/join" className="btn lg">
              <Key size={18} />
              Join with a code
            </Link>
          </div>
        </div>
        <HeroProof />
      </section>

      <Kpis stats={stats} live={live} />

      {yours.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your rooms</h2>
            <span className="t-small">Hosting or holding a paddle, on this device</span>
            <span className="spacer" />
            <Link to="/you" className="btn sm ghost">
              All of them
              <ArrowRight size={14} />
            </Link>
          </div>
          <div className="ticket-grid">
            {yours
              .sort(byUrgency(now))
              .slice(0, 4)
              .map((s) => (
                <RoomTicket key={s.room.id} seen={s} now={now} />
              ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>On the floor</h2>
          <span className="spacer" />
          <div className="tabs" role="tablist" aria-label="Filter rooms">
            {filters.map(([f, label]) => (
              <button key={f} type="button" role="tab" className="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="ticket-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 420 }} />
            ))}
          </div>
        ) : error ? (
          <div className="empty">
            <h3>The directory isn't answering</h3>
            <p className="t-small">{error.message} Rooms you hold codes for still open on this device.</p>
          </div>
        ) : shown.length ? (
          <div className="ticket-grid">
            {shown.map((s) => (s.terms ? <RoomTicket key={s.room.id} seen={s} now={now} /> : <ConcealedTicket key={s.room.id} seen={s} />))}
          </div>
        ) : (
          <div className="empty">
            <h3>{filter === "all" ? "Nothing on the floor yet" : "No rooms of this kind right now"}</h3>
            <p className="t-small">Rooms appear here while they take bids. Private rooms show their name and nothing else.</p>
            {filter === "all" && (
              <Link to="/new" className="btn gold">
                <Plus size={16} weight="bold" />
                Create a room
              </Link>
            )}
          </div>
        )}
      </section>

      {opened.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recently opened</h2>
            <span className="t-small">Every member's browser opened these bids at the same round</span>
          </div>
          <div className="opened-list">
            {opened.map((s) => (
              <Link key={s.room.id} to={`/r/${s.room.id}`} className="opened-row">
                <span className="opened-name">{s.terms!.name}</span>
                <span className="t-small">{formatName[s.terms!.format]}</span>
                <span className="t-small">Opened {moment(roundTime(s.terms!.round), now)}</span>
                <span className="mono t-micro">round {s.terms!.round.toLocaleString("en-US")}</span>
                <Hash value={s.room.fingerprint} keep={0} scramble={false} />
                <ArrowRight size={16} className="faint" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MobileFloor() {
  const { all, yours, loading } = useRooms();
  const live = useLive();
  const now = useNow(5000);
  const [code, setCode] = useState("");
  const words = useHeroWords(all);
  const open = all.filter((s) => s.terms && phase(s.terms, now) !== "opened" && s.room.listing === "public").sort(byUrgency(now));
  const concealed = all.filter((s) => !s.terms);
  const opened = all.filter((s) => s.terms && phase(s.terms, now) === "opened").slice(0, 5);

  return (
    <div className="m-page">
      <section className="m-hero" aria-hidden="true">
        <CipherField words={words} quiet="none" fontSize={13} lineGap={20} />
        <span className="m-hero-mark">
          {live.status === "verified" ? (
            <>
              <CheckCircle size={14} weight="fill" />
              Round <span className="mono">{live.round.toLocaleString("en-US")}</span> verified here
            </>
          ) : (
            "Checking drand…"
          )}
        </span>
      </section>

      <section className="m-hero-copy">
        <h1>
          Auctions where <em>nobody</em> can peek.
        </h1>
        <p>Bids stay sealed until the room opens, even from the host.</p>
      </section>

      <section className="m-join panel marks">
        <CodeInput value={code} onChange={setCode} onComplete={(c) => navigate(`/join#c=${c}`)} size="md" label="Got a code from a host?" />
        <button type="button" className="btn gold block lg" disabled={code.length !== 16} onClick={() => navigate(`/join#c=${code}`)}>
          <Key size={18} />
          Join with a code
        </button>
      </section>

      {yours.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your rooms</h2>
          </div>
          <div className="m-rail">
            {yours.sort(byUrgency(now)).map((s) => (
              <RoomTicket key={s.room.id} seen={s} now={now} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Open now</h2>
          <span className="spacer" />
          <Link to="/rooms" className="btn sm ghost">
            See all
            <ArrowRight size={14} />
          </Link>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 380 }} />
        ) : open.length ? (
          <div className="m-rail">
            {open.map((s) => (
              <RoomTicket key={s.room.id} seen={s} now={now} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>No public rooms open</h3>
            <p className="t-small">Tap the gold button below to open one.</p>
          </div>
        )}
      </section>

      {concealed.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Invite only</h2>
            <span className="t-small">Names only. A code opens the rest.</span>
          </div>
          <div className="m-rail">
            {concealed.map((s) => (
              <ConcealedTicket key={s.room.id} seen={s} />
            ))}
          </div>
        </section>
      )}

      {opened.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Recently opened</h2>
          </div>
          <div className="opened-list">
            {opened.map((s) => (
              <Link key={s.room.id} to={`/r/${s.room.id}`} className="opened-row">
                <span className="opened-name">{s.terms!.name}</span>
                <span className="t-small">Opened {moment(roundTime(s.terms!.round), now)}</span>
                <ArrowRight size={16} className="faint" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <Link to="/how" className="m-how-cta">
        <ShieldCheck size={18} className="gold" />
        <span>
          <b>How a sealed room works</b>
          <span>Seven steps, one minute</span>
        </span>
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
