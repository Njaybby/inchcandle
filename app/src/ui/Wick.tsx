import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "../lib/hooks";

/** The wick: a gold line as long as the time left, with the flame on top. It goes out when the room closes. */
export function Wick({ start, end, height = 72 }: { start: number; end: number; height?: number }) {
  const line = useRef<HTMLSpanElement>(null);
  const flame = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  const [out, setOut] = useState(() => Date.now() >= end);

  useEffect(() => {
    const total = Math.max(1, end - start);
    const left = () => Math.min(1, Math.max(0, (end - Date.now()) / total));
    const place = (f: number) => {
      line.current!.style.transform = `scaleY(${f})`;
      flame.current!.style.transform = `translateY(${(1 - f) * height}px)`;
    };
    const now = left();
    place(now);
    setOut(now <= 0);
    if (now <= 0) return;

    const remaining = end - Date.now();
    const animations: Animation[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    if (reduce) {
      timer = setInterval(() => place(left()), 60_000);
    } else {
      const options: KeyframeAnimationOptions = { duration: remaining, easing: "linear", fill: "forwards" };
      animations.push(
        line.current!.animate([{ transform: `scaleY(${now})` }, { transform: "scaleY(0)" }], options),
        flame.current!.animate([{ transform: `translateY(${(1 - now) * height}px)` }, { transform: `translateY(${height}px)` }], options),
      );
    }
    const done = remaining < 2 ** 31 - 1 ? setTimeout(() => setOut(true), remaining) : undefined;
    return () => {
      animations.forEach((a) => a.cancel());
      clearInterval(timer);
      clearTimeout(done);
    };
  }, [start, end, height, reduce]);

  return (
    <span className="wick" data-state={out ? "out" : "burning"} style={{ "--h": `${height}px` } as CSSProperties} aria-hidden="true">
      <span ref={line} className="wick-line" />
      <span ref={flame} className="wick-flame" />
    </span>
  );
}
