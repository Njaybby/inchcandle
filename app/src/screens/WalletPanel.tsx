import { useEffect, useState } from "react";
import { ArrowsClockwise, Drop, Signature, Trash, Wallet } from "@phosphor-icons/react";
import { useSecretsVersion } from "../lib/device";
import { formatZec } from "../lib/money";
import { toast } from "../lib/toast";
import * as w from "../lib/wallet";
import { Hash } from "../ui/Hash";

/** This visitor's own wallet: made here, or recovered from a signature, and spent only from this browser. */
export function WalletPanel() {
  useSecretsVersion();
  const version = w.useWalletVersion();
  const wallet = w.current();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<w.Balances | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const local = w.zcashNetwork === "regtest";

  useEffect(() => {
    setAddress(null);
    setBalance(null);
    if (!wallet) return;
    let live = true;
    w.address().then((a) => live && setAddress(a), () => {});
    w.balances().then((b) => live && setBalance(b), () => {});
    return () => {
      live = false;
    };
  }, [wallet?.seed, version]);

  async function run(label: string, work: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try {
      await work();
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (!wallet)
    return (
      <section className="panel wallet-panel">
        <div className="panel-head">
          <h2>Your wallet</h2>
        </div>
        <div className="panel-body">
          <p className="t-small">One wallet for this site. It pays your bid deposits from a shielded address and holds an address on EVM chains for lots. The keys stay in this browser.</p>
          <div className="row">
            <button type="button" className="btn gold" disabled={!!busy} onClick={() => run("make", w.create, "Wallet made. It lives in this browser.")}>
              <Wallet size={16} />
              {busy === "make" ? "Making…" : "Make a wallet"}
            </button>
            <button type="button" className="btn" disabled={!!busy} onClick={() => run("sign", w.signIn, "Wallet recovered from your signature.")}>
              <Signature size={16} />
              {busy === "sign" ? "Waiting for your signature…" : "Recover with a browser wallet"}
            </button>
          </div>
          <p className="t-micro">Recovering signs one fixed message. The same browser wallet always gets the same Inchcandle wallet back, on any device. Signing sends nothing.</p>
        </div>
      </section>
    );

  const evm = w.evmAccount();
  return (
    <section className="panel wallet-panel">
      <div className="panel-head">
        <h2>Your wallet</h2>
        <span className="spacer" />
        <span className="chip">{wallet.source === "signed" ? "Recovered from a signature" : "Made in this browser"}</span>
      </div>
      <div className="panel-body">
        <dl className="facts">
          <div className="fact">
            <dt>Shielded address</dt>
            <dd>{address ? <Hash value={address} keep={10} /> : <span className="t-small">Starting the light client…</span>}</dd>
          </div>
          <div className="fact">
            <dt>Balance</dt>
            <dd className="wallet-balance">
              {balance ? (
                <>
                  <b>{formatZec(balance.spendable)} ZEC</b>
                  {balance.pending > 0n && <span className="t-small"> and {formatZec(balance.pending)} ZEC confirming</span>}
                </>
              ) : (
                <span className="t-small">Scanning…</span>
              )}
            </dd>
          </div>
          {evm && (
            <div className="fact">
              <dt>EVM address</dt>
              <dd>
                <Hash value={evm.address} keep={8} />
              </dd>
            </div>
          )}
          <div className="fact">
            <dt>Network</dt>
            <dd>{local ? "Local Zcash chain (regtest)" : w.zcashNetwork === "test" ? "Zcash testnet" : "Zcash mainnet"}</dd>
          </div>
        </dl>
        <div className="row">
          {local && import.meta.env.DEV && (
            <button type="button" className="btn gold" disabled={!!busy || !address} onClick={() => run("faucet", w.faucet, `Sent ${formatZec(w.faucetAmount)} test ZEC. It is mined in.`)}>
              <Drop size={16} />
              {busy === "faucet" ? "Sending…" : `Get ${formatZec(w.faucetAmount)} test ZEC`}
            </button>
          )}
          <button type="button" className="btn" disabled={!!busy} onClick={() => run("sync", async () => setBalance(await w.balances()))}>
            <ArrowsClockwise size={16} />
            {busy === "sync" ? "Scanning…" : "Refresh"}
          </button>
          <button type="button" className="btn quiet" disabled={!!busy} onClick={() => run("forget", w.forget, "Wallet forgotten on this device.")}>
            <Trash size={16} />
            Forget
          </button>
        </div>
        {wallet.source === "fresh" && <p className="t-micro">This wallet exists only in this browser. Forgetting it, or clearing site data, loses what it holds.</p>}
      </div>
    </section>
  );
}
