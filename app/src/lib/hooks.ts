import { useEffect, useState } from "react";

/** The current time, refreshed on an interval and exactly at each moment in `marks`. */
export function useNow(interval: number, marks: number[] = []): number {
  const [now, setNow] = useState(() => Date.now());
  const key = marks.join(",");
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, interval);
    const timeouts = key
      .split(",")
      .filter(Boolean)
      .map((at) => Number(at) - Date.now())
      .filter((ms) => ms > 0 && ms < 2 ** 31 - 1)
      .map((ms) => setTimeout(tick, ms + 5));
    return () => {
      clearInterval(timer);
      timeouts.forEach(clearTimeout);
    };
  }, [interval, key]);
  return now;
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatch(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return match;
}

export const usePrefersReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/** A touch device with a narrow screen: the bidder's wallet is most likely on this same phone. */
export const useIsPhone = () => useMedia("(pointer: coarse) and (max-width: 820px)");

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
