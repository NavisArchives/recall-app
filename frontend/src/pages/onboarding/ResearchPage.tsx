import "./site.css";
import { useLang } from "@/lib/publicLang";
import { BackCircle } from "@/components/BackCircle";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { WhatComesNext } from "./landing/WhatComesNext";

/**
 * /research: what we are researching, on a page of its own (26 Sep 2026).
 *
 * The landing page sells what exists; this page says, plainly and without a
 * date, what we are studying with care partners. It is reached from the
 * footer and from the "Does Recall use AI?" question on the landing page, and
 * from nowhere that sells. The reasons it is not on the landing page are
 * written at the top of WhatComesNext.
 *
 * Light only, like every public page (owner, 17 Sep 2026).
 */

const BACK = { fr: "Retour", nl: "Terug", en: "Back" } as const;

export function ResearchPage() {
  const [lang] = useLang();

  return (
    <div className="site scroll-thin flex h-full flex-col overflow-y-auto">
      <PublicHeader />
      <div className="flex-none px-6 pt-6 md:px-14">
        <BackCircle label={BACK[lang]} />
      </div>
      {/* Not a <main>: the app shell already provides the page's one main
          landmark, and a second, nested one confuses screen readers. */}
      <div className="flex-1">
        <WhatComesNext standalone />
      </div>
      <PublicFooter />
    </div>
  );
}
