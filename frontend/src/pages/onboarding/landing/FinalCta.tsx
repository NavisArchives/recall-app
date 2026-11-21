import { Link, useNavigate } from "react-router-dom";

import { Wordmark } from "@/components/Wordmark";
import { useLang } from "@/lib/publicLang";
import { SELLER, sellerRegion } from "@/lib/seller";

/**
 * Section 12 — the close, and the page's footer, from "Recall Website
 * v3.dc.html".
 *
 * The page opened inside a memory — the hero's blurred photograph under two
 * washes — walked out onto paper, and closes back in the same dark. That is
 * why this section carries its own ground rather than the flat `.s-dark`
 * panel: it is the bookend to the hero, not another dark card. It is not
 * `HeroGround` either, because the design gives the closing ground a different
 * photograph, a shorter blur and steeper washes.
 *
 * v3 adds the line that does the most work on the whole page: "No sales team.
 * You'll hear directly from Andy, the person building Recall." It is the only
 * sentence that says how small this is, and for a family deciding whether to
 * hand over their mother's photographs, small and named beats polished.
 *
 * THE FOOTER'S IDENTITY IS `lib/seller.ts`, NOT THE DESIGN. v3 hard-codes
 * "© RECALL 2026 · EN / NL" and the address beneath it. The seller module is
 * the one place the company's name, region and contact are written, it is what
 * the legal pages quote, and the site speaks three languages rather than two.
 * A design file is not where a company's registered details should live.
 */

const COPY = {
  fr: {
    title: "Remettez leur monde numérique à portée de main.",
    lead: "Vous pensez que Recall pourrait aider quelqu’un de votre famille ? Parlez-nous un peu d’elle ou de lui. Nous vous aiderons à trouver la formule qui a du sens.",
    talk: "Parlons de Recall",
    how: "Comment ça marche",
    noSales: "Pas d’équipe commerciale. Vous aurez directement Andy, la personne qui construit Recall.",
    nobody: "PERSONNE N’EST LAISSÉ DE CÔTÉ.",
    links: { how: "Comment ça marche", postcards: "Cartes postales", pricing: "Prix", privacy: "Confidentialité", terms: "Conditions", help: "Aide" },
    from: "DEPUIS LA",
  },
  nl: {
    title: "Breng hun digitale wereld weer binnen bereik.",
    lead: "Denk je dat Recall iemand in je familie kan helpen? Vertel ons kort over hen. We helpen je uitzoeken welke opstelling zinvol is.",
    talk: "Praat met ons over Recall",
    how: "Zo werkt het",
    noSales: "Geen verkoopteam. Je hoort rechtstreeks van Andy, de persoon die Recall bouwt.",
    nobody: "NIEMAND ACHTERGELATEN.",
    links: { how: "Zo werkt het", postcards: "Postkaarten", pricing: "Prijzen", privacy: "Privacy", terms: "Voorwaarden", help: "Hulp" },
    from: "VANUIT",
  },
  en: {
    title: "Bring their digital world back within reach.",
    lead: "Think Recall could help someone in your family? Tell us a little about them. We’ll help you work out which setup makes sense.",
    talk: "Talk to us about Recall",
    how: "How it works",
    noSales: "No sales team. You’ll hear directly from Andy, the person building Recall.",
    nobody: "NOBODY LEFT BEHIND.",
    links: { how: "How it works", postcards: "Postcards", pricing: "Pricing", privacy: "Privacy policy", terms: "Terms", help: "Help" },
    from: "FROM",
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const CREAM = "#F2F1EE";
const DIM = "rgba(242,241,238,0.72)";

export function FinalCta() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];
  const region = sellerRegion(lang);

  return (
    <section id="invite" className="relative overflow-hidden" style={{ background: "var(--s-dark)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, rgba(200,121,65,.3) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
          }}
        />
        <img
          src="/site/her-painting.jpg"
          alt=""
          className="absolute block h-[112%] w-[112%] object-cover"
          style={{ inset: "-6%", filter: "blur(34px) saturate(1.06)", transform: "scale(1.08)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(186deg, rgba(19,17,16,.6) 0%, rgba(19,17,16,.92) 80%)" }}
        />
      </div>

      <div className="s-wrap relative text-center" style={{ paddingTop: 100, paddingBottom: 56 }}>
        <h2
          style={{
            margin: "0 auto",
            font: "600 clamp(30px,3.6vw,50px)/1.15 Archivo, sans-serif",
            letterSpacing: "-.01em",
            color: CREAM,
            maxWidth: "20ch",
            textWrap: "pretty",
          }}
        >
          {t.title}
        </h2>
        <p
          style={{
            margin: "20px auto 0",
            font: "400 16px/1.65 Roboto, sans-serif",
            color: DIM,
            maxWidth: "50ch",
          }}
        >
          {t.lead}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" className="s-btn s-btn--red" onClick={() => navigate("/request")}>
            {t.talk}
          </button>
          <a href="#how" className="s-btn s-btn--ghost">
            {t.how}
          </a>
        </div>

        {/* The smallest sentence on the page and the one that sells it. */}
        <div style={{ marginTop: 18, font: "400 13px/1.5 Roboto, sans-serif", color: "rgba(242,241,238,0.62)" }}>
          {t.noSales}
        </div>

        <div
          style={{ marginTop: 40, font: `400 11px/1 ${MONO}`, letterSpacing: ".3em", color: DIM }}
        >
          {t.nobody}
        </div>

        <div
          className="flex flex-wrap items-start justify-between gap-5 text-left"
          style={{ marginTop: 72, paddingTop: 26, borderTop: "1px solid rgba(255,255,255,.12)" }}
        >
          <Wordmark size={15} style={{ color: CREAM }} />

          <nav className="flex flex-wrap gap-[22px]" aria-label="Site">
            <a href="#how" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.how}
            </a>
            <a href="#postcards" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.postcards}
            </a>
            <a href="#pricing" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.pricing}
            </a>
            <Link to="/privacy" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.privacy}
            </Link>
            <Link to="/terms" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.terms}
            </Link>
            <Link to="/help" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: DIM }}>
              {t.links.help}
            </Link>
          </nav>

          <span style={{ font: `400 11px/1.9 ${MONO}`, color: DIM, textAlign: "right" }}>
            © {SELLER.tradeName.toUpperCase()} 2026
            <br />
            {SELLER.tradeName.toUpperCase()} · {t.from}{" "}
            {region.toUpperCase()}
            <br />
            <a href={`mailto:${SELLER.email}`} style={{ color: DIM }}>
              {SELLER.email.toUpperCase()}
            </a>
          </span>
        </div>
      </div>
    </section>
  );
}
