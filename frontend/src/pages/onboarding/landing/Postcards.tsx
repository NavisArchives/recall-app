import { useLang } from "@/lib/publicLang";
import { SICILY } from "./archive";

/**
 * Section 09 — postcards, from "Recall Website v3.dc.html".
 *
 * The one part of Recall that is made of paper. A photograph leaves her
 * archive, arrives through the letterbox, and carries the number of the
 * channel it came from on the back — so the object in her hand is also the
 * way back into the thing it came from.
 *
 * The drawing is two cards at angles: the printed photograph face-up, and the
 * written side with the stamp, the note and the number. The channel is SICILY
 * from ./archive, which is where the "02" on both cards comes from.
 */

const COPY = {
  fr: {
    eyebrow: "CARTES POSTALES",
    title: "Certains souvenirs devraient quitter l’écran.",
    lead: "Une photographie est choisie dans son archive et arrive par la boîte aux lettres. Au dos figure le numéro du canal d’où elle vient. Elle reçoit la photo. Elle tape 02. Le reste de l’histoire s’ouvre sur son écran.",
    steps: [
      { n: "01", name: "Choisissez un canal", body: "Son numéro et son titre suivent." },
      { n: "02", name: "Choisissez une photographie", body: "Parmi celles déjà dans ce canal." },
      { n: "03", name: "Nous l’imprimons et la postons", body: "Chez elle en trois ou quatre jours. Compris dans l’abonnement." },
    ],
    cta: "Voir ce qui est compris",
    from: "CARTE D’ANGELA",
    note: "Les endroits où vous avez voyagé et les souvenirs de ces voyages — réunis au même endroit, qui vous attendent.",
    sender: "D’Angela",
    forWhom: "POUR MARGARET",
    toOpen: "POUR OUVRIR, TAPEZ",
  },
  nl: {
    eyebrow: "POSTKAARTEN",
    title: "Sommige herinneringen mogen het scherm verlaten.",
    lead: "Een foto wordt uit haar archief gekozen en komt door de brievenbus. Op de achterkant staat het nummer van het kanaal waar ze vandaan komt. Ze krijgt de foto. Ze typt 02. De rest van het verhaal gaat open op haar scherm.",
    steps: [
      { n: "01", name: "Kies een kanaal", body: "Het nummer en de titel gaan mee." },
      { n: "02", name: "Kies een foto", body: "Uit de foto’s die al in dat kanaal zitten." },
      { n: "03", name: "Wij drukken en posten ze", body: "Binnen drie of vier dagen bij haar. Inbegrepen in het abonnement." },
    ],
    cta: "Bekijk wat inbegrepen is",
    from: "KAART VAN ANGELA",
    note: "De plaatsen waar je gereisd hebt en de herinneringen aan die reizen — allemaal op één plek, die op je wacht.",
    sender: "Van Angela",
    forWhom: "VOOR MARGARET",
    toOpen: "OM TE OPENEN, TYP",
  },
  en: {
    eyebrow: "POSTCARDS",
    title: "Some memories should leave the screen.",
    lead: "A photograph is chosen from her archive and arrives through the letterbox. On the back is the number of the channel it came from. She receives the photograph. She types 02. The rest of the story opens on her screen.",
    steps: [
      { n: "01", name: "Choose a channel", body: "Its number and title come along." },
      { n: "02", name: "Choose a photograph", body: "From the ones already in that channel." },
      { n: "03", name: "We print and post it", body: "With her in three or four days. Included in the monthly fee." },
    ],
    cta: "See what’s included",
    from: "CARD FROM ANGELA",
    note: "Places you have travelled and the memories from those trips — all in one place, waiting for you.",
    sender: "From Angela",
    forWhom: "FOR MARGARET",
    toOpen: "TO OPEN, TYPE",
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const AMBER = "#E29A68";
const CREAM = "#F2F1EE";
const CARD = "#EFE8D6";
const DEEP = "#A93429";

/** The stamp: a perforated edge on all four sides, and an R in the middle. */
function Stamp() {
  const teeth = "radial-gradient(circle 2.2px at center, #EFE8D6 99%, transparent 100%)";
  return (
    <div
      aria-hidden
      className="relative flex-none"
      style={{
        width: 60,
        height: 72,
        background: DEEP,
        transform: "rotate(-5deg)",
        boxShadow: "0 3px 9px rgba(20,19,15,.2)",
      }}
    >
      <span className="absolute left-0 right-0" style={{ top: -3, height: 6, backgroundImage: teeth, backgroundSize: "6px 6px" }} />
      <span className="absolute left-0 right-0" style={{ bottom: -3, height: 6, backgroundImage: teeth, backgroundSize: "6px 6px" }} />
      <span className="absolute bottom-0 top-0" style={{ left: -3, width: 6, backgroundImage: teeth, backgroundSize: "6px 6px" }} />
      <span className="absolute bottom-0 top-0" style={{ right: -3, width: 6, backgroundImage: teeth, backgroundSize: "6px 6px" }} />
      <span
        className="absolute flex items-center justify-center"
        style={{ inset: 4, border: "1px solid rgba(239,232,214,0.6)" }}
      >
        <span style={{ font: `600 30px/1 ${SERIF}`, fontStyle: "italic", color: CARD }}>R</span>
      </span>
    </div>
  );
}

export function Postcards() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section
      id="postcards"
      className="relative flex items-center overflow-hidden"
      style={{ background: "var(--s-dark)", minHeight: "100vh", boxSizing: "border-box" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, rgba(200,121,65,.3) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
          }}
        />
        <img
          src={SICILY.cover}
          alt=""
          className="absolute block h-[112%] w-[112%] object-cover"
          style={{ inset: "-6%", filter: "blur(38px) saturate(1.06)", transform: "scale(1.08)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(196deg, rgba(19,17,16,.6) 0%, rgba(19,17,16,.9) 84%)" }}
        />
      </div>

      <div
        className="s-wrap s-svc-two relative w-full"
        style={{ paddingTop: "clamp(56px,7vw,96px)", paddingBottom: "clamp(56px,7vw,96px)" }}
      >
        <div className="min-w-0">
          <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.eyebrow}</div>
          <h2
            style={{
              margin: "20px 0 0",
              font: "600 clamp(30px,3.4vw,46px)/1.12 Archivo, sans-serif",
              letterSpacing: "-.02em",
              color: CREAM,
              maxWidth: "18ch",
              textWrap: "pretty",
            }}
          >
            {t.title}
          </h2>
          <p
            style={{
              margin: "22px 0 0",
              font: "400 16px/1.7 Roboto, sans-serif",
              color: "rgba(242,241,238,0.78)",
              maxWidth: "46ch",
            }}
          >
            {t.lead}
          </p>

          <div className="mt-[30px] grid gap-3.5" style={{ maxWidth: "44ch" }}>
            {t.steps.map((s) => (
              <div key={s.n} className="flex items-baseline gap-3.5">
                <span
                  className="flex-none"
                  style={{ font: `500 10.5px/1 ${MONO}`, letterSpacing: ".14em", color: AMBER }}
                >
                  {s.n}
                </span>
                <span>
                  <span className="block" style={{ font: "500 15px/1.3 Roboto, sans-serif", color: CREAM }}>
                    {s.name}
                  </span>
                  <span
                    className="mt-1 block"
                    style={{ font: "400 13.5px/1.5 Roboto, sans-serif", color: "rgba(242,241,238,0.74)" }}
                  >
                    {s.body}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-end gap-4">
            {/*
              `display` is set inline, not by a Tailwind class.

              `.site .s-btn` declares `display: inline-block` in site.css, and
              that rule is UNLAYERED while Tailwind's `inline-flex` sits in a
              layer — so the utility loses and the button stays inline-block.
              The arrow then sits after the text as a separate inline box and
              drops onto a second line, which is what the owner saw. An inline
              style is the one thing that beats both.
            */}
            <a
              href="#pricing"
              className="s-btn s-btn--red"
              style={{ display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}
            >
              {t.cta}
              <svg width="18" height="9" viewBox="0 0 22 10" fill="none" stroke="#F7F3EB" strokeWidth="1.4" aria-hidden>
                <path d="M0 5h20M16 1l4 4-4 4" />
              </svg>
            </a>
          </div>
        </div>

        {/* The two sides of the card, lying on top of each other at an angle. */}
        <div className="s-postcards">
          <div
            className="s-postcard s-postcard--photo"
            style={{ borderRadius: 6, overflow: "hidden", background: CARD, padding: 12, boxShadow: "0 24px 52px rgba(11,11,12,.5)" }}
          >
            <div className="overflow-hidden" style={{ height: "clamp(150px,16vw,210px)" }}>
              <img src={SICILY.cover} alt="" className="block h-full w-full object-cover" />
            </div>
            <div className="flex items-end justify-between gap-3" style={{ paddingTop: 12 }}>
              <span
                style={{
                  font: `400 10px/1 ${MONO}`,
                  letterSpacing: ".2em",
                  color: "rgba(20,19,15,0.72)",
                  textTransform: "uppercase",
                }}
              >
                {SICILY.title[lang]}
              </span>
              <span
                style={{ font: "700 26px/1 Archivo, sans-serif", color: "var(--s-ink-hex)", letterSpacing: "-.01em" }}
              >
                {SICILY.n}
              </span>
            </div>
          </div>

          <div
            className="s-postcard s-postcard--note"
            style={{ borderRadius: 6, background: CARD, padding: 20, boxShadow: "0 24px 52px rgba(11,11,12,.5)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span
                  className="inline-block"
                  style={{
                    padding: "5px 12px",
                    borderRadius: 999,
                    background: DEEP,
                    font: `400 7.5px/1 ${MONO}`,
                    letterSpacing: ".18em",
                    color: CARD,
                  }}
                >
                  {t.from}
                </span>
                <div
                  className="mt-3.5"
                  style={{
                    font: `600 clamp(22px,2.3vw,30px)/1.1 ${SERIF}`,
                    fontStyle: "italic",
                    color: "var(--s-red)",
                  }}
                >
                  {SICILY.title[lang]}
                </div>
                <div
                  className="mt-2.5"
                  style={{
                    font: "400 12px/1.6 Roboto, sans-serif",
                    color: "rgba(20,19,15,0.68)",
                    maxWidth: "30ch",
                  }}
                >
                  {t.note}
                </div>
              </div>
              <Stamp />
            </div>

            <div className="mt-[22px] flex items-end justify-between gap-4">
              <div style={{ font: `500 16px/1.3 ${SERIF}`, fontStyle: "italic", color: "rgba(20,19,15,0.82)" }}>
                {t.sender}
                <span
                  className="mt-1.5 block"
                  style={{ font: `400 8px/1 ${MONO}`, letterSpacing: ".22em", color: "rgba(20,19,15,0.6)" }}
                >
                  {t.forWhom}
                </span>
              </div>
              <div className="text-right">
                <span
                  className="block"
                  style={{ font: `400 8px/1 ${MONO}`, letterSpacing: ".2em", color: "rgba(20,19,15,0.6)" }}
                >
                  {t.toOpen}
                </span>
                <span className="mt-[7px] inline-flex items-baseline gap-1.5">
                  <span
                    style={{
                      font: "700 clamp(30px,3vw,42px)/1 Archivo, sans-serif",
                      color: "var(--s-ink-hex)",
                      letterSpacing: "-.01em",
                    }}
                  >
                    {SICILY.n}
                  </span>
                  <span
                    className="block rounded-full"
                    style={{ width: 7, height: 7, background: "var(--s-red)" }}
                  />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
