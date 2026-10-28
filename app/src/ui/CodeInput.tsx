import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { ClipboardText } from "@phosphor-icons/react";
import { codeLength, formatCode } from "../lib/codes";

const allowed = /[0-9A-HJ-NP-Za-hj-np-z]/;

/** Strips what someone typed to code characters, reading look-alike letters as digits. */
export function cleanCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .split("")
    .filter((c) => allowed.test(c))
    .join("")
    .slice(0, codeLength);
}

/**
 * One field for a 16-character code, grouped in fours as it is typed. Sixteen ticks under it fill as characters arrive,
 * so it reads as segmented without fighting the caret, and paste works from anywhere.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  size = "lg",
  autoFocus,
  invalid,
  label = "Room code",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  size?: "lg" | "md";
  autoFocus?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  function set(raw: string) {
    const clean = cleanCode(raw);
    onChange(clean);
    if (clean.length === codeLength) onComplete?.(clean);
  }

  function paste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    set(e.clipboardData.getData("text"));
  }

  async function pasteButton() {
    try {
      set(await navigator.clipboard.readText());
      input.current?.focus();
    } catch {
      input.current?.focus();
    }
  }

  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && value.length === codeLength) onComplete?.(value);
  }

  return (
    <div className="code-input" data-size={size} data-invalid={invalid || undefined}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="code-input-box">
        <input
          ref={input}
          id={id}
          className="mono"
          value={formatCode(value)}
          onChange={(e) => set(e.target.value)}
          onPaste={paste}
          onKeyDown={key}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          maxLength={19}
        />
        <button type="button" className="btn sm ghost code-paste" onClick={pasteButton}>
          <ClipboardText size={16} />
          Paste
        </button>
      </div>
      <div className="code-ticks" aria-hidden="true">
        {Array.from({ length: codeLength }, (_, i) => (
          <i key={i} data-on={i < value.length} data-gap={i % 4 === 3 && i < codeLength - 1} />
        ))}
      </div>
    </div>
  );
}
