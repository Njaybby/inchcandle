import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  CaretDown,
  CheckCircle,
  Door,
  Eye,
  HandCoins,
  Key,
  LockKey,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SquaresFour,
  Ticket,
  UserCircle,
  Vault,
  WarningCircle,
  X,
  Fire,
} from "@phosphor-icons/react";
import wordmark from "../assets/wordmark.svg";
import { normalizeCode } from "../lib/codes";
import { device } from "../lib/device";
import { useLive } from "../lib/live";
import { Link, navigate, useLocation } from "../lib/router";
import { useToasts } from "../lib/toast";
import { DeviceMark } from "../ui/Seal";
import { Hash } from "../ui/Hash";

export const steps = [
  { id: "open", icon: <Door size={16} />, title: "Open a room", line: "A fresh room for one lot, with its own key." },
  { id: "codes", icon: <Key size={16} />, title: "Hand out codes", line: "One code per bidder. Each works once, on one device." },
  { id: "seal", icon: <LockKey size={16} />, title: "Seal a bid", line: "Your browser locks the amount to a future drand round." },
  { id: "send", icon: <HandCoins size={16} />, title: "Send it with a deposit", line: "A shielded payment carries the sealed bid in its memo." },
  { id: "open-together", icon: <Fire size={16} />, title: "Open together", line: "At the round, every browser opens every bid at once." },
  { id: "vault", icon: <Vault size={16} />, title: "Release the vault", line: "Attesters sign the result and the lot goes where the winner says." },
  { id: "verify", icon: <Eye size={16} />, title: "Verify it yourself", line: "Members recompute the result from the same data." },
];

export function useDeviceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    device()
      .then((d) => setId(d.id))
      .catch(() => setId(null));
  }, []);
  return id;
}

function LiveBadge({ compact = false }: { compact?: boolean }) {
  const live = useLive();
  if (live.status === "verified")
    return (
      <span className="live" data-state="ok" title={`drand quicknet round ${live.round}, BLS signature checked in this browser`}>
        <CheckCircle size={14} weight="fill" />
        {compact ? (
          <span className="mono num">{live.round.toLocaleString("en-US")}</span>
        ) : (
          <>
            <span>Round</span>
            <span className="mono num live-round" key={live.round}>
              {live.round.toLocaleString("en-US")}
            </span>
          </>
        )}
      </span>
    );
  if (live.status === "checking") return <span className="live">Checking drand…</span>;
  return (
    <span className="live" data-state="off">
      <WarningCircle size={14} />
      drand unreachable
    </span>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          {t.tone === "error" ? <WarningCircle size={18} /> : <CheckCircle size={18} weight="fill" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

const nav = [
  { to: "/", label: "Floor", icon: <SquaresFour size={19} /> },
  { to: "/rooms", label: "Rooms", icon: <Door size={19} /> },
  { to: "/vaults", label: "Vaults", icon: <Vault size={19} /> },
  { to: "/you", label: "This device", icon: <UserCircle size={19} /> },
];

function active(path: string, to: string) {
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

function Sidebar() {
  const { pathname } = useLocation();
  const [how, setHow] = useState(true);
  const id = useDeviceId();
  return (
    <aside className="side">
      <Link to="/" className="side-brand" aria-label="Inchcandle floor">
        <img src={wordmark} alt="inchcandle" width={128} height={19} />
      </Link>
      <div className="side-actions">
        <Link to="/new" className="btn gold block">
          <Plus size={17} weight="bold" />
          Create a room
        </Link>
        <Link to="/join" className="btn block">
          <Key size={17} />
          Join with a code
        </Link>
      </div>
      <nav className="side-nav" aria-label="Main">
        {nav.map((item) => (
          <Link key={item.to} to={item.to} className="side-link" aria-current={active(pathname, item.to) ? "page" : undefined}>
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="side-how">
        <button type="button" className="side-how-head" aria-expanded={how} onClick={() => setHow(!how)}>
          <ShieldCheck size={16} />
          How it works
          <CaretDown size={13} className="caret" />
        </button>
        {how && (
          <ol className="side-steps">
            {steps.map((s) => (
              <li key={s.id}>
                <Link to={`/how#${s.id}`} className="side-step">
                  <span className="side-step-icon">{s.icon}</span>
                  <span>
                    <b>{s.title}</b>
                    <span>{s.line}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="side-foot">
        <div className="side-net">
          <span className="chip" data-tone="frost">
            Preview network
          </span>
          <LiveBadge compact />
        </div>
        {id && (
          <Link to="/you" className="side-device">
            <DeviceMark id={id} size={26} />
            <span>
              <span className="t-micro">This device</span>
              <span className="mono side-device-id">{id.slice(0, 10)}</span>
            </span>
          </Link>
        )}
      </div>
    </aside>
  );
}

const titles: [RegExp, string][] = [
  [/^\/$/, "Floor"],
  [/^\/rooms/, "Rooms"],
  [/^\/r\//, "Room"],
  [/^\/new/, "Create a room"],
  [/^\/join/, "Join with a code"],
  [/^\/vaults/, "Vaults"],
  [/^\/how/, "How it works"],
  [/^\/you/, "This device"],
  [/^\/lab/, "Chain lab"],
];

function Topbar() {
  const { pathname } = useLocation();
  const [q, setQ] = useState("");
  const title = titles.find(([re]) => re.test(pathname))?.[1] ?? "Inchcandle";
  function submit(e: FormEvent) {
    e.preventDefault();
    const code = normalizeCode(q);
    if (code) navigate(`/join#c=${code}`);
    else navigate(`/rooms?q=${encodeURIComponent(q.trim())}`);
    setQ("");
  }
  return (
    <header className="top">
      <h1 className="top-title">{title}</h1>
      <form className="top-search" role="search" onSubmit={submit}>
        <MagnifyingGlass size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rooms or paste a code" aria-label="Search rooms or paste a code" />
        {normalizeCode(q) && <span className="chip" data-tone="gold">Code</span>}
      </form>
      <div className="top-right">
        <LiveBadge />
      </div>
    </header>
  );
}

export function DesktopShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar />
        <main className="shell-content">{children}</main>
      </div>
      <Toasts />
    </div>
  );
}

/** Routes that are a task of their own on a phone: no tab bar, a back button, and the task's own action at the bottom. */
const pushed = [/^\/r\//, /^\/new/, /^\/join/, /^\/how/, /^\/lab/];

export function MobileShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const id = useDeviceId();
  const isPushed = pushed.some((re) => re.test(pathname));
  const title = titles.find(([re]) => re.test(pathname))?.[1] ?? "";

  useEffect(() => setSheet(false), [pathname]);

  return (
    <div className="m-shell" data-pushed={isPushed}>
      <header className="m-top">
        {isPushed ? (
          <>
            <button type="button" className="icon-btn" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : navigate("/"))}>
              <ArrowLeft size={20} />
            </button>
            <span className="m-top-title">{title}</span>
          </>
        ) : (
          <Link to="/" className="m-brand" aria-label="Inchcandle floor">
            <img src={wordmark} alt="inchcandle" width={112} height={17} />
          </Link>
        )}
        <span className="spacer" />
        <LiveBadge compact />
        {id && (
          <Link to="/you" aria-label="This device" className="m-device">
            <DeviceMark id={id} size={28} />
          </Link>
        )}
      </header>
      <main className="m-content">{children}</main>
      {!isPushed && (
        <nav className="m-tabs" aria-label="Main">
          <Link to="/" className="m-tab" aria-current={pathname === "/" ? "page" : undefined}>
            <SquaresFour size={22} />
            <span>Floor</span>
          </Link>
          <Link to="/rooms" className="m-tab" aria-current={pathname.startsWith("/rooms") ? "page" : undefined}>
            <Door size={22} />
            <span>Rooms</span>
          </Link>
          <button type="button" className="m-tab m-plus" aria-label="Create or join a room" aria-expanded={sheet} onClick={() => setSheet(true)}>
            <span className="m-plus-disc">
              <Plus size={24} weight="bold" />
            </span>
          </button>
          <Link to="/vaults" className="m-tab" aria-current={pathname.startsWith("/vaults") ? "page" : undefined}>
            <Vault size={22} />
            <span>Vaults</span>
          </Link>
          <Link to="/you" className="m-tab" aria-current={pathname.startsWith("/you") ? "page" : undefined}>
            <Ticket size={22} />
            <span>You</span>
          </Link>
        </nav>
      )}
      {sheet && (
        <div className="m-sheet-wrap" onClick={() => setSheet(false)}>
          <div className="m-sheet" role="dialog" aria-label="Create or join" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <Link to="/new" className="m-sheet-row">
              <span className="m-sheet-icon gold">
                <Plus size={22} weight="bold" />
              </span>
              <span>
                <b>Create a room</b>
                <span>Sell one lot. Bids stay sealed until it opens.</span>
              </span>
            </Link>
            <Link to="/join" className="m-sheet-row">
              <span className="m-sheet-icon">
                <Key size={22} />
              </span>
              <span>
                <b>Join with a code</b>
                <span>Type or paste the code the host gave you.</span>
              </span>
            </Link>
            <button type="button" className="btn ghost block" onClick={() => setSheet(false)}>
              <X size={16} />
              Close
            </button>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

export { LiveBadge, Hash };
