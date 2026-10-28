import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, CircleNotch, Fingerprint, Key, LockKey, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { codeId, normalizeCode } from "../lib/codes";
import { useMobile } from "../lib/layout";
import { redeem, type RedeemOutcome } from "../lib/rooms";
import { navigate } from "../lib/router";
import { formatName } from "../lib/formats";
import { moment } from "../lib/time";
import { CodeInput } from "../ui/CodeInput";
import { Hash } from "../ui/Hash";
import { Seal } from "../ui/Seal";
import { useDeviceId } from "../shell/Shell";

/** Joining by code. The code never leaves this browser: the directory sees its fingerprint, and the code itself opens the admission here. */
export function Join({ url }: { url: URL }) {
  const mobile = useMobile();
  const fromLink = /[#&]c=([0-9A-Za-z-]+)/.exec(url.hash)?.[1] ?? "";
  const [code, setCode] = useState(() => (normalizeCode(fromLink) ?? "").slice(0, 16));
  const [state, setState] = useState<{ status: "idle" } | { status: "checking" } | { status: "done"; result: RedeemOutcome }>({ status: "idle" });
  const device = useDeviceId();

  useEffect(() => {
    document.title = "Join with a code. Inchcandle";
  }, []);

  // A code can arrive in the link's fragment, which browsers never send to a server. Read it, then clear it from the address bar.
  useEffect(() => {
    if (!fromLink) return;
    setCode((normalizeCode(fromLink) ?? fromLink.replace(/[^0-9A-Za-z]/g, "").toUpperCase()).slice(0, 16));
    setState({ status: "idle" });
    history.replaceState(null, "", "/join");
  }, [url.hash]);

  async function submit(value = code) {
    if (state.status === "checking") return;
    setState({ status: "checking" });
    const result = await redeem(value);
    setState({ status: "done", result });
    if (result.ok) setTimeout(() => navigate(`/r/${result.id}`), mobile ? 1600 : 1900);
  }

  const result = state.status === "done" ? state.result : null;
  const normalized = normalizeCode(code);
  const fingerprint = normalized ? codeId(normalized) : null;

  const form = (
    <>
      <CodeInput value={code} onChange={(v) => { setCode(v); if (state.status === "done") setState({ status: "idle" }); }} onComplete={(v) => submit(v)} autoFocus={!mobile} invalid={!!result && !result.ok} />
      {fingerprint && (
        <p className="join-fp">
          <Fingerprint size={15} />
          <span>The directory will only see</span>
          <Hash value={fingerprint} keep={0} scramble={false} />
        </p>
      )}
      {result && !result.ok && (
        <p className="status" data-tone="error" role="alert">
          <WarningCircle size={18} />
          {result.reason}
        </p>
      )}
      {result && result.ok && (
        <div className="join-ok" role="status">
          <Seal seed={result.id} />
          <div>
            <p className="status" data-tone="done">
              <CheckCircle size={18} weight="fill" />
              {result.again ? "Welcome back. This device already holds this code." : "You're in. The code is now tied to this device."}
            </p>
            <h2 className="t-h2">{result.terms.name}</h2>
            <p className="t-small">
              Paddle {result.paddle}. {formatName[result.terms.format]}. Closes {moment(result.terms.closesAt)}.
            </p>
          </div>
        </div>
      )}
      <button type="button" className="btn gold lg block" disabled={code.length !== 16 || state.status === "checking" || !!result?.ok} onClick={() => submit()}>
        {state.status === "checking" ? <CircleNotch size={18} className="spin" /> : result?.ok ? <ArrowRight size={18} /> : <Key size={18} />}
        {state.status === "checking" ? "Checking the code…" : result?.ok ? "Opening the room…" : "Join room"}
      </button>
    </>
  );

  const facts = (
    <ul className="join-facts">
      <li>
        <Fingerprint size={18} />
        <span>
          <b>Your code stays here.</b> The directory checks a one-way fingerprint of it and never sees the code.
        </span>
      </li>
      <li>
        <LockKey size={18} />
        <span>
          <b>One code, one device.</b> The first device to use a code keeps it. Anyone else who tries it is turned away.
        </span>
      </li>
      <li>
        <ShieldCheck size={18} />
        <span>
          <b>The room opens only in this browser.</b> Its key is stored encrypted under a key this browser can use but never export.
        </span>
      </li>
    </ul>
  );

  if (mobile)
    return (
      <div className="m-page m-join-page">
        <header className="step-head">
          <h1 className="t-title">Join with a code</h1>
          <p className="t-lead">Type or paste the code your host gave you.</p>
        </header>
        <section className="m-join panel marks">{form}</section>
        {facts}
        {device && <p className="t-micro">This device: <span className="mono">{device}</span></p>}
      </div>
    );

  return (
    <div className="join-page">
      <section className="join-card panel marks">
        <header className="step-head">
          <h1 className="t-title">Join with a code</h1>
          <p className="t-lead">Private rooms open with a code from the host. Paste it in, or type it as you heard it: case and dashes don't matter.</p>
        </header>
        {form}
      </section>
      <aside className="join-side">
        {facts}
        {device && (
          <div className="join-device">
            <span className="t-label">This device</span>
            <Hash value={device} keep={0} />
          </div>
        )}
      </aside>
    </div>
  );
}
