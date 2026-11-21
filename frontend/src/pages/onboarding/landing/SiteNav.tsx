import { Link, useNavigate } from "react-router-dom";

import { Wordmark } from "@/components/Wordmark";
import { LangToggle } from "@/components/login/LangToggle";
import { SiteMenu } from "@/components/public/SiteMenu";
import { useLang } from "@/lib/publicLang";

/**
 * The front page's nav bar (design "Recall Website v3.dc.html", Nav).
 *
 * It rides on the hero's dark ground — a near-black panel with a blurred
 * photograph and two gradients over it — so every link is drawn in paper, not
 * in the page's ink. That is the only reason this bar's colours are stated at
 * all instead of inherited. It carries its own `position: relative`: the
 * ground's overlays are absolutely positioned, and without one the bar paints
 * underneath them.
 *
 * v3 added an "In use" link to the section about the person Recall was built
 * with; the owner replaced it with the archive service, which is a page of its
 * own and the one thing on the site somebody can buy without a subscription.
 *
 * THE LANGUAGE SWITCH IS THE SHARED CONTROL, not the design's. v3 draws three
 * inline letters with a red ring around the active one; the shipped switch is
 * the white capsule the owner spent an evening on ("don't like the black
 * design — do full white with greyish circles"). A design file redrawing a
 * control the owner has already settled is the design being out of date, not
 * an instruction, and one switch everywhere beats this page's own copy of one.
 *
 * The two repeated drawings — the link and the pill — live in site.css as
 * `.s-nav-link` and `.s-btn--nav`, not inline. An inline colour cannot be
 * overridden by a `:hover` rule, and `.site a:hover` turns a link the site
 * red, which against near-black is a change nobody can see.
 */

const COPY = {
  fr: {
    navLabel: "Navigation principale",
    tagline: "Une archive vivante",
    how: "Comment ça marche",
    postcards: "Cartes postales",
    pricing: "Prix",
    service: "Service d’archivage",
    signIn: "Se connecter",
  },
  nl: {
    navLabel: "Hoofdnavigatie",
    tagline: "Een levend archief",
    how: "Zo werkt het",
    postcards: "Postkaarten",
    pricing: "Prijzen",
    service: "Archiefdienst",
    /* "Inloggen", not "Aanmelden". Aanmelden also reads as "sign up", and on
       an invitation-only product that is the wrong promise on the one button
       a family presses to get back in. HelpPage already says Inloggen. */
    signIn: "Inloggen",
  },
  en: {
    navLabel: "Main navigation",
    tagline: "A living archive",
    how: "How it works",
    postcards: "Postcards",
    pricing: "Pricing",
    service: "Archive service",
    signIn: "Sign in",
  },
} as const;

export function SiteNav() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    /*
      The bar is a full-width band with the 1220px row inside it, rather than
      the row being the band. The switch stands in the PAGE's corner, and the
      page is wider than the column — pinned to the column it sat 176px short
      of the edge on a 1440 screen, which is not a corner.
    */
    <div style={{ position: "relative" }}>
      <nav
        aria-label={t.navLabel}
        className="s-wrap"
        style={{
          position: "relative",
          /* Extra room on the right for the switch standing outside this row.
             Without it Sign in runs under the switch as soon as the window
             narrows to about the column's own width. */
          padding: "26px calc(var(--s-gutter) + 62px) 26px var(--s-gutter)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        {/*
          The lockup: the shared wordmark with the tagline beside it. The
          design draws RECALL in Archivo 600 tracked +.06em; the shipped mark
          is Roboto 700 tracked -.025em with the dot on the baseline
          (components/Wordmark), and one mark everywhere beats one page's
          redrawing of it.
        */}
        <a href="#top" style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
          <Wordmark size={18} style={{ color: "var(--s-paper)" }} />
          <span style={{ font: "italic 300 12px/1 Roboto, sans-serif", color: "rgba(242,241,238,.72)" }}>
            {t.tagline}
          </span>
        </a>

        {/* The row is a class, not an inline style, because below 900px it is
            hidden and the phone menu (SiteMenu) takes its place. */}
        <div className="s-nav-desktop">
          <a href="#how" className="s-nav-link">
            {t.how}
          </a>
          <a href="#postcards" className="s-nav-link">
            {t.postcards}
          </a>
          <a href="#pricing" className="s-nav-link">
            {t.pricing}
          </a>
          {/* A route, not the "#proof" anchor the design pointed at: the
              archive service is its own page now (owner, 18 Sep 2026). */}
          <Link to="/archive-service" className="s-nav-link">
            {t.service}
          </Link>

          {/*
            Sign in is a real button because it goes to a route, not to an
            anchor on this page. It is the kit's ghost pill at the nav's size.
          */}
          <button type="button" className="s-btn s-btn--ghost s-btn--nav" onClick={() => navigate("/login")}>
            {t.signIn}
          </button>
        </div>
      </nav>

      {/*
        The switch stands in the corner, not in the row (owner, 17 Sep 2026:
        "move this to the extreme right corner"). Absolute against the band
        rather than fixed to the viewport, deliberately: this page runs from a
        near-black hero into warm paper, so a switch pinned to the window would
        carry its treatment down over the light half.
      */}
      {/*
        The same corner holds the phone menu's burger below 900px, so the one
        control that survives on a phone stands exactly where the switch did.
        The switch itself moves inside the menu there (site.css, .s-nav-*).
      */}
      <div className="s-nav-corner">
        <span className="s-nav-lang">
          <LangToggle />
        </span>
        <SiteMenu />
      </div>
    </div>
  );
}
