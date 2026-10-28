import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

/** A native dialog: a sheet from the bottom on phones, a centred panel on larger screens. */
export function Tray({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    const dialog = ref.current!;
    if (open) {
      setMounted(true);
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
    const timer = setTimeout(() => setMounted(false), 340);
    return () => clearTimeout(timer);
  }, [open]);

  function outside(event: MouseEvent<HTMLDialogElement>) {
    const box = ref.current!.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) onClose();
  }

  return (
    <dialog ref={ref} className="tray" aria-labelledby={titleId} onClose={onClose} onCancel={onClose} onClick={outside}>
      <div className="tray-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="tray-close" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {mounted && <div className="tray-body">{children}</div>}
    </dialog>
  );
}
