import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, Circle, Vault } from "@phosphor-icons/react";
import type { Address } from "viem";
import { api, usePoll } from "../lib/api";
import { useMobile } from "../lib/layout";
import { type Seen } from "../lib/rooms";
import { Link } from "../lib/router";
import { useRooms } from "../lib/useRooms";
import { chainByKey, chains, plannedChains } from "../lib/chains";
import { readVault, type VaultReading } from "../lib/vault";
import { Hash } from "../ui/Hash";
import { Seal } from "../ui/Seal";

function useReading(seen: Seen): VaultReading | null | undefined {
  const [reading, setReading] = useState<VaultReading | null | undefined>(undefined);
  const vault = seen.terms?.vault;
  useEffect(() => {
    if (!vault) return;
    const chain = chainByKey(vault.chain);
    if (!chain) return setReading(null);
    let live = true;
    const load = () =>
      readVault(chain, vault.address as Address)
        .then((r) => live && setReading(r))
        .catch(() => live && setReading(null));
    load();
    const t = setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [vault?.address]);
  return reading;
}

const stateText: Record<string, string> = { Held: "Holding the lot", Settled: "Settled, awaiting claim", Claimed: "Delivered", Returned: "Returned to seller", Empty: "Empty" };

function VaultRow({ seen, mobile }: { seen: Seen; mobile: boolean }) {
  const terms = seen.terms!;
  const vault = terms.vault!;
  const chain = chainByKey(vault.chain);
  const reading = useReading(seen);
  const status = usePoll(() => api.vault(terms.id), 8000);
  const sigs = status.data?.attestations.length ?? 0;
  const label = reading === undefined ? "Reading…" : reading === null ? "Not on chain" : stateText[reading.state];
  const tone = reading?.state === "Claimed" ? "gold" : reading?.state === "Settled" ? "ok" : "frost";
  if (mobile)
    return (
      <Link to={`/r/${terms.id}`} className="vault-card">
        <div className="vault-card-art">{terms.photo ? <img src={terms.photo.replace("-1200", "-600")} alt="" /> : <Seal seed={terms.id} />}</div>
        <div className="vault-card-body">
          <b>{terms.name}</b>
          <span className="t-small">{chain?.name}</span>
          <span className="chip" data-tone={tone}>
            {label}
          </span>
          <Hash value={vault.address} keep={6} scramble={false} />
        </div>
      </Link>
    );
  return (
    <Link to={`/r/${terms.id}`} className="vault-row">
      <span className="vault-row-art">{terms.photo ? <img src={terms.photo.replace("-1200", "-600")} alt="" /> : <Seal seed={terms.id} />}</span>
      <span className="vault-row-name">
        <b>{terms.name}</b>
        <span className="t-micro">{seen.role === "host" ? "You're the seller" : seen.role === "member" ? "You hold a paddle" : "Public room"}</span>
      </span>
      <span className="t-small">{chain?.name}</span>
      <Hash value={vault.address} keep={6} scramble={false} />
      <span className="chip" data-tone={tone}>
        {label}
      </span>
      <span className="vault-sigs" aria-label={`${sigs} of ${vault.threshold} signatures`}>
        {vault.attesters.map((a, i) => (i < sigs ? <CheckCircle key={a} size={15} weight="fill" className="ok" /> : <Circle key={a} size={15} className="faint" />))}
      </span>
      <ArrowRight size={16} className="faint" />
    </Link>
  );
}

export function Vaults() {
  const mobile = useMobile();
  const { all } = useRooms();
  useEffect(() => {
    document.title = "Vaults. Inchcandle";
  }, []);
  const mine = all.filter((s) => s.terms?.vault && s.role);
  const publicVaults = all.filter((s) => s.terms?.vault && !s.role);

  return (
    <div className={mobile ? "m-page" : "page"}>
      <header className="step-head">
        <h1 className="t-title">Vaults</h1>
        <p className="t-lead">A lot waits on its own chain, in a vault deployed just for its room. It leaves only on a 2 of 3 attested result, or back to the seller after their deadline.</p>
      </header>

      <section className="section">
        <div className="section-head">
          <h2>Yours</h2>
          <span className="t-small">Rooms on this device with a lot in a vault</span>
        </div>
        {mine.length ? (
          <div className={mobile ? "vault-cards" : "vault-table"}>
            {mine.map((s) => (
              <VaultRow key={s.room.id} seen={s} mobile={mobile} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h3>No vaults yet</h3>
            <p className="t-small">When you sell an NFT, a token allocation or a name, the lot goes into a vault as the room opens.</p>
            <Link to="/new" className="btn gold">
              <Vault size={16} />
              Create a room
            </Link>
          </div>
        )}
      </section>

      {publicVaults.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>On the floor</h2>
            <span className="t-small">Public rooms with a vault</span>
          </div>
          <div className={mobile ? "vault-cards" : "vault-table"}>
            {publicVaults.map((s) => (
              <VaultRow key={s.room.id} seen={s} mobile={mobile} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Factories</h2>
          <span className="t-small">One per chain. Every EVM chain runs the same two contracts.</span>
        </div>
        <div className="factory-grid">
          {chains
            .filter((c) => import.meta.env.DEV || c.key !== "anvil")
            .map((c) => (
              <div key={c.key} className="factory" data-live={!!c.factory}>
                <span className="factory-name">{c.name}</span>
                {c.factory ? <Hash value={c.factory} keep={6} /> : <span className="t-micro">{c.testnet ? "Deploys when a deployer key is funded" : "After the testnet rehearsal"}</span>}
                <span className="chip" data-tone={c.factory ? "ok" : undefined}>
                  {c.factory ? "Live" : "Not deployed"}
                </span>
              </div>
            ))}
          {plannedChains.map((c) => (
            <div key={c.key} className="factory">
              <span className="factory-name">{c.name}</span>
              <span className="t-micro">{c.note}</span>
              <span className="chip">Planned</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
