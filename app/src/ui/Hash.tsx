import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../lib/hooks";

const glyphs = "0123456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** Shortens a long id in the middle, so both ends stay checkable. */
export function middle(value: string, keep = 6): string {
  return value.length <= keep * 2 + 1 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/**
 * A real hash or address, shown in mono. It resolves out of scrambled glyphs when it first appears and on hover,
 * the one place the interface itself plays at decryption. A click copies the full value.
 */
export function Hash({ value, keep = 6, label, scramble = true, className }: { value: string; keep?: number; label?: string; scramble?: boolean; className?: string }) {
  const shown = keep > 0 ? middle(value, keep) : value;
  const [text, setText] = useState(shown);
  const [copied, setCopied] = useState(false);
  const reduce = usePrefersReducedMotion();
  const frame = useRef(0);

  function decrypt() {
    if (!scramble || reduce) return setText(shown);
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    const length = shown.length;
    const step = (t: number) => {
      const done = Math.floor(((t - start) / 520) * length);
      let out = "";
      for (let i = 0; i < length; i++) out += i < done || shown[i] === "…" ? shown[i] : glyphs[(Math.random() * glyphs.length) | 0];
      setText(out);
      if (done < length) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }

  useEffect(() => {
    decrypt();
    return () => cancelAnimationFrame(frame.current);
  }, [shown]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be refused; the value is still visible to select.
    }
  }

  return (
    <button type="button" className={`hash ${className ?? ""}`} data-copied={copied} onClick={copy} onMouseEnter={decrypt} title={value} aria-label={`${label ?? "Copy"} ${value}`}>
      {label && <span className="hash-label">{label}</span>}
      <span className="hash-text">{copied ? "Copied" : text}</span>
    </button>
  );
}
