import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../lib/hooks";
import { formatZec } from "../lib/money";
import type { OpeningState } from "../lib/opening";
import { byArrival, voidText, type Opened } from "../lib/rules";
import type { RoomTerms, SealedBid } from "../lib/types";
import { Dust } from "./Dust";
import { Name } from "./Name";

/**
 * Every bid in the room. In a sealed room each row is a cloud of dust until the opening; then the rows clear in the order
 * the bids arrived, move into place, and the winning amounts turn gold. A candle sale's bids are open from the start,
 * ranked as they come in, and the opening only marks which counted.
 */
export function BidList({
  terms,
  arrived,
  state,
  mine,
  live,
  onSettled,
}: {
  terms: RoomTerms;
  arrived: SealedBid[];
  state: OpeningState;
  mine: Set<string>;
  /** A candle sale's bids, read before the opening. */
  live?: Map<string, Opened | null>;
  onSettled?: () => void;
}) {
  const reduce = usePrefersReducedMotion();
  const candle = terms.format === "candle";
  const arrival = [...arrived].sort(byArrival).map((b) => b.id);
  const opened = state.status === "opened";
  const standing = live
    ? [...arrival].sort((a, b) => {
        const x = live.get(a)?.amount ?? -1n;
        const y = live.get(b)?.amount ?? -1n;
        return x === y ? 0 : x > y ? -1 : 1;
      })
    : arrival;
  const final = opened ? state.outcome.bids.map((b) => b.id) : standing;
  const play = opened && state.live && !reduce;

  const [order, setOrder] = useState<string[]>(play ? standing : final);
  const [revealed, setRevealed] = useState(candle || (opened && !play) ? Infinity : 0);
  const [settled, setSettled] = useState(opened && !play);
  const [all, setAll] = useState(play);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const before = useRef<Map<string, number> | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  function measure() {
    before.current = new Map([...rows.current].map(([id, el]) => [id, el.getBoundingClientRect().top]));
  }

  useEffect(() => {
    if (!opened) {
      if (candle && order.join() !== standing.join()) measure();
      setOrder(standing);
      setRevealed(candle ? Infinity : 0);
      setSettled(false);
      return;
    }
    if (!play) {
      setOrder(final);
      setRevealed(Infinity);
      setSettled(true);
      settledRef.current?.();
      return;
    }
    const step = candle ? 0 : 70;
    const timers = candle ? [] : arrival.map((_, i) => setTimeout(() => setRevealed(i + 1), 250 + i * step));
    const reorderAt = 250 + arrival.length * step + 450;
    timers.push(
      setTimeout(() => {
        measure();
        setOrder(final);
      }, reorderAt),
      setTimeout(() => {
        setSettled(true);
        settledRef.current?.();
      }, reorderAt + 560),
    );
    return () => timers.forEach(clearTimeout);
    // The choreography runs once per change of state or of the bids, not on every render.
  }, [state.status, arrival.join(","), standing.join(",")]);

  useLayoutEffect(() => {
    const first = before.current;
    if (!first || reduce) return;
    before.current = null;
    rows.current.forEach((el, id) => {
      const dy = (first.get(id) ?? 0) - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    });
  }, [order]);

  const judged = opened ? new Map(state.outcome.bids.map((b) => [b.id, b])) : null;
  const winners = new Set(opened ? state.outcome.winners.map((w) => w.id) : []);
  const leader = !opened && live ? standing.find((id) => live.get(id)) : undefined;

  // In a sealed room two bidders can draw the same name. Number the repeats so the result can tell them apart.
  const label = new Map<string, string>();
  if (!candle && judged) {
    const seen = new Map<number, number>();
    for (const id of arrival) {
      const name = judged.get(id)?.name;
      if (name === null || name === undefined) continue;
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (n > 1) label.set(id, String(n));
    }
  }

  const cap = 8;
  const shown = (settled || !opened) && !all && order.length > cap ? order.slice(0, cap) : order;
  let place = 0;

  return (
    <>
      <ol className="bids" aria-label="Bids">
        {shown.map((id) => {
          const j = judged?.get(id);
          const read = j ? { amount: j.amount, name: j.name } : live?.get(id) ?? null;
          const isOpen = arrival.indexOf(id) < revealed && !!read;
          const counted = settled && j && !j.void;
          if (counted) place++;
          const you = mine.has(id);
          const note = settled && j?.void ? voidText[j.void] : !opened && id === leader ? "Leading" : "";
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) rows.current.set(id, el);
                else rows.current.delete(id);
              }}
              className="bid"
              data-open={isOpen ? "true" : "false"}
              data-win={settled && winners.has(id) ? "true" : undefined}
              data-void={settled && j?.void ? "true" : undefined}
            >
              <span className="bid-place">{counted ? place : ""}</span>
              <span className="bid-who">
                {isOpen ? (
                  <Name index={read?.name ?? null} size={18} suffix={[label.get(id), you ? "(you)" : ""].filter(Boolean).join(" ") || undefined} />
                ) : (
                  <span className="name">{you ? "Your bid" : "Sealed bid"}</span>
                )}
                {note && <span className="bid-note">{note}</span>}
              </span>
              <span className="bid-amount">
                {!candle && (
                  <span className="bid-sealed" role="img" aria-label="Sealed">
                    {(!opened || play) && <Dust cleared={isOpen} />}
                  </span>
                )}
                <span className="bid-open">{read ? (read.amount === null ? "Not opened" : `${formatZec(read.amount)} ZEC`) : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {shown.length < order.length && (
        <button type="button" className="button quiet show-all" onClick={() => setAll(true)}>
          Show all {order.length} bids
        </button>
      )}
    </>
  );
}
