import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  At,
  Bank,
  Check,
  CircleNotch,
  Coins,
  Cube,
  Eye,
  EyeSlash,
  FileLock,
  Globe,
  ImageSquare,
  LockSimple,
  Package,
  Stack,
  Tag,
  Vault,
  Wallet as WalletIcon,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Address } from "viem";
import { api, usePoll } from "../lib/api";
import type { Attester, Listing, Network } from "../lib/api-types";
import { formatChoice, formatOrder } from "../lib/formats";
import { useNow } from "../lib/hooks";
import { useMobile } from "../lib/layout";
import { formatZec, parseZec, zec } from "../lib/money";
import { newId } from "../lib/ids";
import { createRoom, fingerprint, openingRound } from "../lib/rooms";
import { navigate } from "../lib/router";
import { roundTime } from "../lib/rounds";
import { moment, spell } from "../lib/time";
import { toast } from "../lib/toast";
import type { Format, LotKind, RoomTerms, VaultRef } from "../lib/types";
import { chains, plannedChains } from "../lib/chains";
import {
  connectWallet,
  erc1155Abi,
  erc20Abi,
  erc721Abi,
  factoryAbi,
  publicClient,
  roomIdBytes,
  standards,
  type Chain,
  type Wallet,
} from "../lib/vault";
import { Hash } from "../ui/Hash";
import { ConcealedTicket, RoomTicket } from "../ui/Ticket";

const kinds: { kind: LotKind; icon: ReactNode; title: string; note: string; vault: boolean }[] = [
  { kind: "nft", icon: <Cube size={19} />, title: "NFT", note: "Art, editions, game items. Christie's and Nouns sell these on chain.", vault: true },
  { kind: "token", icon: <Coins size={19} />, title: "Token allocation", note: "A block of tokens. Zama's sale took $118M in sealed bids.", vault: true },
  { kind: "name", icon: <At size={19} />, title: "Name", note: "ENS, Basenames and other names held as NFTs.", vault: true },
  { kind: "collateral", icon: <Bank size={19} />, title: "Collateral", note: "A liquidated position, sold without bots seeing the bids.", vault: true },
  { kind: "physical", icon: <Package size={19} />, title: "Physical item", note: "Shipping details reach only you, inside the winner's memo.", vault: false },
  { kind: "file", icon: <FileLock size={19} />, title: "Digital file", note: "Stored encrypted. The key goes to the winner.", vault: false },
  { kind: "other", icon: <Tag size={19} />, title: "Something else", note: "A slot, a right, a dinner. You deliver it yourself.", vault: false },
];

const examples = [
  { path: "/example/rousseau-watch-1200.jpg", label: "Rock-crystal watch", credit: "Photo: The Metropolitan Museum of Art. Public domain." },
  { path: "/example/greek-ring-1200.jpg", label: "Gold ring", credit: "Photo: The Metropolitan Museum of Art. Public domain." },
  { path: "/example/hokusai-wave-1200.jpg", label: "The Great Wave", credit: "Photo: The Metropolitan Museum of Art. Public domain." },
  { path: "/example/dreyer-ship-1200.jpg", label: "Silver-gilt ship", credit: "Photo: The Metropolitan Museum of Art. Public domain." },
];

type Closes = "2m" | "10m" | "1h" | "1d" | "3d";
const closeChoices: { key: Closes; label: string; ms: number; dev?: boolean }[] = [
  { key: "2m", label: "2 minutes", ms: 2 * 60_000, dev: true },
  { key: "10m", label: "10 minutes", ms: 10 * 60_000, dev: true },
  { key: "1h", label: "1 hour", ms: 60 * 60_000 },
  { key: "1d", label: "1 day", ms: 24 * 60 * 60_000 },
  { key: "3d", label: "3 days", ms: 3 * 24 * 60 * 60_000 },
];

interface Draft {
  kind: LotKind;
  name: string;
  line: string;
  about: string;
  photo: string | null;
  credit?: string;
  chain: string;
  standard: keyof typeof standards;
  token: string;
  tokenId: string;
  amount: string;
  format: Format;
  units: number;
  closes: Closes;
  deposit: string;
  reserve: string;
  listing: Listing;
  paddles: number;
  network: Network;
}

const fresh: Draft = {
  kind: "nft",
  name: "",
  line: "",
  about: "",
  photo: null,
  chain: "anvil",
  standard: "erc721",
  token: "",
  tokenId: "",
  amount: "1",
  format: "second",
  units: 2,
  closes: import.meta.env.DEV ? "10m" : "1d",
  deposit: "0.5",
  reserve: "",
  listing: "private",
  paddles: 12,
  network: "preview",
};

type StepKey = "lot" | "vault" | "rules" | "access" | "review";
const stepNames: Record<StepKey, string> = { lot: "Lot", vault: "Vault", rules: "Rules", access: "Access", review: "Review" };

const usesVault = (d: Draft) => kinds.find((k) => k.kind === d.kind)!.vault;

function problems(d: Draft, step: StepKey): string[] {
  const out: string[] = [];
  if (step === "lot") {
    if (d.name.trim().length < 3) out.push("Give the lot a name of at least three characters.");
  }
  if (step === "vault" && usesVault(d)) {
    const chain = chains.find((c) => c.key === d.chain);
    if (!chain?.factory) out.push("Pick a chain where the vault factory is deployed.");
    if (d.standard !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(d.token)) out.push("Enter the token's contract address.");
    if ((d.standard === "erc721" || d.standard === "erc1155") && !/^\d+$/.test(d.tokenId)) out.push("Enter the token id.");
    if (d.standard !== "erc721" && !(Number(d.amount) > 0)) out.push("Enter an amount above zero.");
  }
  if (step === "rules") {
    if (parseZec(d.deposit) === null) out.push("Enter a deposit, for example 0.5.");
    if (d.reserve && parseZec(d.reserve) === null) out.push("The reserve isn't an amount.");
    if (usesVault(d) && d.format === "several") out.push("A vault holds one lot, so it needs a single winner. Pick another sale type.");
  }
  if (step === "access") {
    if (!(d.paddles >= 1 && d.paddles <= 200)) out.push("Between 1 and 200 paddles.");
  }
  return out;
}

/** Builds the terms the preview shows, from the draft as it stands. */
function previewTerms(d: Draft, id: string, now: number, vault?: VaultRef): RoomTerms {
  const ms = closeChoices.find((c) => c.key === d.closes)!.ms;
  const closesAt = now + ms;
  return {
    v: 1,
    id,
    name: d.name.trim() || "Your lot",
    line: d.line,
    closesAt,
    round: openingRound(closesAt),
    deposit: (parseZec(d.deposit) ?? zec(0.5)).toString(),
    format: d.format,
    access: d.listing === "public" ? "link" : "invite",
    after: "private",
    photo: d.photo ?? undefined,
    createdAt: now,
    listing: d.listing,
    network: d.network,
    paddles: d.paddles,
    lot: { kind: d.kind },
    vault,
  };
}

function draftVault(d: Draft, committee: Attester[]): VaultRef | undefined {
  if (!usesVault(d)) return undefined;
  const chain = chains.find((c) => c.key === d.chain);
  if (!chain?.factory) return undefined;
  return {
    chain: chain.key,
    chainId: chain.id,
    factory: chain.factory,
    address: "0x0000000000000000000000000000000000000000",
    asset: { standard: d.standard, token: d.token || "0x0000000000000000000000000000000000000000", id: d.tokenId || "0", amount: d.standard === "erc721" ? "1" : d.amount || "0" },
    attesters: committee.map((a) => a.address),
    threshold: Math.min(2, committee.length),
    settleBy: 0,
  };
}

type Task = { label: string; state: "todo" | "doing" | "done" | "error"; detail?: string };

export function Create() {
  const mobile = useMobile();
  const [d, setD] = useState<Draft>(fresh);
  const [step, setStep] = useState<StepKey>("lot");
  const [tried, setTried] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [roomId] = useState(() => newId());
  const committee = usePoll(() => api.attesters(), 0).data ?? [];
  const now = useNow(30_000);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    document.title = "Create a room. Inchcandle";
  }, []);

  const order: StepKey[] = usesVault(d) ? ["lot", "vault", "rules", "access", "review"] : ["lot", "rules", "access", "review"];
  const index = order.indexOf(step);
  const issues = problems(d, step);

  function next() {
    setTried(true);
    if (issues.length) return;
    setTried(false);
    setStep(order[Math.min(order.length - 1, index + 1)]);
    window.scrollTo({ top: 0 });
  }

  function back() {
    setTried(false);
    if (index === 0) return navigate("/");
    setStep(order[index - 1]);
  }

  async function open() {
    const run: Task[] = [
      { label: "Seal the reserve to the opening round", state: "todo" },
      ...(usesVault(d) ? [{ label: "Approve the lot for the vault factory", state: "todo" as const }, { label: "Deposit the lot into its vault", state: "todo" as const }] : []),
      ...(d.listing !== "public" ? [{ label: `Make ${d.paddles} codes in this browser`, state: "todo" as const }] : []),
      { label: "Publish to the directory", state: "todo" },
    ];
    setTasks(run);
    const mark = (i: number, state: Task["state"], detail?: string) => setTasks((t) => t && t.map((x, j) => (j === i ? { ...x, state, detail } : x)));
    let i = 0;
    try {
      const closesAt = Date.now() + closeChoices.find((c) => c.key === d.closes)!.ms;
      mark(i, "doing");
      await import("../lib/seal");
      mark(i++, "done", `Round ${openingRound(closesAt).toLocaleString("en-US")}`);

      let vault: VaultRef | undefined;
      if (usesVault(d)) {
        const chain = chains.find((c) => c.key === d.chain)!;
        const wallet = await connectWallet(chain);
        const pc = publicClient(chain);
        const rid = roomIdBytes(roomId);
        const predicted = (await pc.readContract({ address: chain.factory!, abi: factoryAbi, functionName: "predict", args: [wallet.address, rid] })) as Address;
        mark(i, "doing", `${wallet.label} ${wallet.address.slice(0, 8)}…`);
        const token = d.token as Address;
        const id = BigInt(d.tokenId || "0");
        const amount = d.standard === "erc721" ? 1n : d.standard === "erc20" || d.standard === "native" ? BigInt(Math.round(Number(d.amount) * 1e6)) * 10n ** 12n : BigInt(d.amount);
        if (d.standard === "erc721") await wallet.write({ address: token, abi: erc721Abi, functionName: "approve", args: [chain.factory!, id] });
        else if (d.standard === "erc1155") await wallet.write({ address: token, abi: erc1155Abi, functionName: "setApprovalForAll", args: [chain.factory!, true] });
        else if (d.standard === "erc20") await wallet.write({ address: token, abi: erc20Abi, functionName: "approve", args: [chain.factory!, amount] });
        mark(i++, "done");
        mark(i, "doing", `Vault ${predicted.slice(0, 10)}…`);
        const settleBy = BigInt(Math.floor((closesAt + 3 * 24 * 60 * 60_000) / 1000));
        const attesters = committee.map((a) => a.address as Address);
        const threshold = Math.min(2, attesters.length);
        const tx = await wallet.write({
          address: chain.factory!,
          abi: factoryAbi,
          functionName: "open",
          args: [rid, { standard: standards[d.standard], token: d.standard === "native" ? "0x0000000000000000000000000000000000000000" : token, id, amount }, attesters, threshold, settleBy],
          value: d.standard === "native" ? amount : 0n,
        });
        mark(i++, "done", `Tx ${tx.slice(0, 12)}…`);
        vault = {
          chain: chain.key,
          chainId: chain.id,
          factory: chain.factory!,
          address: predicted,
          asset: { standard: d.standard, token: d.standard === "native" ? "0x0000000000000000000000000000000000000000" : token, id: id.toString(), amount: amount.toString() },
          attesters,
          threshold,
          settleBy: Number(settleBy) * 1000,
        };
      }

      if (d.listing !== "public") {
        mark(i, "doing");
        mark(i++, "done", "Only fingerprints leave this device");
      }
      mark(i, "doing");
      const created = await createRoom({
        id: roomId,
        name: d.name,
        line: d.line,
        about: d.about,
        photo: d.photo ?? undefined,
        credit: d.credit,
        lot: { kind: d.kind },
        format: d.format,
        units: d.units,
        closesAt,
        deposit: parseZec(d.deposit)!,
        reserve: d.reserve ? parseZec(d.reserve) : null,
        network: d.network,
        listing: d.listing,
        paddles: d.paddles,
        vault,
        committee,
      });
      mark(i++, "done");
      toast(d.listing === "public" ? "Room open. It's on the floor now." : `Room open with ${created.book.length} codes.`);
      navigate(`/r/${roomId}${d.listing !== "public" ? "?tab=codes" : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error);
      setTasks((t) => t && t.map((x, j) => (j === i ? { ...x, state: "error", detail: message } : x)));
    }
  }

  const vault = draftVault(d, committee);
  const terms = previewTerms(d, roomId, now, vault);
  const preview = { room: { id: roomId, network: d.network, listing: d.listing, name: terms.name, fingerprint: fingerprint(roomId), createdAt: now, bids: 0 }, terms, role: null };
  const body = (
    <>
      {step === "lot" && <LotStep d={d} set={set} />}
      {step === "vault" && <VaultStep d={d} set={set} committee={committee} />}
      {step === "rules" && <RulesStep d={d} set={set} now={now} />}
      {step === "access" && <AccessStep d={d} set={set} />}
      {step === "review" && <ReviewStep d={d} terms={terms} vault={vault} committee={committee} tasks={tasks} />}
      {tried && issues.length > 0 && (
        <div className="form-issues" role="alert">
          {issues.map((x) => (
            <p key={x}>
              <WarningCircle size={16} />
              {x}
            </p>
          ))}
        </div>
      )}
    </>
  );

  const busy = tasks?.some((t) => t.state === "doing") ?? false;
  const failed = tasks?.some((t) => t.state === "error") ?? false;
  const action =
    step === "review" ? (
      <button type="button" className="btn gold lg" onClick={open} disabled={busy}>
        {busy ? <CircleNotch size={18} className="spin" /> : <LockSimple size={18} />}
        {busy ? "Opening the room…" : failed ? "Try again" : "Open room"}
      </button>
    ) : (
      <button type="button" className="btn gold lg" onClick={next}>
        Continue
        <ArrowRight size={17} />
      </button>
    );

  if (mobile)
    return (
      <div className="m-create">
        <div className="m-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(index + 1) / order.length})` }} />
        </div>
        <p className="t-label">
          Step {index + 1} of {order.length}. {stepNames[step]}
        </p>
        {body}
        {step === "access" && (
          <div className="m-create-preview">
            <p className="t-label">How the floor will show it</p>
            {d.listing === "hidden" ? <p className="t-small">Not listed at all. Only a code opens it.</p> : d.listing === "private" ? <ConcealedTicket seen={preview} /> : <RoomTicket seen={preview} now={now} />}
          </div>
        )}
        <div className="m-dock">
          <button type="button" className="btn lg" onClick={back} aria-label="Back">
            <ArrowLeft size={17} />
          </button>
          {action}
        </div>
      </div>
    );

  return (
    <div className="create">
      <nav className="create-steps" aria-label="Steps">
        {order.map((s, i) => (
          <button key={s} type="button" className="create-step" data-state={i < index ? "done" : i === index ? "now" : "todo"} onClick={() => i < index && setStep(s)} disabled={i > index}>
            <span className="create-step-dot">{i < index ? <Check size={12} weight="bold" /> : i + 1}</span>
            {stepNames[s]}
          </button>
        ))}
        <p className="t-micro create-steps-note">Room {roomId}</p>
        <Hash value={fingerprint(roomId)} keep={0} />
      </nav>
      <div className="create-form">
        {body}
        <div className="create-actions">
          <button type="button" className="btn lg ghost" onClick={back}>
            <ArrowLeft size={17} />
            {index === 0 ? "Cancel" : "Back"}
          </button>
          <span className="spacer" />
          {action}
        </div>
      </div>
      <aside className="create-preview">
        <p className="t-label">{d.listing === "private" ? "On the floor: name only" : d.listing === "hidden" ? "On the floor: not listed" : "On the floor"}</p>
        {d.listing === "private" ? <ConcealedTicket seen={preview} /> : d.listing === "hidden" ? <div className="hidden-preview">Hidden rooms never appear on the floor. Holders of a code see this:</div> : null}
        {d.listing !== "private" && <RoomTicket seen={preview} now={now} />}
        {d.listing === "private" && (
          <>
            <p className="t-label">Inside, for code holders</p>
            <RoomTicket seen={preview} now={now} />
          </>
        )}
      </aside>
    </div>
  );
}

type Setter = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

function StepHead({ title, line }: { title: string; line: string }) {
  return (
    <header className="step-head">
      <h2 className="t-title">{title}</h2>
      <p className="t-lead">{line}</p>
    </header>
  );
}

function LotStep({ d, set }: { d: Draft; set: Setter }) {
  return (
    <div className="step">
      <StepHead title="What are you selling?" line="One room sells one lot. On-chain lots wait in a vault until the result is attested." />
      <div className="tiles" role="radiogroup" aria-label="Kind of lot">
        {kinds.map((k) => (
          <label key={k.kind} className="tile">
            <input type="radio" name="kind" checked={d.kind === k.kind} onChange={() => set("kind", k.kind)} />
            <span className="tile-icon">{k.icon}</span>
            <span className="tile-title">{k.title}</span>
            <span className="tile-note">{k.note}</span>
            {k.vault && (
              <span className="tile-tag chip" data-tone="frost">
                <Vault size={12} />
                Vault
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="lot-name">
          Name
        </label>
        <input id="lot-name" className="input" value={d.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Rock-crystal watch by Jean Rousseau" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="lot-line">
          One line about it
        </label>
        <input id="lot-line" className="input" value={d.line} maxLength={120} onChange={(e) => set("line", e.target.value)} placeholder="Geneva, about 1655. Gilded brass and silver." />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="lot-about">
          Details <span className="faint">(optional)</span>
        </label>
        <textarea id="lot-about" className="textarea" value={d.about} maxLength={1200} onChange={(e) => set("about", e.target.value)} placeholder="Condition, provenance, what the winner receives." />
      </div>
      <fieldset className="field plain">
        <legend className="field-label">Picture</legend>
        <div className="photo-pick">
          <button type="button" className="photo-opt" aria-pressed={d.photo === null} onClick={() => set("photo", null)}>
            <span className="photo-none">
              <ImageSquare size={22} />
            </span>
            <span>The room's seal</span>
          </button>
          {examples.map((x) => (
            <button
              key={x.path}
              type="button"
              className="photo-opt"
              aria-pressed={d.photo === x.path}
              onClick={() => {
                set("photo", x.path);
                set("credit", x.credit);
              }}
            >
              <img src={x.path.replace("-1200", "-600")} alt="" />
              <span>{x.label}</span>
            </button>
          ))}
        </div>
        <p className="field-hint">Example photos are public domain from the Met. In a private room the picture is sealed along with everything else.</p>
      </fieldset>
    </div>
  );
}

function VaultStep({ d, set, committee }: { d: Draft; set: Setter; committee: Attester[] }) {
  const chain = chains.find((c) => c.key === d.chain);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [owned, setOwned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWallet(null);
    if (chain?.key === "anvil" && import.meta.env.DEV) connectWallet(chain).then(setWallet).catch(() => setWallet(null));
  }, [chain?.key]);

  // Reads whether the connected wallet holds the lot, so the deposit can't fail at the last step for a reason visible now.
  useEffect(() => {
    if (!chain || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(d.token)) return setOwned(null);
    const pc = publicClient(chain);
    const run = async () => {
      try {
        if (d.standard === "erc721" && /^\d+$/.test(d.tokenId)) {
          const owner = (await pc.readContract({ address: d.token as Address, abi: erc721Abi, functionName: "ownerOf", args: [BigInt(d.tokenId)] })) as string;
          setOwned(owner.toLowerCase() === wallet.address.toLowerCase() ? "Your wallet holds this NFT." : `Held by ${owner.slice(0, 10)}…, not your wallet.`);
        } else if (d.standard === "erc20") {
          const bal = (await pc.readContract({ address: d.token as Address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address] })) as bigint;
          setOwned(`Your wallet holds ${(Number(bal / 10n ** 12n) / 1e6).toLocaleString("en-US")} of this token.`);
        } else setOwned(null);
      } catch {
        setOwned("Couldn't read this token on the chain.");
      }
    };
    run();
  }, [chain?.key, wallet?.address, d.token, d.tokenId, d.standard]);

  async function useDemoTokens() {
    if (!chain?.demo || !wallet) return;
    setBusy(true);
    try {
      if (chain.key !== "anvil") await wallet.write({ address: chain.demo.token, abi: erc20Abi, functionName: "mint", args: [wallet.address, 25_000n * 10n ** 18n] });
      set("standard", "erc20");
      set("token", chain.demo.token);
      set("amount", "25000");
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 120) : "Couldn't mint", "error");
    } finally {
      setBusy(false);
    }
  }

  async function mintDemo() {
    if (!chain?.demo || !wallet) return;
    setBusy(true);
    try {
      const pc = publicClient(chain);
      const id = BigInt(1000 + Math.floor(Math.random() * 900000));
      await wallet.write({ address: chain.demo.nft, abi: erc721Abi, functionName: "mint", args: [wallet.address, id] });
      void pc;
      set("standard", "erc721");
      set("token", chain.demo.nft);
      set("tokenId", id.toString());
      toast(`Minted demo NFT #${id} to ${chain.key === "anvil" ? "the dev wallet" : "your wallet"}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 120) : "Couldn't mint", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="step">
      <StepHead title="Where does the lot wait?" line="The factory on that chain deploys a vault just for this room. Only a 2 of 3 attested result, or your deadline, moves it." />
      <div className="tiles chains" role="radiogroup" aria-label="Chain">
        {chains
          .filter((c) => import.meta.env.DEV || c.key !== "anvil")
          .map((c) => (
            <label key={c.key} className="tile">
              <input type="radio" name="chain" checked={d.chain === c.key} disabled={!c.factory} onChange={() => set("chain", c.key)} />
              <span className="tile-title">{c.name}</span>
              <span className="tile-note">{c.factory ? (c.key === "anvil" ? "Development chain with a dev wallet" : `Factory ${c.factory.slice(0, 10)}…`) : c.testnet ? "Factory not deployed yet" : "Mainnet, after testnet"}</span>
              {c.factory && <Hash value={c.factory} keep={4} scramble={false} />}
            </label>
          ))}
        {plannedChains.map((c) => (
          <label key={c.key} className="tile">
            <input type="radio" name="chain" disabled />
            <span className="tile-title">{c.name}</span>
            <span className="tile-note">Planned. {c.note}.</span>
          </label>
        ))}
      </div>

      <fieldset className="field plain">
        <legend className="field-label">The lot</legend>
        <div className="seg" role="radiogroup" aria-label="Token standard">
          {(
            [
              ["erc721", "NFT"],
              ["erc1155", "Edition"],
              ["erc20", "Token"],
              ["native", chain?.native ?? "Coin"],
            ] as const
          ).map(([s, label]) => (
            <label key={s} className="seg-opt">
              <input type="radio" name="standard" checked={d.standard === s} onChange={() => set("standard", s)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {d.standard !== "native" && (
        <div className="field">
          <label className="field-label" htmlFor="token">
            Contract address
          </label>
          <input id="token" className="input mono" value={d.token} onChange={(e) => set("token", e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </div>
      )}
      <div className="field-row">
        {(d.standard === "erc721" || d.standard === "erc1155") && (
          <div className="field">
            <label className="field-label" htmlFor="token-id">
              Token id
            </label>
            <input id="token-id" className="input mono" inputMode="numeric" value={d.tokenId} onChange={(e) => set("tokenId", e.target.value.replace(/\D/g, ""))} placeholder="7" />
          </div>
        )}
        {d.standard !== "erc721" && (
          <div className="field">
            <label className="field-label" htmlFor="amount">
              Amount
            </label>
            <input id="amount" className="input mono" inputMode="decimal" value={d.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1" />
          </div>
        )}
      </div>
      {owned && <p className={owned.startsWith("Your") ? "status" : "status"} data-tone={owned.startsWith("Your wallet holds this") || owned.startsWith("Your wallet holds") ? "done" : "error"}>{owned.startsWith("Your") ? <Check size={16} /> : <WarningCircle size={16} />}{owned}</p>}
      {chain?.factory && chain.key !== "anvil" && !wallet && (
        <div className="row">
          <button type="button" className="btn sm" onClick={() => connectWallet(chain).then(setWallet).catch((e) => toast(e instanceof Error ? e.message : "Couldn't connect a wallet."))}>
            <WalletIcon size={15} />
            Connect wallet
          </button>
        </div>
      )}
      {chain?.demo && wallet && (
        <div className="dev-box">
          <p className="t-small">
            <b>{wallet.label}</b> <span className="mono">{wallet.address}</span>
          </p>
          <div className="row">
            <button type="button" className="btn sm" onClick={mintDemo} disabled={busy}>
              <Stack size={15} />
              {busy ? "Minting…" : "Mint a demo NFT"}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={useDemoTokens}
              disabled={busy}
            >
              <Coins size={15} />
              {chain.key === "anvil" ? "Use 25,000 demo tokens" : "Mint 25,000 demo tokens"}
            </button>
          </div>
        </div>
      )}

      <div className="committee panel">
        <div className="panel-head">
          <h3>Who can release it</h3>
          <span className="spacer" />
          <span className="chip" data-tone="gold">
            {Math.min(2, committee.length)} of {committee.length} must sign
          </span>
        </div>
        <div className="panel-body">
          {committee.length ? (
            <ul className="committee-list">
              {committee.map((a) => (
                <li key={a.id}>
                  <span>{a.name}</span>
                  <Hash value={a.address} keep={6} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-small">No attesters configured on this directory.</p>
          )}
          <p className="t-small">
            Each attester opens the bids with the same drand round and signs the winner's claim key. The relay that carries their signatures can delay a release but can't change one. If nobody
            settles within three days of the close, you take the lot back.
          </p>
        </div>
      </div>
    </div>
  );
}

function RulesStep({ d, set, now }: { d: Draft; set: Setter; now: number }) {
  const ms = closeChoices.find((c) => c.key === d.closes)!.ms;
  const closesAt = now + ms;
  return (
    <div className="step">
      <StepHead title="How does it sell?" line="Bids are sealed in the bidder's browser. Nobody reads one before the room opens, you included." />
      <div className="options" role="radiogroup" aria-label="Sale type">
        {formatOrder.map((f) => (
          <label key={f} className="option">
            <input type="radio" name="format" checked={d.format === f} onChange={() => set("format", f)} disabled={usesVault(d) && f === "several"} />
            <span className="option-title">{formatChoice[f].title}</span>
            <span className="option-note">{usesVault(d) && f === "several" ? "A vault holds one lot, so several winners isn't available here." : formatChoice[f].note}</span>
          </label>
        ))}
      </div>
      {d.format === "several" && (
        <div className="field">
          <label className="field-label" htmlFor="units">
            How many to sell
          </label>
          <input id="units" className="input" type="number" min={2} max={50} value={d.units} onChange={(e) => set("units", Math.max(2, Math.min(50, Number(e.target.value) || 2)))} />
        </div>
      )}
      <fieldset className="field plain">
        <legend className="field-label">{d.format === "candle" ? "The candle goes out by" : "Bidding closes in"}</legend>
        <div className="seg">
          {closeChoices
            .filter((c) => !c.dev || import.meta.env.DEV)
            .map((c) => (
              <label key={c.key} className="seg-opt">
                <input type="radio" name="closes" checked={d.closes === c.key} onChange={() => set("closes", c.key)} />
                {c.label}
              </label>
            ))}
        </div>
        <p className="field-hint">
          Closes {moment(closesAt, now)}. Opens at drand round <span className="mono">{openingRound(closesAt).toLocaleString("en-US")}</span>, about {spell(roundTime(openingRound(closesAt)) - closesAt)} later.
        </p>
      </fieldset>
      <div className="field-row">
        <div className="field">
          <label className="field-label" htmlFor="deposit">
            Deposit per bid
          </label>
          <div className="input-unit">
            <input id="deposit" className="input" inputMode="decimal" value={d.deposit} onChange={(e) => set("deposit", e.target.value)} />
            <span>ZEC</span>
          </div>
          <p className="field-hint">Comes back to everyone who doesn't win.</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="reserve">
            Sealed reserve <span className="faint">(optional)</span>
          </label>
          <div className="input-unit">
            <input id="reserve" className="input" inputMode="decimal" value={d.reserve} onChange={(e) => set("reserve", e.target.value)} placeholder="None" />
            <span>ZEC</span>
          </div>
          <p className="field-hint">Sealed like a bid. It opens with them, so nobody knows it early.</p>
        </div>
      </div>
    </div>
  );
}

function AccessStep({ d, set }: { d: Draft; set: Setter }) {
  const listings: { key: Listing; icon: ReactNode; title: string; note: string }[] = [
    { key: "private", icon: <LockSimple size={19} />, title: "Private", note: "The floor shows the name and nothing else. A code opens the rest." },
    { key: "public", icon: <Globe size={19} />, title: "Public", note: "The floor shows everything, and anyone can take a paddle." },
    { key: "hidden", icon: <EyeSlash size={19} />, title: "Hidden", note: "Not listed at all. Only people with a code know it exists." },
  ];
  const networks: { key: Network; title: string; note: string; ready: boolean }[] = [
    { key: "preview", title: "Preview network", note: "The directory holds the sealed bids, as the chain would. No money moves.", ready: true },
    { key: "test", title: "Zcash testnet", note: "Bids as shielded payments from Zodl. Arrives with the light-client rooms.", ready: false },
    { key: "main", title: "Zcash mainnet", note: "Real deposits in the Sapling pool. After the testnet rehearsal.", ready: false },
  ];
  return (
    <div className="step">
      <StepHead title="Who gets in?" line="Codes are made in your browser. The directory files each one under a fingerprint and never sees the code itself." />
      <div className="tiles three" role="radiogroup" aria-label="Listing">
        {listings.map((l) => (
          <label key={l.key} className="tile">
            <input type="radio" name="listing" checked={d.listing === l.key} onChange={() => set("listing", l.key)} />
            <span className="tile-icon">{l.icon}</span>
            <span className="tile-title">{l.title}</span>
            <span className="tile-note">{l.note}</span>
          </label>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="paddles">
          {d.listing === "public" ? "Most paddles to hand out" : "Codes to make"}
        </label>
        <input id="paddles" className="input" type="number" min={1} max={200} value={d.paddles} onChange={(e) => set("paddles", Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
        <p className="field-hint">
          {d.listing === "public"
            ? "Each device that joins takes the next paddle."
            : "One per bidder. Each works once, on the first device that uses it. You can revoke unused codes."}
        </p>
      </div>
      <fieldset className="field plain">
        <legend className="field-label">Network</legend>
        <div className="options">
          {networks.map((n) => (
            <label key={n.key} className="option">
              <input type="radio" name="network" checked={d.network === n.key} disabled={!n.ready} onChange={() => set("network", n.key)} />
              <span className="option-title">
                {n.title} {!n.ready && <span className="chip">Soon</span>}
              </span>
              <span className="option-note">{n.note}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function ReviewStep({ d, terms, vault, committee, tasks }: { d: Draft; terms: RoomTerms; vault?: VaultRef; committee: Attester[]; tasks: Task[] | null }) {
  const chain: Chain | undefined = vault ? chains.find((c) => c.key === vault.chain) : undefined;
  const rows: [string, ReactNode][] = [
    ["Lot", `${terms.name}${terms.line ? `. ${terms.line}` : ""}`],
    ["Kind", kinds.find((k) => k.kind === d.kind)!.title],
    ["Sale", formatChoice[d.format].title],
    ["Closes", moment(terms.closesAt)],
    ["Opens at round", <span className="mono">{terms.round.toLocaleString("en-US")}</span>],
    ["Deposit", `${formatZec(BigInt(terms.deposit))} ZEC`],
    ["Reserve", d.reserve ? `${d.reserve} ZEC, sealed` : "None"],
    ["Listing", d.listing === "public" ? "Public" : d.listing === "private" ? "Private, name only" : "Hidden"],
    [d.listing === "public" ? "Paddles" : "Codes", String(d.paddles)],
    ["Network", "Preview network"],
  ];
  if (vault && chain)
    rows.push(
      ["Vault chain", chain.name],
      ["Asset", `${vault.asset.standard.toUpperCase()} ${vault.asset.standard === "erc721" ? `#${d.tokenId}` : d.amount}`],
      ["Attesters", `${Math.min(2, committee.length)} of ${committee.length}`],
    );
  return (
    <div className="step">
      <StepHead title="Ready to open" line="Nothing can be changed once the room is open: bidders need to know the rules can't move under them." />
      <dl className="facts panel review-facts">
        {rows.map(([k, v]) => (
          <div key={k} className="fact">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {tasks && (
        <ol className="tasks" aria-live="polite">
          {tasks.map((t) => (
            <li key={t.label} data-state={t.state}>
              <span className="task-dot">{t.state === "done" ? <Check size={12} weight="bold" /> : t.state === "doing" ? <CircleNotch size={13} className="spin" /> : t.state === "error" ? "!" : ""}</span>
              <span>
                {t.label}
                {t.detail && <span className="task-detail">{t.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="t-small">
        <Eye size={14} /> {d.listing === "public" ? "Everything above is public on the floor." : "Only the name reaches the floor. The rest is sealed under a room key that only your codes open."}
      </p>
    </div>
  );
}

