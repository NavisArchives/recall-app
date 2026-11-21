import { useNavigate } from "react-router-dom";

import { Wordmark } from "@/components/Wordmark";
import { LangToggle } from "@/components/login/LangToggle";
import { useLang } from "@/lib/publicLang";

/**
 * The 84px bar at the top of every public page: the wordmark on the left, the
 * language switch in the corner, a rule underneath.
 *
 * IT WAS COPIED FOUR TIMES — PublicPage, /pricing, /postcards and the new
 * /archive-service each drew their own — and the copies had already drifted:
 * two of them still spelled the logo as the word "Recall" in Roboto medium
 * while the other two used the actual mark. One drawing now, which is the
 * point the owner made about the logo on 17 Sep 2026: it belongs in the same
 * place, in the same version, on every page.
 *
 * THE TAGLINE IS TRANSLATED HERE. Every copy had "A living archive" written
 * into it in English, so a French reader got a French page under an English
 * line — the landing page's own nav was the only one that had ever said
 * "Une archive vivante". It hides below 640px because at that width it
 * crowds the switch, not because it stops being true.
 *
 * The wordmark is a button rather than a link because it goes to `/`, which
 * is the front door on a stranger's machine and the display on hers — that
 * choice belongs to the router, not to an href.
 */

const TAGLINE = {
  fr: "Une archive vivante",
  nl: "Een levend archief",
  en: "A living archive",
} as const;

export function PublicHeader() {
  const navigate = useNavigate();
  const [lang] = useLang();

  return (
    <header
      className="flex h-[84px] flex-none items-center justify-between px-6 md:px-14"
      style={{ borderBottom: "1px solid rgba(var(--ink),.12)" }}
    >
      {/*
        `/welcome`, not `/` (owner, 18 Sep 2026: "pressing on the logo brings
        you back to the welcome page — that should not bring you back to the
        root"). Both render the landing page, but `/` also forwards a paired
        machine to her display, so on any laptop that has been paired the logo
        used to open Margaret's screen. `/welcome` is the landing page and
        only ever the landing page.
      */}
      <button type="button" onClick={() => navigate("/welcome")} className="flex items-baseline gap-3.5">
        <Wordmark size={17} />
        <span className="hidden text-[13px] font-light italic text-fg-faint sm:inline">
          {TAGLINE[lang]}
        </span>
      </button>
      <LangToggle />
    </header>
  );
}
