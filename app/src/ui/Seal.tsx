import { useMemo } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8 } from "../lib/bytes";

/**
 * A room's seal: a guilloché rosette drawn from the room's own hash, the way banknotes draw theirs from a lathe.
 * Every room gets a different one and the same room always gets the same one, so the seal doubles as a check
 * that an invitation and a room match. It stands in for a photo when a lot has none.
 */
export function Seal({ seed, tone = "gold", className }: { seed: string; tone?: "gold" | "frost"; className?: string }) {
  const rings = useMemo(() => {
    const h = sha256(utf8.encode(`inchcandle/seal/${seed}`));
    const out: { d: string; colour: string; width: number; opacity: number }[] = [];
    const count = 4 + (h[0] % 3);
    for (let r = 0; r < count; r++) {
      const b = (i: number) => h[(r * 5 + i) % 32];
      const petals = 5 + (b(1) % 9);
      const base = 22 + r * (62 / count) + (b(2) % 6);
      const depth = 4 + (b(3) % 10);
      const phase = (b(4) / 255) * Math.PI * 2;
      const wobble = 2 + (b(5) % 4);
      let d = "";
      for (let i = 0; i <= 360; i++) {
        const t = (i / 360) * Math.PI * 2;
        const radius = base + depth * Math.sin(petals * t + phase) + (depth / 3) * Math.sin(wobble * petals * t);
        const x = 100 + radius * Math.cos(t);
        const y = 100 + radius * Math.sin(t);
        d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      const gold = tone === "gold" && r % 2 === 0;
      out.push({ d: d + "Z", colour: gold ? "var(--gold)" : "var(--frost)", width: gold ? 0.9 : 0.6, opacity: gold ? 0.9 : 0.55 });
    }
    return out;
  }, [seed, tone]);

  return (
    <svg className={`seal ${className ?? ""}`} viewBox="0 0 200 200" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`g-${seed}`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="rgb(244 183 40 / 0.1)" />
          <stop offset="100%" stopColor="rgb(7 7 10 / 0)" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill={tone === "gold" ? `url(#g-${seed})` : "none"} />
      {rings.map((ring, i) => (
        <path key={i} d={ring.d} fill="none" stroke={ring.colour} strokeWidth={ring.width} opacity={ring.opacity} />
      ))}
      <circle cx="100" cy="100" r="2.4" fill={tone === "gold" ? "var(--gold)" : "var(--frost)"} />
    </svg>
  );
}

/** A small round mark drawn from a device id, so a device can recognise itself at a glance. */
export function DeviceMark({ id, size = 28 }: { id: string; size?: number }) {
  const cells = useMemo(() => {
    const h = sha256(utf8.encode(`inchcandle/device/${id}`));
    const out: boolean[] = [];
    for (let i = 0; i < 15; i++) out.push(((h[i >> 3] >> (i & 7)) & 1) === 1);
    return { cells: out, hue: h[4] % 2 === 0 ? "var(--gold)" : "var(--frost)" };
  }, [id]);
  return (
    <svg className="device-mark" width={size} height={size} viewBox="0 0 7 7" aria-hidden="true">
      <rect width="7" height="7" rx="3.5" fill="var(--ink-3)" />
      {cells.cells.map((on, i) => {
        if (!on) return null;
        const x = i % 3;
        const y = Math.floor(i / 3);
        return (
          <g key={i} fill={cells.hue}>
            <rect x={1 + x} y={1 + y} width="1" height="1" />
            {x < 2 && <rect x={5 - x} y={1 + y} width="1" height="1" />}
          </g>
        );
      })}
    </svg>
  );
}
