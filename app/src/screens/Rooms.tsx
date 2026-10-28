import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LockSimple, MagnifyingGlass, Vault } from "@phosphor-icons/react";
import { formatName } from "../lib/formats";
import { useNow } from "../lib/hooks";
import { useMobile } from "../lib/layout";
import { formatZec } from "../lib/money";
import { phase, type Seen } from "../lib/rooms";
import { Link } from "../lib/router";
import { byUrgency, useRooms } from "../lib/useRooms";
import { chainByKey } from "../lib/chains";
import { Hash } from "../ui/Hash";
import { Seal } from "../ui/Seal";
import { CipherBlock, ConcealedTicket, RoomTicket, SealedCount, lotIcon, lotName, timeLine } from "../ui/Ticket";

type Show = "live" | "opened" | "all";

export function Rooms({ url }: { url: URL }) {
  const mobile = useMobile();
  const { all, loading } = useRooms();
  const now = useNow(5000);
  const [q, setQ] = useState(url.searchParams.get("q") ?? "");
  const [show, setShow] = useState<Show>("live");
  useEffect(() => {
    document.title = "Rooms. Inchcandle";
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((s) => {
        const p = s.terms ? phase(s.terms, now) : "open";
        if (show === "live" && p === "opened") return false;
        if (show === "opened" && p !== "opened") return false;
        if (!needle) return true;
        return [s.terms?.name, s.room.name, s.terms?.line, s.room.fingerprint].some((x) => x?.toLowerCase().includes(needle));
      })
      .sort(byUrgency(now));
  }, [all, q, show, now]);

  if (mobile) return <Feed list={list} now={now} loading={loading} />;

  return (
    <div className="page">
      <div className="rooms-bar">
        <label className="rooms-search">
          <MagnifyingGlass size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or seal" aria-label="Filter rooms" />
        </label>
        <div className="tabs" role="tablist" aria-label="Which rooms">
          {(
            [
              ["live", "Taking bids"],
              ["opened", "Opened"],
              ["all", "All"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" className="tab" aria-selected={show === k} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="t-small">{list.length} rooms</span>
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 420 }} />
      ) : list.length ? (
        <div className="ticket-grid">{list.map((s) => (s.terms ? <RoomTicket key={s.room.id} seen={s} now={now} /> : <ConcealedTicket key={s.room.id} seen={s} />))}</div>
      ) : (
        <div className="empty">
          <h3>No rooms match</h3>
          <p className="t-small">Private rooms are listed by name only, and hidden rooms aren't listed at all.</p>
        </div>
      )}
    </div>
  );
}

/** On a phone, rooms are a vertical feed: one room fills the screen, a swipe brings the next. */
function Feed({ list, now, loading }: { list: Seen[]; now: number; loading: boolean }) {
  if (loading) return <div className="m-page"><div className="skeleton" style={{ height: "70dvh" }} /></div>;
  if (!list.length)
    return (
      <div className="m-page">
        <div className="empty">
          <h3>No rooms right now</h3>
          <p className="t-small">Tap the gold button to open one.</p>
        </div>
      </div>
    );
  return (
    <div className="feed">
      {list.map((s) => (
        <FeedCard key={s.room.id} seen={s} now={now} />
      ))}
    </div>
  );
}

function FeedCard({ seen, now }: { seen: Seen; now: number }) {
  const { room, terms } = seen;
  if (!terms)
    return (
      <Link to={`/r/${room.id}`} className="feed-card concealed">
        <div className="feed-media">
          <CipherBlock seed={room.id} lines={30} />
          <span className="concealed-lock">
            <LockSimple size={24} />
          </span>
        </div>
        <div className="feed-body">
          <span className="chip" data-tone="frost">
            <LockSimple size={13} />
            Invite only
          </span>
          <h2>{room.name ?? "Hidden room"}</h2>
          <p className="t-small">Sealed to code holders. Tap to unlock with yours.</p>
          <Hash value={room.fingerprint} keep={0} scramble={false} />
        </div>
      </Link>
    );
  const time = timeLine(terms, now);
  const chain = terms.vault ? chainByKey(terms.vault.chain) : undefined;
  return (
    <Link to={`/r/${room.id}`} className="feed-card">
      <div className="feed-media">{terms.photo && terms.photo !== "local" ? <img src={terms.photo.replace("-1200", "-600")} alt="" loading="lazy" /> : <Seal seed={room.id} />}</div>
      <div className="feed-body">
        <p className="feed-time" data-tone={time.tone}>
          <b>{time.head}</b> <span>{time.exact}</span>
        </p>
        <h2>{terms.name}</h2>
        <p className="t-small">
          {formatName[terms.format]}. {formatZec(BigInt(terms.deposit))} ZEC deposit.
        </p>
        <div className="ticket-meta">
          <SealedCount count={room.bids ?? 0} sealed={terms.format !== "candle"} />
          {terms.lot && (
            <span className="chip">
              {lotIcon[terms.lot.kind]}
              {lotName[terms.lot.kind]}
            </span>
          )}
          {chain && (
            <span className="chip" data-tone="frost">
              <Vault size={13} />
              {chain.name}
            </span>
          )}
        </div>
        <span className="feed-go">
          Open room <ArrowRight size={15} />
        </span>
      </div>
    </Link>
  );
}
