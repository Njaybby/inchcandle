import { useMemo, useState } from "react";
import { Copy, DownloadSimple, Eye, EyeSlash, LinkSimple, Plus, Prohibit, UserMinus } from "@phosphor-icons/react";
import { api, ApiError, usePoll } from "../../lib/api";
import { codeId, formatCode } from "../../lib/codes";
import { secrets, useSecretsVersion } from "../../lib/device";
import { extendBook } from "../../lib/rooms";
import { moment } from "../../lib/time";
import { toast } from "../../lib/toast";
import type { RoomTerms } from "../../lib/types";
import { Hash } from "../../ui/Hash";

/** The host's code book: every code with its paddle and whether it has been used, plus the devices that hold paddles. */
export function CodeBook({ terms }: { terms: RoomTerms }) {
  useSecretsVersion();
  const book = secrets.room(terms.id)?.book ?? [];
  const rows = usePoll(() => api.codes(terms.id), 5000, [book.length]);
  const members = usePoll(() => api.members(terms.id), 6000);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "unused" | "used">("all");
  const [busy, setBusy] = useState(false);

  const status = useMemo(() => new Map((rows.data ?? []).map((r) => [r.id, r])), [rows.data]);
  const list = book
    .map((b) => ({ ...b, id: codeId(b.code), row: status.get(codeId(b.code)) }))
    .filter((b) => (filter === "all" ? true : filter === "used" ? !!b.row?.usedAt : !b.row?.usedAt && !b.row?.revokedAt));
  const used = book.filter((b) => status.get(codeId(b.code))?.usedAt).length;
  const revoked = book.filter((b) => status.get(codeId(b.code))?.revokedAt).length;
  const link = (code: string) => `${location.origin}/join#c=${code}`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`);
    } catch {
      toast("Couldn't reach the clipboard.", "error");
    }
  }

  function download() {
    const unused = book.filter((b) => !status.get(codeId(b.code))?.usedAt && !status.get(codeId(b.code))?.revokedAt);
    const text = [`${terms.name}: invite codes`, `Each code works once, on one device. Join at ${location.origin}/join`, "", ...unused.map((b) => `Paddle ${String(b.paddle).padStart(3, " ")}   ${formatCode(b.code)}   ${link(b.code)}`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `inchcandle-codes-${terms.id}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function revoke(id: string) {
    try {
      await api.revokeCode(terms.id, id);
      rows.reload();
      toast("Code revoked. Nobody can join with it now.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't revoke the code.", "error");
    }
  }

  async function more() {
    setBusy(true);
    try {
      const added = await extendBook(terms.id, 5);
      toast(`${added.length} codes added.`);
      rows.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't add codes.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(device: string) {
    try {
      await api.removeMember(terms.id, device);
      members.reload();
      toast("Device removed from the room.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't remove the device.", "error");
    }
  }

  return (
    <div className="codebook">
      <div className="codebook-head">
        <div className="codebook-stats">
          <span>
            <b className="num">{book.length}</b> codes
          </span>
          <span>
            <b className="num gold">{used}</b> used
          </span>
          <span>
            <b className="num">{book.length - used - revoked}</b> waiting
          </span>
          {revoked > 0 && (
            <span>
              <b className="num">{revoked}</b> revoked
            </span>
          )}
        </div>
        <span className="spacer" />
        <div className="tabs" role="tablist" aria-label="Filter codes">
          {(["all", "unused", "used"] as const).map((f) => (
            <button key={f} type="button" role="tab" className="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "unused" ? "Unused" : "Used"}
            </button>
          ))}
        </div>
      </div>
      <p className="t-small">
        Hand each bidder one code, by any channel you trust. The directory only knows each code's fingerprint, so these codes exist in this browser and nowhere else. Download them if you
        might switch devices.
      </p>
      <div className="codebook-actions">
        <button type="button" className="btn sm" onClick={() => copy(book.filter((b) => !status.get(codeId(b.code))?.usedAt).map((b) => formatCode(b.code)).join("\n"), "Unused codes")}>
          <Copy size={15} />
          Copy unused
        </button>
        <button type="button" className="btn sm" onClick={download}>
          <DownloadSimple size={15} />
          Download
        </button>
        <button type="button" className="btn sm" onClick={more} disabled={busy}>
          <Plus size={15} />
          Five more codes
        </button>
      </div>
      <ol className="codes">
        {list.map((b) => {
          const state = b.row?.revokedAt ? "revoked" : b.row?.usedAt ? "used" : "unused";
          const open = shown.has(b.code);
          return (
            <li key={b.code} className="code-row" data-state={state}>
              <span className="code-paddle mono">#{String(b.paddle).padStart(2, "0")}</span>
              <span className="code-value mono">{open || state !== "unused" ? formatCode(b.code) : "••••-••••-••••-" + b.code.slice(12)}</span>
              <span className="code-state">
                {state === "used" ? (
                  <span className="chip" data-tone="gold">
                    Used {moment(b.row!.usedAt!)}
                  </span>
                ) : state === "revoked" ? (
                  <span className="chip">Revoked</span>
                ) : (
                  <span className="chip" data-tone="frost">
                    Waiting
                  </span>
                )}
              </span>
              <Hash value={b.id} keep={0} scramble={false} className="code-fp" />
              <span className="code-actions">
                {state === "unused" && (
                  <>
                    <button type="button" className="icon-btn" aria-label={open ? "Hide code" : "Show code"} onClick={() => setShown((s) => new Set(open ? [...s].filter((x) => x !== b.code) : [...s, b.code]))}>
                      {open ? <EyeSlash size={17} /> : <Eye size={17} />}
                    </button>
                    <button type="button" className="icon-btn" aria-label="Copy code" onClick={() => copy(formatCode(b.code), "Code")}>
                      <Copy size={17} />
                    </button>
                    <button type="button" className="icon-btn" aria-label="Copy invite link" onClick={() => copy(link(b.code), "Invite link")}>
                      <LinkSimple size={17} />
                    </button>
                    <button type="button" className="icon-btn" aria-label="Revoke code" onClick={() => revoke(b.id)}>
                      <Prohibit size={17} />
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {(members.data?.length ?? 0) > 0 && (
        <div className="members">
          <h3 className="t-h3">Devices in the room</h3>
          <ul>
            {members.data!.map((m) => (
              <li key={m.device} data-removed={!!m.removedAt}>
                <span className="mono">#{String(m.paddle).padStart(2, "0")}</span>
                <Hash value={m.device} keep={0} scramble={false} />
                <span className="t-small">
                  {m.viaCode ? "With a code" : "Took a paddle"}, {moment(m.joinedAt)}
                </span>
                {m.removedAt ? (
                  <span className="chip">Removed</span>
                ) : (
                  <button type="button" className="btn sm ghost" onClick={() => remove(m.device)}>
                    <UserMinus size={15} />
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
