import { useEffect, useState } from "react";

/** Phones get their own experience, not a squeezed desktop. The switch is by width, so a narrow desktop window gets the phone layout too. */
export const mobileQuery = "(max-width: 860px)";

export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => matchMedia(mobileQuery).matches);
  useEffect(() => {
    const list = matchMedia(mobileQuery);
    const update = () => setMobile(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return mobile;
}
