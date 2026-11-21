import { useEffect, useState } from "react";

/**
 * Below 1024px the management area changes clothes (wireframes-mobile.md).
 * One breakpoint, shared by every screen that branches — the display keeps
 * its own 1024px minimum and never consults this.
 */
const QUERY = "(max-width: 1023px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
