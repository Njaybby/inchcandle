import { lazy, Suspense } from "react";
import { IconContext } from "@phosphor-icons/react";
import { useMobile } from "./lib/layout";
import { useLocation } from "./lib/router";
import { DesktopShell, MobileShell } from "./shell/Shell";
import { Floor } from "./screens/Floor";
import { NotFound } from "./screens/NotFound";

const Rooms = lazy(() => import("./screens/Rooms").then((m) => ({ default: m.Rooms })));
const RoomPage = lazy(() => import("./screens/RoomPage").then((m) => ({ default: m.RoomPage })));
const Create = lazy(() => import("./screens/Create").then((m) => ({ default: m.Create })));
const Join = lazy(() => import("./screens/Join").then((m) => ({ default: m.Join })));
const Vaults = lazy(() => import("./screens/Vaults").then((m) => ({ default: m.Vaults })));
const How = lazy(() => import("./screens/How").then((m) => ({ default: m.How })));
const You = lazy(() => import("./screens/You").then((m) => ({ default: m.You })));
const Lab = import.meta.env.DEV ? lazy(() => import("./screens/Lab").then((m) => ({ default: m.Lab }))) : null;

const icons = { weight: "light" as const, size: 20, color: "currentColor", mirrored: false };

function Screen({ url }: { url: URL }) {
  const path = url.pathname;
  const room = /^\/r\/([a-z2-9]{12})\/?$/.exec(path);
  if (path === "/") return <Floor />;
  if (path === "/rooms") return <Rooms url={url} />;
  if (room) return <RoomPage key={room[1]} id={room[1]} url={url} />;
  if (path === "/new") return <Create />;
  if (path === "/join") return <Join url={url} />;
  if (path === "/vaults") return <Vaults />;
  if (path === "/how") return <How />;
  if (path === "/you") return <You />;
  if (Lab && path === "/lab") return <Lab />;
  return <NotFound path={path} />;
}

export function App() {
  const url = useLocation();
  const mobile = useMobile();
  const Shell = mobile ? MobileShell : DesktopShell;
  return (
    <IconContext.Provider value={icons}>
      <Shell>
        <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
          <Screen url={url} />
        </Suspense>
      </Shell>
    </IconContext.Provider>
  );
}
