import { useEffect, useMemo, useState } from "react";
import { onChain, payBalance } from "../../lib/chainRoom";
import { ArrowSquareOut, Check, CircleNotch, Clock, PaperPlaneTilt, Vault, WarningCircle } from "@phosphor-icons/react";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { api, ApiError, usePoll } from "../../lib/api";
import type { Attester } from "../../lib/api-types";
import { secrets, useSecretsVersion } from "../../lib/device";
import { formatZec } from "../../lib/money";
import type { Outcome } from "../../lib/rules";
import { moment } from "../../lib/time";
import { toast } from "../../lib/toast";
import type { MyBid, RoomTerms } from "../../lib/types";
import { chainByKey } from "../../lib/chains";
import { connectWallet, explorerAddress, explorerTx, readVault, signClaim, vaultAbi, type VaultReading } from "../../lib/vault";
import { Hash } from "../../ui/Hash";

const assetLabel = (terms: RoomTerms) => {
  const a = terms.vault!.asset;
  if (a.standard === "erc721") return `NFT #${a.id}`;
  if (a.standard === "erc1155") return `${a.amount} of edition #${a.id}`;
  const units = Number(BigInt(a.amount) / 10n ** 12n) / 1e6;
  return `${units.toLocaleString("en-US")} ${a.standard === "native" ? (chainByKey(terms.vault!.chain)?.native ?? "coins") : "tokens"}`;
};

/** The lot's vault: where it is held, who can release it, and, for the winner, the claim. */
export function VaultPanel({ terms, outcome, myBids, host, committee }: { terms: RoomTerms; outcome: Outcome | null; myBids: MyBid[]; host: boolean; committee: Attester[] }) {
  useSecretsVersion();
  const vault = terms.vault!;
  const chain = chainByKey(vault.chain);
  const [reading, setReading] = useState<VaultReading | null | undefined>(undefined);
  const status = usePoll(() => api.vault(terms.id), 4000);
  const payments = usePoll(() => api.payments(terms.id).catch(() => []), 5000);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!chain) return;
    let live = true;
    readVault(chain, vault.address as Address)
      .then((r) => live && setReading(r))
      .catch(() => live && setReading(null));
    const t = setTimeout(() => setTick((x) => x + 1), 5000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [chain?.key, vault.address, tick, status.data?.settlement?.status, status.data?.claim?.status]);

  const winner = outcome?.winners[0];
  const mine = winner ? myBids.find((b) => b.id === winner.id) : undefined;
  const claimSecret = mine ? (secrets.claimKey(mine.id) as Hex | undefined) : undefined;
  const claimAddress = claimSecret ? privateKeyToAccount(claimSecret).address : undefined;
  const balance = outcome?.price !== null && outcome?.price !== undefined ? (outcome.price > BigInt(terms.deposit) ? outcome.price - BigInt(terms.deposit) : 0n) : 0n;
  const paid = !!claimAddress && (payments.data ?? []).some((p) => p.claimKey === claimAddress.toLowerCase() && BigInt(p.amount) >= balance);
  const signed = status.data?.attestations ?? [];
  const settleSigs = signed.filter((a) => a.body.kind === "settle");
  const names = useMemo(() => new Map(committee.map((a) => [a.address.toLowerCase(), a.name])), [committee]);

  return (
    <section className="panel vault-panel">
      <div className="panel-head">
        <Vault size={18} className="frost" />
        <h3>Vault</h3>
        <span className="spacer" />
        <span className="chip" data-tone={reading?.state === "Claimed" ? "gold" : reading?.state === "Settled" ? "ok" : "frost"}>
          {reading === undefined ? "Reading the chain…" : reading === null ? "Not found on chain" : reading.state === "Held" ? "Holding the lot" : reading.state === "Settled" ? "Settled, waiting for the claim" : reading.state === "Claimed" ? "Claimed" : reading.state}
        </span>
      </div>
      <div className="panel-body">
        <dl className="facts">
          <div className="fact">
            <dt>Chain</dt>
            <dd>{chain?.name ?? vault.chain}</dd>
          </div>
          <div className="fact">
            <dt>Vault</dt>
            <dd className="row">
              <Hash value={vault.address} keep={8} />
              {explorerAddress(chain, vault.address) && (
                <a href={explorerAddress(chain, vault.address)!} target="_blank" rel="noreferrer" className="icon-btn" aria-label="Open in explorer">
                  <ArrowSquareOut size={15} />
                </a>
              )}
            </dd>
          </div>
          <div className="fact">
            <dt>Holds</dt>
            <dd>{assetLabel(terms)}</dd>
          </div>
          <div className="fact">
            <dt>Release</dt>
            <dd>
              {vault.threshold} of {vault.attesters.length} attesters
            </dd>
          </div>
          <div className="fact">
            <dt>Seller's deadline</dt>
            <dd>{moment(vault.settleBy)}</dd>
          </div>
          {reading?.state === "Claimed" && (
            <div className="fact">
              <dt>Sent to</dt>
              <dd>
                <Hash value={reading.recipient} keep={8} />
              </dd>
            </div>
          )}
        </dl>

        <ol className="attest-list" aria-label="Attester signatures">
          {vault.attesters.map((a) => {
            const sig = signed.find((s) => s.attester.toLowerCase() === a.toLowerCase());
            return (
              <li key={a} data-signed={!!sig}>
                <span className="attest-dot">{sig ? <Check size={11} weight="bold" /> : ""}</span>
                <span>{names.get(a.toLowerCase()) ?? "Attester"}</span>
                <Hash value={a} keep={4} scramble={false} />
                <span className="t-micro">{sig ? (sig.body.kind === "settle" ? "Signed the result" : "Signed no sale") : outcome ? "Checking the result" : "Waits for the opening"}</span>
              </li>
            );
          })}
        </ol>

        {status.data?.settlement && (
          <p className="status" data-tone={status.data.settlement.status === "sent" ? "done" : status.data.settlement.status === "failed" ? "error" : undefined}>
            {status.data.settlement.status === "sent" ? <Check size={16} /> : status.data.settlement.status === "failed" ? <WarningCircle size={16} /> : <CircleNotch size={16} className="spin" />}
            {status.data.settlement.status === "sent" ? (status.data.settlement.kind === "nosale" ? "Relay returned the lot to the seller" : "Relay settled the vault on chain") : status.data.settlement.status === "failed" ? `Settlement failed: ${status.data.settlement.error}` : "Relay is sending the settlement"}
            {status.data.settlement.tx && <Hash value={status.data.settlement.tx} keep={6} scramble={false} />}
          </p>
        )}

        {mine && claimAddress && outcome && <Claim terms={terms} claimSecret={claimSecret!} claimAddress={claimAddress} balance={balance} paid={paid} reading={reading} claimStatus={status.data?.claim ?? null} sigs={settleSigs.length} onPaid={() => payments.reload()} />}

        {host && reading?.state === "Held" && Date.now() > vault.settleBy && <Reclaim terms={terms} />}
      </div>
    </section>
  );
}

function Claim({
  terms,
  claimSecret,
  claimAddress,
  balance,
  paid,
  reading,
  claimStatus,
  sigs,
  onPaid,
}: {
  terms: RoomTerms;
  claimSecret: Hex;
  claimAddress: Address;
  balance: bigint;
  paid: boolean;
  reading: VaultReading | null | undefined;
  claimStatus: { destination: string; status: string; tx: string | null; error: string | null } | null;
  sigs: number;
  onPaid: () => void;
}) {
  const vault = terms.vault!;
  const chain = chainByKey(vault.chain);
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settledToMe = reading?.state === "Settled" && reading.claimKey.toLowerCase() === claimAddress.toLowerCase();

  async function pay() {
    setBusy(true);
    try {
      if (onChain(terms)) {
        const paddle = secrets.room(terms.id)?.paddle;
        if (!paddle) throw new Error("This device holds no paddle in the room.");
        const txid = await payBalance(terms, paddle, balance);
        toast(`Balance paid on chain, transaction ${txid.slice(0, 12)}…`);
      }
      await api.pay(terms.id, { claimKey: claimAddress, amount: balance.toString() });
      onPaid();
      toast("Balance recorded. The attesters check it before they sign.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Couldn't record the payment.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) return setError("Enter an address on this chain, starting 0x.");
    setError("");
    setBusy(true);
    try {
      const signature = await signClaim(claimSecret, vault, destination as Address);
      await api.claim({ vault: vault.address, roomId: terms.id, destination, signature });
      toast("Claim signed. The relay is carrying it to the vault.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign the claim.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="claim">
      <h4 className="t-h3">You won this lot</h4>
      <ol className="claim-steps">
        <li data-state={balance === 0n || paid ? "done" : "now"}>
          <span className="task-dot">{balance === 0n || paid ? <Check size={11} weight="bold" /> : "1"}</span>
          <span>
            <b>{balance === 0n ? "Your deposit covers the price" : paid ? `Balance of ${formatZec(balance)} ZEC paid` : `Pay the balance, ${formatZec(balance)} ZEC`}</b>
            {balance > 0n && !paid && (
              <button type="button" className="btn gold sm" onClick={pay} disabled={busy}>
                {onChain(terms) ? "Pay from your wallet" : "Pay on the preview network"}
              </button>
            )}
          </span>
        </li>
        <li data-state={settledToMe || reading?.state === "Claimed" ? "done" : balance === 0n || paid ? "now" : "todo"}>
          <span className="task-dot">{settledToMe || reading?.state === "Claimed" ? <Check size={11} weight="bold" /> : "2"}</span>
          <span>
            <b>Attesters sign your claim key</b>
            <span className="t-micro">
              {sigs} {sigs === 1 ? "signature" : "signatures"}, {vault.threshold} needed. Your claim key <span className="mono">{claimAddress.slice(0, 10)}…</span> opened with your bid.
            </span>
          </span>
        </li>
        <li data-state={reading?.state === "Claimed" ? "done" : settledToMe ? "now" : "todo"}>
          <span className="task-dot">{reading?.state === "Claimed" ? <Check size={11} weight="bold" /> : "3"}</span>
          <span>
            <b>Name where the lot goes</b>
            <span className="t-micro">Any address on {chain?.name}. A fresh one keeps it unlinked from everything else you own.</span>
          </span>
        </li>
      </ol>
      {reading?.state === "Claimed" ? (
        <div className="delivered">
          <p className="status" data-tone="done">
            <Check size={16} />
            <span>
              Delivered to <span className="mono">{reading.recipient.slice(0, 10)}…{reading.recipient.slice(-6)}</span>
            </span>
          </p>
          {claimStatus?.tx && (explorerTx(chain, claimStatus.tx) ? <a className="t-small" href={explorerTx(chain, claimStatus.tx)!} target="_blank" rel="noreferrer">View the transaction</a> : <Hash value={claimStatus.tx} keep={10} scramble={false} label="Transaction" />)}
        </div>
      ) : claimStatus && claimStatus.status !== "failed" ? (
        <p className="status">
          <Clock size={16} />
          Claim on its way to <span className="mono">{claimStatus.destination.slice(0, 12)}…</span>
        </p>
      ) : (
        settledToMe && (
          <div className="claim-form">
            <input className="input mono" value={destination} onChange={(e) => setDestination(e.target.value.trim())} placeholder="0x… destination" spellCheck={false} aria-label="Destination address" aria-invalid={!!error} />
            <button type="button" className="btn gold" onClick={claim} disabled={busy}>
              <PaperPlaneTilt size={16} />
              Send the lot here
            </button>
            {error && <p className="field-error">{error}</p>}
            {claimStatus?.status === "failed" && <p className="field-error">The last claim failed: {claimStatus.error}</p>}
            <p className="t-micro">You sign with the claim key in this browser. The relay pays the gas; it can't change where the lot goes.</p>
          </div>
        )
      )}
    </div>
  );
}

function Reclaim({ terms }: { terms: RoomTerms }) {
  const [busy, setBusy] = useState(false);
  async function reclaim() {
    const chain = chainByKey(terms.vault!.chain)!;
    setBusy(true);
    try {
      const wallet = await connectWallet(chain);
      await wallet.write({ address: terms.vault!.address as Address, abi: vaultAbi, functionName: "reclaim" });
      toast("The lot is back in your wallet.");
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 140) : "Couldn't reclaim.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="btn block" onClick={reclaim} disabled={busy}>
      Nobody settled in time. Take the lot back
    </button>
  );
}
