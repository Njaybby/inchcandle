import { useMemo, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useIsPhone } from "../lib/hooks";
import { bidCardImage, saveFile } from "../lib/files";
import { makeQr, qrPath, quietZone } from "../lib/qr";

/** A payment request as a QR code, dark on paper, with what it pays under it. */
export function BidCard({ uri, title, note, fileName }: { uri: string; title: string; note: string; fileName: string }) {
  const phone = useIsPhone();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const code = useMemo(() => makeQr(uri), [uri]);
  const side = code.size + quietZone * 2;

  async function save() {
    setSaving(true);
    try {
      const result = await saveFile(await bidCardImage(uri, title, note), fileName);
      if (result === "shared") setSaved("Saved. In Zodl, tap Scan, then the photo button and pick the card.");
      if (result === "downloaded") setSaved("Saved to your downloads. On a phone, add it to Photos so Zodl can find it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bid-flow-card">
      <div className="bid-card">
        <svg className="qr" viewBox={`0 0 ${side} ${side}`} role="img" aria-label="Payment request for your wallet">
          <rect width={side} height={side} fill="#f5f5f4" />
          <path d={qrPath(code)} fill="#0b0b0c" />
        </svg>
        <div className="bid-card-text">
          <span className="bid-card-title">Scan with Zodl</span>
          <span className="bid-card-note">{note}</span>
        </div>
      </div>
      {phone ? (
        <>
          <button type="button" className="button block" onClick={save} disabled={saving}>
            <DownloadSimple size={20} />
            Save bid card
          </button>
          <p className="small">{saved ?? "Save the card to Photos. Then in Zodl, tap Scan and the photo button."}</p>
        </>
      ) : (
        <p className="small">Open Zodl on your phone, tap Scan and point it at the code.</p>
      )}
    </div>
  );
}
