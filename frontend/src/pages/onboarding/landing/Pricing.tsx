import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/Wordmark";
import { useLang } from "@/lib/publicLang";

/**
 * Section 10 — pricing, from "Recall Website v3.dc.html".
 *
 * The section makes one argument and the layout carries it: the monthly fee is
 * the same whichever way you start, so €25 a month is said ONCE, beside the
 * heading, in the biggest type on the page. The two cards below differ in
 * exactly one number — the one-time setup — and that is the number each card
 * puts in its own large type. The owner's decision, 17 Sep 2026: €25 must not
 * be printed three times.
 *
 * v3 sharpens the lead. "You don't need the Dock to use Recall" is now the
 * first sentence rather than an implication of the layout, because needing the
 * hardware is the misreading this section exists to prevent.
 *
 * Both buttons go to /request. The design points them at an `#invite` anchor
 * that does not exist on the page; asking for an invitation is a route.
 */

const PRICE = { month: "€25", year: "€275", digital: "€75", dock: "€490" } as const;
const PLAN = { digital: "RECALL · DIGITAL", dock: "RECALL DOCK" } as const;

const COPY = {
  fr: {
    eyebrow: "PRIX",
    title: "Commencez avec l’écran que vous avez déjà.",
    lead: "Vous n’avez pas besoin du Dock pour utiliser Recall. Cela peut commencer sur une télévision déjà présente ; le Dock est pour les personnes qui profitent de commandes plus simples. Une seule installation, puis un abonnement mensuel unique, quelle que soit la façon dont vous commencez.",
    perMonth: "par mois",
    fine: ["OU {year} PAR AN · TVA 21% COMPRISE", "RÉSILIABLE CHAQUE MOIS · SUR FACTURE"],
    setup: "installation unique",
    cta: "Parlons de Recall",
    digital: {
      body: "Utilisez Recall sur la télévision ou l’écran déjà présent dans la pièce, avec des commandes physiques simples.",
      note: "SUR UN ÉCRAN QUE VOUS AVEZ DÉJÀ",
      items: [
        "Nous l’installons avec vous, à distance",
        "Des cartes pour chaque canal",
        "Des commandes physiques simples, aucune navigation d’application",
      ],
    },
    dock: {
      body: "L’expérience physique complète : un hub média avec un clavier et un lecteur de cartes connectées.",
      note: "LE DOCK COMPRIS · IL VOUS APPARTIENT",
      items: [
        "Tout ce que contient Digital",
        "Le dock, le clavier et le lecteur",
        "Livré installé et prêt à brancher",
      ],
    },
    includesLabel: "{month} PAR MOIS COMPREND",
    includes: [
      "LES ARCHIVES",
      "L’ESPACE DE LA FAMILLE",
      "LES CARTES POSTALES",
      "UNE PERSONNE À QUI ÉCRIRE",
      "VOS PHOTOS, EXPORTABLES À TOUT MOMENT",
    ],
  },
  nl: {
    eyebrow: "PRIJZEN",
    title: "Begin met het scherm dat je al hebt.",
    lead: "Je hebt de Dock niet nodig om Recall te gebruiken. Het kan beginnen op een televisie die er al staat; de Dock is voor mensen die baat hebben bij eenvoudigere bediening. Eén installatie, daarna één maandelijks abonnement, hoe je ook begint.",
    perMonth: "per maand",
    fine: ["OF {year} PER JAAR · INCL. 21% BTW", "MAANDELIJKS OPZEGBAAR · MET FACTUUR"],
    setup: "eenmalige installatie",
    cta: "Praat met ons over Recall",
    digital: {
      body: "Gebruik Recall op de televisie of het scherm dat al in de kamer staat, met eenvoudige fysieke bediening.",
      note: "OP EEN SCHERM DAT JE AL HEBT",
      items: [
        "Wij installeren het samen met jou, op afstand",
        "Kaarten voor elk kanaal",
        "Eenvoudige fysieke bediening, geen app-navigatie",
      ],
    },
    dock: {
      body: "De volledige fysieke ervaring: een mediahub met een toetsenbord en een verbonden kaartlezer.",
      note: "DE DOCK INBEGREPEN · VAN JOU",
      items: [
        "Alles uit Digital",
        "De dock, het toetsenbord en de lezer",
        "Geleverd, ingesteld en klaar om in te pluggen",
      ],
    },
    includesLabel: "{month} PER MAAND OMVAT",
    includes: [
      "HET ARCHIEF",
      "DE WERKRUIMTE VAN DE FAMILIE",
      "POSTKAARTEN",
      "EEN MENS OM TE MAILEN",
      "JE FOTO’S, ALTIJD EXPORTEERBAAR",
    ],
  },
  en: {
    eyebrow: "PRICING",
    title: "Start with the screen you already have.",
    lead: "You don’t need the Dock to use Recall. It can begin on a television already in the home; the Dock is for people who benefit from simpler controls. One setup, then a single monthly fee whichever way you start.",
    perMonth: "a month",
    fine: ["OR {year} A YEAR · INCL. 21% VAT", "CANCEL ANY MONTH · INVOICED"],
    setup: "one-time setup",
    cta: "Talk to us about Recall",
    digital: {
      body: "Use Recall on the television or screen already in the room, with simple physical controls.",
      note: "ON A SCREEN YOU ALREADY HAVE",
      items: [
        "We set it up with you, remotely",
        "Cards for every channel",
        "Simple physical controls, no app navigation",
      ],
    },
    dock: {
      body: "The complete physical experience: a media hub with a keyboard and a connected card reader.",
      note: "THE DOCK INCLUDED · YOURS TO KEEP",
      items: [
        "Everything in Digital",
        "The dock, the keyboard and the reader",
        "Delivered set up and ready to plug in",
      ],
    },
    includesLabel: "{month} A MONTH INCLUDES",
    includes: [
      "THE ARCHIVE",
      "THE FAMILY WORKSPACE",
      "POSTCARDS",
      "A PERSON TO EMAIL",
      "YOUR PHOTOS, EXPORTABLE ANY TIME",
    ],
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const CREAM = "#F2F1EE";

function Tick({ dark }: { dark: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={dark ? "#C87941" : "var(--s-red)"}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-[3px] flex-none"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function Plan({
  name,
  badge,
  body,
  price,
  setup,
  note,
  items,
  dark,
  cta,
}: {
  name: string;
  badge?: ReactNode;
  body: string;
  price: string;
  setup: string;
  note: string;
  items: readonly string[];
  dark: boolean;
  cta: ReactNode;
}) {
  const ink = dark ? CREAM : "var(--s-ink-hex)";
  const muted = dark ? "rgba(242,241,238,0.78)" : "rgba(var(--s-ink),0.72)";
  const line = dark ? "rgba(255,255,255,.16)" : "rgba(var(--s-ink),0.14)";

  return (
    <div
      className="flex flex-col"
      style={{
        border: `1px solid ${line}`,
        borderRadius: 24,
        padding: "clamp(26px,2.6vw,36px)",
        background: dark ? "#141311" : "rgba(255,255,255,.4)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          style={{
            font: `500 11.5px/1 ${MONO}`,
            letterSpacing: ".2em",
            color: dark ? "rgba(242,241,238,0.86)" : "rgba(var(--s-ink),0.8)",
          }}
        >
          {name}
        </span>
        {badge}
      </div>
      <p style={{ margin: "16px 0 0", font: "400 15px/1.6 Roboto, sans-serif", color: muted, minHeight: "3.2em" }}>
        {body}
      </p>

      <div style={{ marginTop: 26, paddingTop: 24, borderTop: `1px solid ${line}` }}>
        <div className="flex items-baseline gap-[9px]">
          <span
            style={{
              font: "600 clamp(34px,3.6vw,46px)/1 Archivo, sans-serif",
              letterSpacing: "-.02em",
              color: ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {price}
          </span>
          <span
            style={{
              font: "400 14px/1 Roboto, sans-serif",
              color: dark ? "rgba(242,241,238,0.74)" : "rgba(var(--s-ink),0.68)",
            }}
          >
            {setup}
          </span>
        </div>
        <div
          style={{
            font: `400 10.5px/1 ${MONO}`,
            letterSpacing: ".14em",
            color: dark ? "rgba(242,241,238,0.7)" : "rgba(var(--s-ink),0.62)",
            marginTop: 11,
          }}
        >
          {note}
        </div>
      </div>

      <div className="mt-6 grid gap-[11px]">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2.5">
            <Tick dark={dark} />
            <span
              style={{
                font: "400 14px/1.55 Roboto, sans-serif",
                color: dark ? "rgba(242,241,238,0.82)" : "rgba(var(--s-ink),0.78)",
              }}
            >
              {item}
            </span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 26 }}>{cta}</div>
    </div>
  );
}

export function Pricing() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];
  const ask = () => navigate("/request");

  return (
    <section
      id="pricing"
      className="s-rule flex items-center"
      style={{ minHeight: "100vh", boxSizing: "border-box" }}
    >
      <div
        className="s-wrap w-full"
        style={{ paddingTop: "clamp(56px,7vw,96px)", paddingBottom: "clamp(56px,7vw,96px)" }}
      >
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div style={{ minWidth: 0 }}>
            <div className="s-eyebrow">{t.eyebrow}</div>
            <h2 className="s-h2" style={{ maxWidth: "18ch" }}>
              {t.title}
            </h2>
            <p
              style={{
                margin: "18px 0 0",
                font: "400 16px/1.7 Roboto, sans-serif",
                color: "rgba(var(--s-ink),0.72)",
                maxWidth: "48ch",
              }}
            >
              {t.lead}
            </p>
          </div>

          {/* The monthly fee, said once for the whole section. It belongs to
              neither card: both buy the same €25 a month. */}
          <div style={{ textAlign: "right" }}>
            <div className="mt-3.5 flex items-baseline justify-end gap-2.5">
              <span
                style={{
                  font: "600 clamp(52px,6vw,84px)/0.9 Archivo, sans-serif",
                  letterSpacing: "-.035em",
                  color: "var(--s-red)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {PRICE.month}
              </span>
              <span style={{ font: "500 clamp(16px,1.5vw,20px)/1 Roboto, sans-serif", color: "var(--s-red)" }}>
                {t.perMonth}
              </span>
            </div>
            <div
              style={{
                font: `400 10.5px/1.9 ${MONO}`,
                letterSpacing: ".12em",
                color: "rgba(var(--s-ink),0.62)",
                marginTop: 14,
              }}
            >
              {/* The figures are substituted rather than written into each
                  language, so the three tables cannot drift apart on a price. */}
              {t.fine[0].replace("{year}", PRICE.year)}
              <br />
              {t.fine[1]}
            </div>
          </div>
        </div>

        <div
          className="grid"
          style={{
            /* `min(310px,100%)` is the design's two columns at every width it
               was drawn at, and stops the single column overflowing on a 320px
               phone, where 310px plus the gutters is wider than the screen. */
            gridTemplateColumns: "repeat(auto-fit, minmax(min(310px, 100%), 1fr))",
            gap: "clamp(16px,2vw,24px)",
            marginTop: "clamp(36px,4vw,56px)",
          }}
        >
          <Plan
            name={PLAN.digital}
            body={t.digital.body}
            price={PRICE.digital}
            setup={t.setup}
            note={t.digital.note}
            items={t.digital.items}
            dark={false}
            cta={
              <button type="button" className="s-btn s-btn--line s-btn--sm s-btn--block" onClick={ask}>
                {t.cta}
              </button>
            }
          />
          <Plan
            name={PLAN.dock}
            badge={
              <span
                className="inline-flex items-center gap-[7px]"
                style={{ padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,.08)" }}
              >
                <span className="block h-[5px] w-[5px] rounded-full" style={{ background: "#C87941" }} />
                <Wordmark size={9} style={{ color: CREAM }} />
              </span>
            }
            body={t.dock.body}
            price={PRICE.dock}
            setup={t.setup}
            note={t.dock.note}
            items={t.dock.items}
            dark
            cta={
              <button type="button" className="s-btn s-btn--red s-btn--sm s-btn--block" onClick={ask}>
                {t.cta}
              </button>
            }
          />
        </div>

        <div
          className="s-rule flex flex-wrap items-center"
          style={{
            gap: "clamp(18px,3vw,44px)",
            marginTop: "clamp(28px,3vw,40px)",
            paddingTop: 24,
            font: `400 10.5px/1 ${MONO}`,
            letterSpacing: ".14em",
            color: "rgba(var(--s-ink),0.66)",
          }}
        >
          <span>{t.includesLabel.replace("{month}", PRICE.month)}</span>
          {t.includes.map((item) => (
            <span key={item} style={{ color: "rgba(var(--s-ink),0.8)" }}>
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
