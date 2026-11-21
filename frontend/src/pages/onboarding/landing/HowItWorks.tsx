import type { ReactNode } from "react";
import { useLang } from "@/lib/publicLang";
import { SICILY, BARCELONA } from "./archive";

/**
 * Section 04 — how it works, from "Recall Website v3.dc.html".
 *
 * v3 moved this onto the dark ground and gave each of the three steps a
 * drawing rather than a sentence: what the family puts in, where it lands,
 * and the two ways she opens it. The middle card is the one that does the
 * work — four kinds of material routed by curved wires into one numbered
 * channel — because "Recall organises it" is the claim a reader is least able
 * to picture.
 *
 * THE CHANNELS COME FROM ./archive. The design shows Sicily as 06 here and
 * Barcelona as 06 two cards later; they are 02 and 06 now, and both are read
 * from the shared object so the page cannot contradict itself again.
 */

const COPY = {
  fr: {
    eyebrow: "COMMENT ÇA MARCHE",
    title: "Une archive de famille. Un accès simple à la maison.",
    chain: "LA FAMILLE AJOUTE → RECALL ORGANISE → LA PERSONNE OUVRE",
    lead: "La famille la construit d’où elle est. La personne l’ouvre depuis le canapé.",
    steps: [
      { label: "01 · LA FAMILLE CRÉE", body: "Chacun ajoute ce qu’il a, d’où qu’il soit." },
      { label: "02 · RECALL ORGANISE", body: "Tout arrive dans un seul canal, avec un but clair." },
      { label: "03 · LA PERSONNE OUVRE", body: "Tapez un numéro ou posez une carte. Le canal s’ouvre." },
    ],
    kinds: ["PHOTOS", "VIDÉO", "VOIX", "RÉCITS", "PERSONNES", "LIEUX"],
    contributors: "QUATRE CONTRIBUTEURS CE MOIS-CI",
    sources: ["PHOTOS", "VOIX", "RÉCITS", "LIEUX"],
    meta: "9 PHOTOS · 3 RÉCITS · 2 VOIX",
    oneChannel: "UN CANAL · UN NUMÉRO",
    remoteOrCard: "UNE TÉLÉCOMMANDE OU UNE CARTE · RIEN À APPRENDRE",
    closing: ["AUCUN MENU À APPRENDRE.", "AUCUN TÉLÉCHARGEMENT.", "AUCUNE NAVIGATION À RETENIR."],
  },
  nl: {
    eyebrow: "ZO WERKT HET",
    title: "Eén familiearchief. Eenvoudige toegang thuis.",
    chain: "FAMILIE VOEGT TOE → RECALL ORDENT → DE PERSOON OPENT",
    lead: "De familie bouwt het van waar ze ook zijn. De persoon opent het vanuit de zetel.",
    steps: [
      { label: "01 · DE FAMILIE MAAKT", body: "Iedereen voegt toe wat hij heeft, van waar hij ook is." },
      { label: "02 · RECALL ORDENT", body: "Alles komt terecht in één kanaal, met een duidelijk doel." },
      { label: "03 · DE PERSOON OPENT", body: "Typ een nummer of leg een kaart. Het kanaal gaat open." },
    ],
    kinds: ["FOTO’S", "VIDEO", "STEM", "VERHALEN", "MENSEN", "PLAATSEN"],
    contributors: "VIER BIJDRAGERS DEZE MAAND",
    sources: ["FOTO’S", "STEM", "VERHALEN", "PLAATSEN"],
    meta: "9 FOTO’S · 3 VERHALEN · 2 STEMMEN",
    oneChannel: "ÉÉN KANAAL · ÉÉN NUMMER",
    remoteOrCard: "EEN AFSTANDSBEDIENING OF EEN KAART · NIETS TE LEREN",
    closing: ["GEEN MENU’S OM TE LEREN.", "NIETS TE DOWNLOADEN.", "GEEN NAVIGATIE OM TE ONTHOUDEN."],
  },
  en: {
    eyebrow: "HOW IT WORKS",
    title: "One family archive. Simple access at home.",
    chain: "FAMILY ADDS → RECALL ORGANISES → THE PERSON OPENS",
    lead: "The family builds it from wherever they are. The person opens it from the sofa.",
    steps: [
      { label: "01 · FAMILY CREATES", body: "Everyone adds what they have, from wherever they are." },
      { label: "02 · RECALL ORGANISES", body: "Everything lands in one channel with a clear purpose." },
      { label: "03 · THE PERSON OPENS", body: "Type a number or place a card. The channel opens." },
    ],
    kinds: ["PHOTOS", "VIDEO", "VOICE", "STORIES", "PEOPLE", "PLACES"],
    contributors: "FOUR CONTRIBUTORS THIS MONTH",
    sources: ["PHOTOS", "VOICE", "STORIES", "PLACES"],
    meta: "9 PHOTOS · 3 STORIES · 2 VOICES",
    oneChannel: "ONE CHANNEL · ONE NUMBER",
    remoteOrCard: "A REMOTE OR A CARD · NOTHING TO LEARN",
    closing: ["NO MENUS TO LEARN.", "NO DOWNLOADS.", "NO NAVIGATION TO REMEMBER."],
  },
} as const;

const AMBER = "#E29A68";
const CREAM = "#F2F1EE";
const MONO = "'Roboto Mono', monospace";

/** The six kinds of thing a family adds, drawn once each. */
const ICONS: ReactNode[] = [
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="10.5" r="2" />
    <path d="M3.5 17l5-5 4.5 4.5 3-2.5 4.5 4" />
  </>,
  <>
    <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
    <path d="M15.5 11l6-3.5v9l-6-3.5z" />
  </>,
  <>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0013 0" />
    <path d="M12 18v3.5" />
  </>,
  <>
    <path d="M4 4.5h16v15H4z" />
    <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5.5" />
  </>,
  <>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <circle cx="17" cy="9.5" r="2.5" />
    <path d="M17 14.5c2.5 0 4 1.8 4 4" />
  </>,
  <>
    <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </>,
];

function Card({ label, body, children }: { label: string; body: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: "rgba(255,255,255,.05)",
        border: "1px solid rgba(255,255,255,.13)",
        borderRadius: 22,
        padding: 28,
      }}
    >
      <div style={{ font: `500 11px/1 ${MONO}`, letterSpacing: ".2em", color: AMBER }}>{label}</div>
      <p style={{ margin: "14px 0 0", font: "400 15px/1.6 Roboto, sans-serif", color: "rgba(242,241,238,0.78)" }}>
        {body}
      </p>
      {children}
    </div>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: "auto",
        paddingTop: 20,
        font: `500 10.5px/1 ${MONO}`,
        letterSpacing: ".16em",
        color: "rgba(242,241,238,.72)",
      }}
    >
      {children}
    </div>
  );
}

export function HowItWorks() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section id="how" className="relative overflow-hidden" style={{ background: "var(--s-dark)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, rgba(200,121,65,.3) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
          }}
        />
        <img
          src="/site/sea-view.jpg"
          alt=""
          className="absolute block h-[112%] w-[112%] object-cover"
          style={{ inset: "-6%", filter: "blur(36px) saturate(1.06)", transform: "scale(1.08)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(196deg, rgba(19,17,16,.58) 0%, rgba(19,17,16,.9) 84%)" }}
        />
      </div>

      <div className="s-wrap relative" style={{ paddingTop: 90, paddingBottom: 90 }}>
        <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.eyebrow}</div>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <h2
            style={{
              margin: "20px 0 0",
              font: "600 clamp(30px,3.4vw,46px)/1.15 Archivo, sans-serif",
              letterSpacing: "-.01em",
              color: CREAM,
            }}
          >
            {t.title}
          </h2>
          <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".18em", color: "rgba(242,241,238,0.72)" }}>
            {t.chain}
          </div>
        </div>
        <p
          style={{
            margin: "22px 0 0",
            font: "400 17px/1.65 Roboto, sans-serif",
            color: "rgba(242,241,238,0.78)",
            maxWidth: "58ch",
          }}
        >
          {t.lead}
        </p>

        <div
          className="s-how-grid mt-11 grid items-stretch"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}
        >
          {/* 01 — what the family puts in. */}
          <Card label={t.steps[0].label} body={t.steps[0].body}>
            <div className="mt-[22px] grid gap-2.5" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
              {t.kinds.map((name, i) => (
                <div
                  key={name}
                  className="flex flex-col items-center justify-center gap-2"
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "rgba(255,255,255,.04)",
                    padding: "14px 6px",
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={AMBER}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    {ICONS[i]}
                  </svg>
                  <span
                    style={{
                      font: `500 9.5px/1 ${MONO}`,
                      letterSpacing: ".14em",
                      color: "rgba(242,241,238,0.74)",
                    }}
                  >
                    {name}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "auto", paddingTop: 20 }} className="flex items-center gap-2.5">
              <span className="inline-flex" aria-hidden>
                {[".16", ".24", ".32", "red"].map((tone, i) => (
                  <span
                    key={i}
                    className="box-border block h-[26px] w-[26px] rounded-full"
                    style={{
                      background: tone === "red" ? "var(--s-red)" : `rgba(242,241,238,${tone})`,
                      border: "2px solid #16140F",
                      marginLeft: i ? -9 : 0,
                    }}
                  />
                ))}
              </span>
              <span
                style={{ font: `400 10.5px/1 ${MONO}`, letterSpacing: ".12em", color: "rgba(242,241,238,0.7)" }}
              >
                {t.contributors}
              </span>
            </div>
          </Card>

          {/* 02 — four kinds of thing routed into one numbered channel. */}
          <Card label={t.steps[1].label} body={t.steps[1].body}>
            <div className="relative mt-[30px]" style={{ height: 154 }}>
              <div className="absolute left-0 right-0 top-0 z-[1] flex justify-between" style={{ height: 27 }}>
                {t.sources.map((src) => (
                  <span
                    key={src}
                    className="whitespace-nowrap"
                    style={{ font: `400 9px/1 ${MONO}`, letterSpacing: ".12em", color: AMBER }}
                  >
                    {src}
                  </span>
                ))}
              </div>
              <svg
                viewBox="0 0 300 124"
                preserveAspectRatio="none"
                aria-hidden
                className="absolute left-0 right-0 w-full"
                style={{ top: 27, height: 124 }}
              >
                {[
                  "M42 0 V26 Q42 36 52 36 H96 Q106 36 106 46 V124",
                  "M114 0 V62 Q114 72 124 72 H132 Q142 72 142 82 V124",
                  "M192 0 V52 Q192 62 182 62 H176 Q166 62 166 72 V124",
                  "M267 0 V18 Q267 28 257 28 H212 Q202 28 202 38 V124",
                ].map((d) => (
                  <path
                    key={d}
                    d={d}
                    fill="none"
                    stroke="rgba(226,154,104,.62)"
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {[42, 114, 192, 267].map((x) => (
                  <circle key={x} cx={x} cy="1.6" r="2.2" fill={AMBER} />
                ))}
                {[106, 142, 166, 202].map((x) => (
                  <circle key={x} cx={x} cy="124" r="3" fill="#C87941" />
                ))}
              </svg>
            </div>

            <div
              style={{
                borderRadius: 16,
                background: "rgba(11,11,12,.55)",
                border: "1px solid rgba(255,255,255,.14)",
                padding: "18px 20px",
              }}
            >
              <div className="flex items-baseline gap-3">
                <span style={{ font: "italic 300 40px/1 Roboto, sans-serif", color: CREAM }}>{SICILY.n}</span>
                <span style={{ font: "600 17px/1.2 Archivo, sans-serif", color: CREAM }}>{SICILY.title[lang]}</span>
              </div>
              <div style={{ font: `400 10px/1 ${MONO}`, letterSpacing: ".14em", color: AMBER, marginTop: 12 }}>
                {t.meta}
              </div>
            </div>

            <Foot>{t.oneChannel}</Foot>
          </Card>

          {/* 03 — the two ways in: the remote, or the card on the reader. */}
          <Card label={t.steps[2].label} body={t.steps[2].body}>
            <div className="relative mt-[26px]" style={{ height: 172 }}>
              <div className="absolute left-0 right-0 top-0 z-[1] flex justify-around">
                {/* the remote */}
                <span
                  className="box-border flex flex-col items-center"
                  style={{
                    width: 50,
                    height: 80,
                    borderRadius: 13,
                    background: CREAM,
                    border: "1px solid rgba(20,19,15,.18)",
                    padding: "9px 0 0",
                  }}
                  aria-hidden
                >
                  <span className="box-border flex w-full justify-end pr-[9px]">
                    <span className="block h-2 w-2 rounded-full" style={{ background: "var(--s-red)" }} />
                  </span>
                  <span className="mt-[11px] grid gap-1.5" style={{ gridTemplateColumns: "repeat(3,4px)" }}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <span
                        key={i}
                        className="block h-1 w-1 rounded-full"
                        style={{ background: "rgba(20,19,15,.42)" }}
                      />
                    ))}
                  </span>
                </span>

                {/* the card */}
                <span
                  className="flex items-center justify-center gap-1"
                  style={{
                    width: 74,
                    height: 50,
                    borderRadius: 8,
                    background: "var(--s-cream)",
                    border: "1px solid rgba(255,255,255,.22)",
                  }}
                  aria-hidden
                >
                  <span style={{ font: "700 20px/1 Archivo, sans-serif", color: "var(--s-ink-hex)" }}>
                    {BARCELONA.n}
                  </span>
                  <span
                    className="block rounded-full"
                    style={{ width: 4.5, height: 4.5, background: "var(--s-red)" }}
                  />
                </span>
              </div>

              <svg
                viewBox="0 0 300 130"
                preserveAspectRatio="none"
                aria-hidden
                className="absolute left-0 right-0 w-full"
                style={{ top: 86, height: 44 }}
              >
                <path
                  d="M75 0 V20 Q75 30 85 30 H150"
                  fill="none"
                  stroke="rgba(226,154,104,.62)"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M225 0 V20 Q225 30 215 30 H150"
                  fill="none"
                  stroke="rgba(226,154,104,.62)"
                  strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx="150" cy="30" r="3" fill="#C87941" />
              </svg>
            </div>

            <div
              style={{
                borderRadius: 16,
                background: "rgba(11,11,12,.62)",
                border: "1px solid rgba(255,255,255,.14)",
                padding: "16px 18px",
              }}
            >
              <div className="flex items-baseline gap-2.5">
                <span style={{ font: "italic 300 32px/1 Roboto, sans-serif", color: CREAM }}>{BARCELONA.n}</span>
                <span
                  style={{
                    font: `400 9.5px/1 ${MONO}`,
                    letterSpacing: ".22em",
                    color: AMBER,
                    textTransform: "uppercase",
                  }}
                >
                  {BARCELONA.title[lang]}
                </span>
              </div>
              <div className="mt-3 overflow-hidden" style={{ borderRadius: 10, height: 92 }}>
                <img src={BARCELONA.cover} alt="" className="block h-full w-full object-cover" />
              </div>
            </div>

            <Foot>{t.remoteOrCard}</Foot>
          </Card>
        </div>

        <div
          className="flex flex-wrap items-center justify-center"
          style={{
            gap: "clamp(20px,3vw,48px)",
            marginTop: "clamp(36px,4vw,56px)",
            font: `500 10.5px/1 ${MONO}`,
            letterSpacing: ".16em",
            color: "rgba(242,241,238,.72)",
          }}
        >
          {t.closing.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
