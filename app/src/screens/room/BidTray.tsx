import { useEffect, useState, type FormEvent } from "react";
import { Check, Vault } from "@phosphor-icons/react";
import { ApiError } from "../../lib/api";
import { bidAdvice } from "../../lib/formats";
import { sleep, useIsPhone, usePrefersReducedMotion } from "../../lib/hooks";
import { formatZec, parseZec } from "../../lib/money";
import { sealBid, sendPreviewBid } from "../../lib/rooms";
import { onChain, payBid } from "../../lib/chainRoom";
import { fromBase64Url } from "../../lib/bytes";
import { secrets } from "../../lib/device";
import { current as currentWallet } from "../../lib/wallet";
import { momentInline } from "../../lib/time";
import type { MyBid, RoomTerms } from "../../lib/types";
import { Dust } from "../../ui/Dust";
import { Hash } from "../../ui/Hash";
import { Name } from "../../ui/Name";
import { Tray } from "../../ui/Tray";

/** Placing a bid: the amount, the moment it is sealed in this browser, and the confirmation that the room holds it. */
export function BidTray({ terms, open, onClose, name, leading, raising, onPlaced }: { terms: RoomTerms; open: boolean; onClose: () => void; name: number; leading: bigint | null; raising: boolean; onPlaced: (bid: MyBid) => void }) {
  const [placed, setPlaced] = useState<MyBid | null>(null);
  const candle = terms.format === "candle";

  useEffect(() => {
    if (open) {
      setPlaced(null);
      import("../../lib/seal");
    }
  }, [open]);

  const title = placed ? "Bid received" : candle ? (raising ? "Raise your bid" : "Place a bid") : "Place a sealed bid";
  return (
    <Tray open={open} onClose={onClose} title={title}>
      {placed ? (
        <Received terms={terms} bid={placed} onClose={onClose} />
      ) : (
        <Amount
          terms={terms}
          name={name}
          leading={leading}
          onPlaced={(b) => {
            setPlaced(b);
            onPlaced(b);
          }}
        />
      )}
    </Tray>
  );
}

function Amount({ terms, name, leading, onPlaced }: { terms: RoomTerms; name: number; leading: bigint | null; onPlaced: (bid: MyBid) => void }) {
  const phone = useIsPhone();
  const reduce = usePrefersReducedMotion();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sealing, setSealing] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const deposit = BigInt(terms.deposit);
  const candle = terms.format === "candle";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseZec(value);
    if (amount === null) return setError("Enter an amount, for example 21.50.");
    if (amount < deposit) return setError(`Bid at least the deposit, ${formatZec(deposit)} ZEC.`);
    if (candle && leading !== null && amount <= leading) return setError(`Bid more than the leading ${formatZec(leading)} ZEC.`);
    const chain = onChain(terms);
    const paddle = secrets.room(terms.id)?.paddle;
    if (chain && !currentWallet()) return setError("Make a wallet first. Open You in the menu, then come back to bid.");
    if (chain && !paddle) return setError("Take a paddle before bidding.");
    setError("");
    setBusy(true);
    if (!candle) setSealing(formatZec(amount));
    try {
      const [bid] = await Promise.all([sealBid(terms, amount, name), sleep(candle || reduce ? 0 : 1100)]);
      let txid: string | undefined;
      if (chain) {
        setPaying(true);
        txid = await payBid(terms, paddle!, fromBase64Url(bid.envelope));
      }
      // On the preview network the directory holds the bid. On a Zcash network it keeps a copy beside the chain, which the attesters read.
      await sendPreviewBid(terms, bid);
      onPlaced({ ...bid, paid: true, txid });
    } catch (e) {
      setPaying(false);
      setError(e instanceof ApiError ? e.message : chain ? `The deposit couldn't be paid. ${e instanceof Error ? e.message : ""}`.trim() : "Your bid couldn't be sealed. Try again.");
      setSealing(null);
      setBusy(false);
    }
  }

  if (sealing)
    return (
      <div className="sealing" role="status">
        <p className="sealing-amount">
          <span className="sealing-digits">{sealing}</span>
          <span className="amount-unit">ZEC</span>
          <Dust forming />
        </p>
        <p className="t-small center">{paying ? `Paying the ${formatZec(deposit)} ZEC deposit from your wallet, with the sealed bid as its memo…` : `Sealing to drand round ${terms.round.toLocaleString("en-US")} in this browser…`}</p>
      </div>
    );

  return (
    <form className="tray-form" onSubmit={submit} noValidate>
      <p className="t-small you-are">
        Bidding as <Name index={name} size={18} />
      </p>
      <div className="amount">
        <label className="field-label" htmlFor="bid-amount">
          Your bid
        </label>
        <div className="amount-row">
          <input id="bid-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" autoFocus={!phone} value={value} aria-invalid={!!error} onChange={(e) => setValue(e.target.value)} />
          <span className="amount-unit">ZEC</span>
        </div>
        <p className="t-small">{bidAdvice(terms, leading)}</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {terms.vault && (
        <p className="t-small vault-note">
          <Vault size={16} />
          Your bid also seals a fresh claim key. If you win, only that key can say where the lot goes, and it stays on this device.
        </p>
      )}
      <button type="submit" className="btn gold lg block" disabled={busy}>
        {candle ? (busy ? "Sending…" : "Place bid") : busy ? "Sealing…" : "Seal and send"}
      </button>
      <p className="t-small center">
        {candle ? `Each bid carries its own ${formatZec(deposit)} ZEC deposit. Every deposit but the winning one comes back.` : "Sealed in your browser. Nobody can open it before the room closes."}
      </p>
      <p className="t-micro center">{onChain(terms) ? `Local Zcash chain: your wallet pays the deposit to paddle ${secrets.room(terms.id)?.paddle ?? ""} with the sealed bid as the memo.` : "Preview network: the directory holds the sealed bid exactly as a Zcash memo would. No money moves."}</p>
    </form>
  );
}

function Received({ terms, bid, onClose }: { terms: RoomTerms; bid: MyBid; onClose: () => void }) {
  return (
    <>
      <p className="status" data-tone="done">
        <Check size={20} />
        Your {terms.format === "candle" ? "" : "sealed "}bid of {formatZec(BigInt(bid.amount))} ZEC is in the room.
      </p>
      <p className="t-small">
        {terms.format === "candle"
          ? "Everyone in the room can see it. If someone bids more, you can raise until the candle goes out."
          : `It stays sealed until the room closes ${momentInline(terms.closesAt)}. Nobody can see it until then, not even the host.`}
      </p>
      <div className="received-env">
        <span className="t-label">What the room holds</span>
        <Hash value={bid.envelope} keep={18} />
      </div>
      {bid.txid && (
        <div className="received-env">
          <span className="t-label">Deposit transaction</span>
          <Hash value={bid.txid} keep={12} />
        </div>
      )}
      <div className="tray-actions">
        <button type="button" className="btn gold lg block" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
