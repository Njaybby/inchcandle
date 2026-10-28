import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("popstate", notify);
  // A link to the same page with a new fragment, such as a second invite link, changes only the hash.
  window.addEventListener("hashchange", notify);
}

export function navigate(to: string, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", to);
  notify();
  if (!to.includes("#")) window.scrollTo(0, 0);
}

/** The current address, re-read whenever the app navigates or the person uses back and forward. */
export function useLocation(): URL {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => location.href,
  );
  return new URL(href);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={handle} {...rest} />;
}
