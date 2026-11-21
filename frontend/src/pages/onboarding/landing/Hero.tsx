import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Wordmark } from "@/components/Wordmark";
import { useLang } from "@/lib/publicLang";
import { BARCELONA } from "./archive";
import { TitleDot } from "./TitleDot";

/**
 * Section 01 — the hero, from "Recall Website v3.dc.html".
 *
 * v3 rebuilt it. The photograph is now a 4:5 portrait with the channel's name
 * burned into its own bottom-left corner under a gradient, and the printed
 * card leans out of that corner.
 *
 * ONE NUMBER IS NOT THE DESIGN'S — see the note on the caption below. v3
 * places the card and the caption in the same 74px of the picture, so the
 * card covers the first half of the channel's name. That is the same defect
 * the previous version shipped, arriving again from the new design's own
 * coordinates, and it is fixed here rather than reproduced faithfully.
 *
 * The channel is `BARCELONA` from ./archive rather than a string typed here,
 * because this same channel appears in three other sections and used to be a
 * different holiday in each.
 */

const COPY = {
  fr: {
    title: "Un monde numérique encore à leur portée",
    lead: "Recall donne aux personnes touchées par un déclin cognitif un accès simple aux gens, aux souvenirs et aux informations qui comptent — sur un écran familier à la maison, rassemblés par les personnes qui les connaissent.",
    also: "Des photos. Des récits de famille. Des visages connus. Des lieux. De la musique. Des consignes. Tout au même endroit, qu’ils peuvent ouvrir eux-mêmes.",
    talk: "Parlons de Recall",
    inUse: "Voir Recall en usage",
    mono: ["FAIT POUR UNE SEULE PERSONNE.", "COMPOSÉ PAR CEUX QUI L’AIMENT."],
    channel: "CANAL",
    typeThis: ["TAPEZ CE", "NUMÉRO"],
    caption: "LA CARTE QU’ELLE TIENT · LE CANAL QU’ELLE OUVRE",
  },
  nl: {
    title: "Een digitale wereld die ze nog kunnen bereiken",
    lead: "Recall geeft mensen met cognitieve achteruitgang eenvoudig toegang tot de mensen, herinneringen en informatie die ertoe doen — op een vertrouwd scherm thuis, samengesteld door wie hen kent.",
    also: "Foto’s. Familieverhalen. Bekende gezichten. Plaatsen. Muziek. Instructies. Allemaal op één plek die ze zelf kunnen openen.",
    talk: "Praat met ons over Recall",
    inUse: "Zie Recall in gebruik",
    mono: ["GEMAAKT VOOR ÉÉN PERSOON.", "SAMENGESTELD DOOR WIE VAN HEN HOUDT."],
    channel: "KANAAL",
    typeThis: ["TYP DIT", "NUMMER"],
    caption: "DE KAART DIE ZE VASTHOUDT · HET KANAAL DAT ZE OPENT",
  },
  en: {
    title: "A digital world they can still reach",
    lead: "Recall gives people with cognitive decline simple access to the people, memories and information that matter — on a familiar screen at home, curated by the people who know them.",
    also: "Photos. Family stories. Familiar faces. Places. Music. Instructions. All in one place they can open themselves.",
    talk: "Talk to us about Recall",
    inUse: "See Recall in use",
    mono: ["BUILT FOR ONE PERSON.", "CURATED BY THE PEOPLE WHO LOVE THEM."],
    channel: "CHANNEL",
    typeThis: ["TYPE THIS", "NUMBER"],
    caption: "THE CARD SHE HOLDS · THE CHANNEL IT OPENS",
  },
} as const;

/**
 * The dark ground the nav and the hero both stand on.
 *
 * It is one element wrapping both, so the bar is over the same photograph
 * rather than over a colour that happens to match it.
 */
export function HeroGround({ children }: { children: ReactNode }) {
  return (
    /*
      IT FILLS THE SCREEN (owner, 18 Sep 2026). The hero is the first thing a
      stranger sees and it should be the only thing, so the dark band is a full
      viewport tall and the section inside it takes the space the nav does not.
      `min-h`, not `h`: on a phone the hero's own content is taller than the
      screen and must be allowed to grow rather than be clipped.

      `dvh` rather than `vh` — on iOS `100vh` counts the address bar that is
      not actually there, so a `vh` hero is cut off at the bottom until you
      scroll. `dvh` is the height the page really has.
    */
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ background: "var(--s-dark)", minHeight: "100dvh" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, rgba(200,121,65,.32) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
          }}
        />
        <img
          src="/site/sea-room.jpg"
          alt=""
          className="absolute block h-[112%] w-[112%] object-cover"
          style={{ inset: "-6%", filter: "blur(36px) saturate(1.06)", transform: "scale(1.08)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(196deg, rgba(19,17,16,.55) 0%, rgba(19,17,16,.9) 84%)" }}
        />
      </div>
      {children}
    </div>
  );
}

export function Hero() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section
      id="top"
      /* `flex-1` so the hero takes whatever the nav leaves and centres in it,
         which is what makes the band exactly one screen rather than one screen
         plus however tall the content happens to be. */
      className="s-wrap relative grid flex-1 items-center"
      style={{
        gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
        gap: 56,
        paddingTop: 64,
        paddingBottom: 90,
      }}
    >
      <div className="min-w-0">
        <h1
          style={{
            margin: 0,
            font: "600 clamp(38px,4.6vw,62px)/1.08 Archivo, sans-serif",
            letterSpacing: "-.015em",
            color: "var(--s-paper)",
            textWrap: "pretty",
          }}
        >
          <TitleDot text={t.title} size=".14em" />
        </h1>
        <p
          style={{
            margin: "24px 0 0",
            font: "400 18px/1.65 Roboto, sans-serif",
            color: "rgba(242,241,238,.78)",
            maxWidth: "52ch",
            textWrap: "pretty",
          }}
        >
          {t.lead}
        </p>
        <p
          style={{
            margin: "16px 0 0",
            font: "400 15px/1.65 Roboto, sans-serif",
            color: "rgba(242,241,238,.62)",
            maxWidth: "52ch",
            textWrap: "pretty",
          }}
        >
          {t.also}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" className="s-btn s-btn--red" onClick={() => navigate("/request")}>
            {t.talk}
          </button>
          <a href="#proof" className="s-btn s-btn--ghost">
            {t.inUse}
          </a>
        </div>

        <div
          style={{
            marginTop: 26,
            font: "400 11px/1.7 'Roboto Mono', monospace",
            letterSpacing: ".14em",
            color: "rgba(242,241,238,.7)",
          }}
        >
          {t.mono[0]}
          <br />
          {t.mono[1]}
        </div>
      </div>

      {/*
        The photograph, its channel written inside it, and the printed card
        leaning out of the bottom-left corner. The card sits 30px outside the
        frame and the strapline 42px below it, which is why the whole group
        gets its own relative box rather than sitting in the grid cell.
      */}
      <div className="flex min-w-0 items-center justify-center">
        <div className="relative" style={{ width: "min(100%,430px)" }}>
          <div
            className="relative overflow-hidden"
            style={{ aspectRatio: "4 / 5", borderRadius: 18, boxShadow: "0 44px 90px rgba(11,11,12,.55)" }}
          >
            <img src={BARCELONA.cover} alt="" className="absolute inset-0 block h-full w-full object-cover" />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ borderRadius: 18, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.14)" }}
            />
            <div
              aria-hidden
              className="absolute bottom-0 left-0 right-0"
              style={{
                height: "46%",
                background: "linear-gradient(180deg, rgba(11,11,12,0) 0%, rgba(11,11,12,.72) 100%)",
              }}
            />
            {/*
              `bottom: 90`, not the design's 22.

              The printed card hangs off the photograph's bottom-left corner at
              `bottom:-26` with a height of 100, so it covers the lowest 74px of
              the picture on that side — and the design puts this caption at
              `bottom:22`, straight underneath it. The result is what shipped on
              the previous version and was flagged then: "OUR TRIP" hidden, only
              "TO BARCELONA" visible. Lifting the caption clear of the card's
              top edge is the smallest fix that keeps both, and it is still well
              inside the gradient that makes it readable.
            */}
            <div className="absolute" style={{ left: 24, bottom: 90 }}>
              <div
                style={{
                  font: "400 9.5px/1 'Roboto Mono', monospace",
                  letterSpacing: ".26em",
                  color: "rgba(242,241,238,.78)",
                }}
              >
                {t.channel} {BARCELONA.n}
              </div>
              <div
                style={{
                  font: "700 21px/1 Roboto, sans-serif",
                  letterSpacing: ".05em",
                  color: "var(--s-paper)",
                  marginTop: 10,
                  textTransform: "uppercase",
                }}
              >
                {BARCELONA.title[lang]}
              </div>
            </div>
          </div>

          {/* The card that arrives in the letterbox, tilted as it would lie. */}
          <div
            className="box-border flex flex-col justify-between"
            style={{
              position: "absolute",
              left: -30,
              bottom: -26,
              width: 152,
              height: 100,
              borderRadius: 10,
              background: "var(--s-cream)",
              transform: "rotate(-6deg)",
              boxShadow: "0 26px 54px rgba(11,11,12,.55)",
              padding: "13px 15px",
            }}
          >
            <Wordmark size={12} />
            <div className="flex items-end justify-between">
              <span
                style={{
                  font: "400 7.5px/1.7 'Roboto Mono', monospace",
                  letterSpacing: ".14em",
                  color: "rgba(20,19,15,.62)",
                }}
              >
                {t.typeThis[0]}
                <br />
                {t.typeThis[1]}
              </span>
              <span className="inline-flex items-baseline gap-[5px]">
                <span
                  style={{
                    font: "700 34px/1 Archivo, sans-serif",
                    letterSpacing: "-.01em",
                    color: "var(--s-ink-hex)",
                  }}
                >
                  {BARCELONA.n}
                </span>
                <span
                  aria-hidden
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--s-red)" }}
                />
              </span>
            </div>
          </div>

          <div
            className="absolute right-0"
            style={{
              bottom: -42,
              font: "400 9.5px/1 'Roboto Mono', monospace",
              letterSpacing: ".18em",
              color: "rgba(242,241,238,.6)",
            }}
          >
            {t.caption}
          </div>
        </div>
      </div>
    </section>
  );
}
