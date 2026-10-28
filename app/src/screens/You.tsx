import { useEffect, useState } from "react";
import { Fingerprint, Key, LockKey, Trash } from "@phosphor-icons/react";
import { api, usePoll } from "../lib/api";
import { secrets, useSecretsVersion } from "../lib/device";
import { useNow } from "../lib/hooks";
import { useMobile } from "../lib/layout";
import { Link } from "../lib/router";
import { moment } from "../lib/time";
import { toast } from "../lib/toast";
import { useDeviceId } from "../shell/Shell";
import { Hash } from "../ui/Hash";
import { DeviceMark } from "../ui/Seal";

/** This device: its key, and every room it hosts or holds a paddle in. Nothing here has an account behind it. */
export function You() {
  const mobile = useMobile();
  useSecretsVersion();
  const id = useDeviceId();
  const now = useNow(30_000);
  const me = usePoll(() => api.me(), 10_000);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    document.title = "This device. Inchcandle";
  }, []);
  const rooms = secrets.rooms();

  async function forget(roomId: string) {
    await secrets.forgetRoom(roomId);
    setConfirm(null);
    toast("Forgotten on this device. Its key and codes are gone from here.");
  }

  return (
    <div className={mobile ? "m-page" : "page"}>
      <section className="device-hero panel marks">
        {id && <DeviceMark id={id} size={64} />}
        <div>
          <p className="t-label">This device</p>
          {id ? <Hash value={id} keep={0} /> : <span className="t-small">Making a device key…</span>}
          <p className="t-small">
            A P-256 key made in this browser and stored so it can sign but never be exported. Codes you redeem are tied to it, and every room key here is encrypted under a second key of the
            same kind.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Rooms on this device</h2>
          <span className="t-small">{rooms.length} kept here</span>
        </div>
        {rooms.length ? (
          <ul className="device-rooms">
            {rooms.map(([roomId, r]) => {
              const record = [...(me.data?.hosted ?? []), ...(me.data?.joined ?? [])].find((x) => x.id === roomId);
              return (
                <li key={roomId}>
                  <span className="device-room-icon">{r.role === "host" ? <LockKey size={18} /> : <Key size={18} />}</span>
                  <Link to={`/r/${roomId}`} className="device-room-name">
                    <b>{r.name ?? record?.name ?? roomId}</b>
                    <span className="t-micro">
                      {r.role === "host" ? `Hosting, ${r.book?.length ?? 0} codes` : `Paddle ${r.paddle ?? "?"}`}, since {moment(r.at, now)}
                    </span>
                  </Link>
                  <Hash value={roomId} keep={0} scramble={false} />
                  {confirm === roomId ? (
                    <span className="row">
                      <button type="button" className="btn sm danger" onClick={() => forget(roomId)}>
                        Forget it
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="icon-btn" aria-label="Forget this room on this device" onClick={() => setConfirm(roomId)}>
                      <Trash size={17} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <h3>No rooms on this device yet</h3>
            <p className="t-small">Rooms you open or join with a code are kept here, encrypted.</p>
            <Link to="/join" className="btn">
              <Key size={16} />
              Join with a code
            </Link>
          </div>
        )}
        {rooms.some(([, r]) => r.role === "host") && (
          <p className="t-small">
            <Fingerprint size={14} /> A host's codes exist only on the device that made them. Download them from the room's code book before switching devices.
          </p>
        )}
      </section>
    </div>
  );
}
