import { useEffect, useRef } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, toBase64Url } from "../lib/bytes";
import { useLive } from "../lib/live";

// The hero's field: lanes of ciphertext running at -18 degrees.
// Every character comes from the live drand beacon: its BLS signature, and hashes chained from it.
// Each time a new round verifies in this browser, a gold band sweeps along the lanes and the characters inside it resolve into
// what sealed bids open into: room names, round numbers, the words of an opening. Behind it they freeze back into frost.
// One canvas, one glyph atlas, drawImage only. It pauses off screen and in background tabs, and holds one still frame under reduced motion.

const angle = (-18 * Math.PI) / 180;
const cipherSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const plainSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:#";
const charset = Array.from(new Set(cipherSet + plainSet)).join("");
const tints = ["#9cc8ff", "#f3f1ec", "#f4b728", "#ffd978"];

interface Lane {
  y: number;
  speed: number;
  offset: number;
  cipher: string;
  plain: string;
  phase: number;
}

export interface FieldProps {
  /** Plain words the sweep can resolve into, besides the live round. */
  words: string[];
  /** Where the text sits: a quiet zone on the left for desktop, an even field for phones. */
  quiet?: "left" | "none";
  fontSize?: number;
  lineGap?: number;
}

function poolFrom(signature: string | null, seed: string): string {
  let bytes = signature ? hexToBytes(signature) : sha256(new TextEncoder().encode(seed));
  let out = "";
  for (let i = 0; i < 24; i++) {
    bytes = sha256(bytes);
    out += toBase64Url(bytes);
  }
  return out;
}

export function CipherField({ words, quiet = "left", fontSize = 12.5, lineGap = 19 }: FieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useLive();
  const sweep = useRef<{ start: number; dur: number } | null>(null);
  const signature = useRef<string | null>(null);
  const round = useRef<number | null>(null);
  const reseed = useRef<() => void>(() => {});
  const wordsRef = useRef(words);
  wordsRef.current = words;

  // A newly verified round sweeps the field. The round is real, so the motion is the proof that it was checked.
  useEffect(() => {
    if (live.status !== "verified") return;
    signature.current = live.signature;
    round.current = live.round;
    reseed.current();
    sweep.current = { start: performance.now(), dur: 1700 };
  }, [live.status === "verified" ? live.round : 0]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d", { alpha: true });
    if (!ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const font = `500 ${fontSize}px "JetBrains Mono Variable", ui-monospace, monospace`;
    let cw = 0;
    let ch = 0;
    let atlas: HTMLCanvasElement | null = null;
    let lanes: Lane[] = [];
    let W = 0;
    let H = 0;
    let D = 0;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    const pointer = { x: 0, y: 0, on: false };
    const index = new Map<string, number>();

    function buildAtlas() {
      const probe = document.createElement("canvas").getContext("2d")!;
      probe.font = font;
      cw = Math.ceil(probe.measureText("M").width + 1.2);
      ch = Math.ceil(fontSize * 1.3);
      atlas = document.createElement("canvas");
      atlas.width = Math.ceil(cw * dpr) * charset.length;
      atlas.height = Math.ceil(ch * dpr) * tints.length;
      const a = atlas.getContext("2d")!;
      a.scale(dpr, dpr);
      a.font = font;
      a.textBaseline = "middle";
      a.textAlign = "center";
      tints.forEach((tint, row) => {
        a.fillStyle = tint;
        for (let i = 0; i < charset.length; i++) a.fillText(charset[i], (Math.ceil(cw * dpr) / dpr) * i + cw / 2, (Math.ceil(ch * dpr) / dpr) * row + ch / 2);
      });
      charset.split("").forEach((c, i) => index.set(c, i));
    }

    function plainFor(i: number): string {
      const list = wordsRef.current.length ? wordsRef.current : ["SEALED", "OPENED"];
      const r = round.current;
      const pick = list[(i * 7 + 3) % list.length];
      const parts = [pick.toUpperCase(), r ? `ROUND ${r.toLocaleString("en-US")}` : "SEALED", "VERIFIED", list[(i * 3 + 1) % list.length].toUpperCase(), "OPENED"];
      return parts.join("   ") + "   ";
    }

    function seedLanes() {
      const pool = poolFrom(signature.current, String(W));
      const count = Math.ceil(D / lineGap) + 2;
      lanes = Array.from({ length: count }, (_, i) => {
        const start = (i * 37) % (pool.length - 200);
        return {
          y: -D / 2 + i * lineGap,
          speed: 6 + ((i * 53) % 29),
          offset: (i * 131) % 400,
          cipher: pool.slice(start) + pool.slice(0, start),
          plain: plainFor(i),
          phase: (i * 0.73) % (Math.PI * 2),
        };
      });
    }

    reseed.current = () => {
      if (!lanes.length) return;
      const pool = poolFrom(signature.current, String(W));
      lanes.forEach((lane, i) => {
        const start = (i * 37) % (pool.length - 200);
        lane.cipher = pool.slice(start) + pool.slice(0, start);
        lane.plain = plainFor(i);
      });
    };

    function resize() {
      const box = el.getBoundingClientRect();
      W = box.width;
      H = box.height;
      D = Math.hypot(W, H) + 40;
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
      seedLanes();
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

    function draw(t: number) {
      if (!atlas) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, el.width, el.height);
      ctx!.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, (dpr * W) / 2, (dpr * H) / 2);

      // Where the sweep is along the lanes, in the rotated frame.
      let s = Infinity;
      const band = Math.max(60, W * 0.06);
      if (sweep.current) {
        const k = (t - sweep.current.start) / sweep.current.dur;
        if (k >= 1.6) sweep.current = null;
        else s = -D / 2 - band + ease(Math.min(1, Math.max(0, k))) * (D + band * 2);
      }
      if (still) s = D * 0.08;
      const sweeping = s !== Infinity;
      const trail = band * 3.2;

      // The pointer, in the rotated frame, lights a small lens.
      const px = (pointer.x - W / 2) * cos + (pointer.y - H / 2) * sin;
      const py = -(pointer.x - W / 2) * sin + (pointer.y - H / 2) * cos;
      const lens = 110;

      const scw = Math.ceil(cw * dpr);
      const sch = Math.ceil(ch * dpr);
      const tsec = t / 1000;

      for (let li = 0; li < lanes.length; li++) {
        const lane = lanes[li];
        if (!still) lane.offset += lane.speed * dt;
        const y = lane.y;
        const total = lane.cipher.length * cw;
        const shift = lane.offset % cw;
        const first = Math.floor(lane.offset / cw);
        const n = Math.ceil(D / cw) + 1;
        for (let k = 0; k < n; k++) {
          const x = -D / 2 + k * cw + shift;
          const sx = W / 2 + x * cos - y * sin;
          const sy = H / 2 + x * sin + y * cos;
          if (sx < -cw || sx > W + cw || sy < -ch || sy > H + ch) continue;
          const ci = (((first - k) % lane.cipher.length) + lane.cipher.length) % lane.cipher.length;

          let alpha = 0.07 + 0.2 * (0.5 + 0.5 * Math.sin(lane.phase + tsec * (0.6 + (ci % 7) * 0.18) + ci));
          if (quiet === "left") alpha *= 0.18 + 0.82 * Math.min(1, Math.max(0, (sx - W * 0.2) / (W * 0.45)));
          else alpha *= 0.55 + 0.45 * Math.min(1, sy / (H * 0.6));

          let tint = 0;
          let glyph = lane.cipher[ci];
          let heat = 0;
          if (sweeping) {
            const d = x - s;
            if (d > -band && d < band) heat = 1 - Math.abs(d) / band;
            else if (d <= -band && d > -band - trail) heat = -(1 - (-band - d) / trail);
          }
          if (pointer.on) {
            const dl = Math.hypot(x - px, y - py);
            if (dl < lens) heat = Math.max(heat, (1 - dl / lens) * 0.85);
          }
          if (heat > 0.18) {
            glyph = lane.plain[(((first - k) % lane.plain.length) + lane.plain.length) % lane.plain.length];
            tint = heat > 0.62 ? 3 : 2;
            alpha = Math.max(alpha, 0.35 + heat * 0.65);
          } else if (heat > 0) {
            tint = 1;
            alpha = Math.max(alpha, heat * 0.55);
          } else if (heat < 0) {
            // Just behind the band the opened text cools back to frost.
            tint = 2;
            alpha = Math.max(alpha, -heat * 0.5);
          }
          if (alpha < 0.025 || glyph === " ") continue;
          const gi = index.get(glyph);
          if (gi === undefined) continue;
          ctx!.globalAlpha = alpha;
          ctx!.drawImage(atlas, gi * scw, tint * sch, scw, sch, x, y - ch / 2, cw, ch);
        }
        void total;
      }
      ctx!.globalAlpha = 1;
    }

    function loop(t: number) {
      draw(t);
      raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    }

    function wake() {
      if (!raf && visible && !document.hidden && !still) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    }

    let disposed = false;
    document.fonts.load(font).finally(() => {
      if (disposed) return;
      buildAtlas();
      resize();
      if (still) draw(performance.now());
      else wake();
    });

    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(performance.now());
    });
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    io.observe(el);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    const host = el.parentElement!;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const box = el.getBoundingClientRect();
      pointer.x = e.clientX - box.left;
      pointer.y = e.clientY - box.top;
      pointer.on = true;
    };
    const leave = () => (pointer.on = false);
    const tap = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      sweep.current = { start: performance.now(), dur: 1500 };
      wake();
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("pointerdown", tap);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", tap);
    };
  }, [quiet, fontSize, lineGap]);

  return <canvas ref={canvas} className="cipher-field" aria-hidden="true" />;
}
