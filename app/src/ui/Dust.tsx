import { useEffect, useRef } from "react";

// Sealing dust: a fine cloud in the text colour that sits where a sealed amount would be, the texture people know from hidden messages.
// One animation frame loop serves every cloud on the page. A cloud only joins it while it is on screen and the tab is visible.
// Under reduced motion each cloud is drawn once and left still.

interface Cloud {
  draw(t: number): boolean;
}

const running = new Set<Cloud>();
let frame = 0;

function loop(t: number) {
  running.forEach((cloud) => {
    if (!cloud.draw(t)) running.delete(cloud);
  });
  frame = running.size && !document.hidden ? requestAnimationFrame(loop) : 0;
}

function start(cloud: Cloud) {
  running.add(cloud);
  if (!frame && !document.hidden) frame = requestAnimationFrame(loop);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && running.size && !frame) frame = requestAnimationFrame(loop);
  });
}

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * `forming` fades the cloud in, for the moment a bid is sealed. `cleared` blows it away, for the moment a bid opens.
 * The cloud fills its parent, which must be positioned.
 */
export function Dust({ forming = false, cleared = false }: { forming?: boolean; cleared?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clearedAt = useRef<number | null>(null);
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (cleared && clearedAt.current === null) {
      clearedAt.current = performance.now();
      kick.current();
    }
  }, [cleared]);

  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const still = reduced();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let colour = "#a3a19c";
    let dots: { x: number; y: number; vx: number; vy: number; phase: number; rate: number }[] = [];
    let visible = false;
    let soft = 4;
    const born = performance.now();

    function seed() {
      const box = el.getBoundingClientRect();
      w = box.width;
      h = box.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      colour = getComputedStyle(el).color;
      soft = Math.max(2, Math.min(w, h) * 0.3);
      const count = Math.round((w * h) / 7);
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 7,
        vy: (Math.random() - 0.5) * 5,
        phase: Math.random() * Math.PI * 2,
        rate: 1.2 + Math.random() * 2.4,
      }));
    }

    let last = performance.now();
    const cloud: Cloud = {
      draw(t) {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        const gone = clearedAt.current === null ? 0 : still ? 1 : Math.min(1, (t - clearedAt.current) / 480);
        const ramp = forming && !still ? Math.min(1, (t - born) / 700) : 1;
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.clearRect(0, 0, w, h);
        ctx!.fillStyle = colour;
        for (const d of dots) {
          if (!still) {
            d.x += d.vx * dt * (1 + gone * 14);
            d.y += d.vy * dt * (1 + gone * 14);
            if (!gone) {
              if (d.x < 0) d.x += w;
              if (d.x > w) d.x -= w;
              if (d.y < 0) d.y += h;
              if (d.y > h) d.y -= h;
            }
          }
          const twinkle = still ? 0.6 : 0.5 + 0.5 * Math.sin(d.phase + (t / 1000) * d.rate);
          // Thin out towards the edges, so the cloud has no hard rectangle around it.
          const edge = Math.min(d.x, w - d.x, d.y, h - d.y) / soft;
          const fade = edge >= 1 ? 1 : edge <= 0 ? 0 : edge;
          ctx!.globalAlpha = (0.16 + 0.6 * twinkle) * fade * ramp * (1 - gone);
          ctx!.fillRect(d.x, d.y, 1.1, 1.1);
        }
        return !still && gone < 1 && visible;
      },
    };
    kick.current = () => {
      if (still) cloud.draw(performance.now());
      else if (visible) start(cloud);
    };

    seed();
    cloud.draw(performance.now());
    const resize = new ResizeObserver(() => {
      seed();
      cloud.draw(performance.now());
    });
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !still) {
        last = performance.now();
        start(cloud);
      }
    });
    seen.observe(el);
    return () => {
      resize.disconnect();
      seen.disconnect();
      running.delete(cloud);
    };
  }, [forming]);

  return <canvas ref={canvas} className="dust" aria-hidden="true" />;
}
