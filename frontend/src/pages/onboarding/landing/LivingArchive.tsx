import { useLang } from "@/lib/publicLang";
import { TitleDot } from "./TitleDot";

/**
 * Section 08 — a living archive, from "Recall Website v3.dc.html".
 *
 * Four months as four bars, and the bar is the argument: 14, 63, 118, 204.
 * A photo album is a number that stops; this one does not. Each column says
 * what happened that month underneath it, so the growth has a cause rather
 * than being a chart.
 *
 * The figures are one family's first six months, drawn — not a live count.
 * Nothing on the public site reads an archive, and a number that pretended to
 * would be the one claim on this page nobody could check.
 */

const COPY = {
  fr: {
    eyebrow: "UNE ARCHIVE VIVANTE",
    title: "Elle n’est jamais finie. C’est tout l’intérêt.",
    lead: "Un album photo est clos le jour où il est fait. Une archive continue de s’ouvrir — la famille y ajoute, la corrige et la prolonge aussi longtemps que cela compte.",
    months: [
      { month: "MARS", count: "14", detail: ["12 PHOTOGRAPHIES", "2 CANAUX"] },
      { month: "MAI", count: "63", detail: ["LA PREMIÈRE VOIX", "3 CONTRIBUTEURS"] },
      { month: "JUILLET", count: "118", detail: ["NUMÉRISATIONS DU GRENIER", "4 CANAUX"] },
      { month: "SEPTEMBRE", count: "204", detail: ["UNE CARTE PAR CANAL", "6 CONTRIBUTEURS"] },
    ],
    not: "Pas une collection de photos figée",
    kinds: [
      "PHOTOS · VIDÉO · VOIX · RÉCITS",
      "PERSONNES · LIEUX · MUSIQUE · HABITUDES · INFORMATIONS UTILES",
    ],
  },
  nl: {
    eyebrow: "EEN LEVEND ARCHIEF",
    title: "Het is nooit af. Dat is net de bedoeling.",
    lead: "Een fotoalbum is klaar op de dag dat het gemaakt wordt. Een archief blijft opengaan — de familie vult het aan, verbetert het en breidt het uit zolang het ertoe doet.",
    months: [
      { month: "MAART", count: "14", detail: ["12 FOTO’S", "2 KANALEN"] },
      { month: "MEI", count: "63", detail: ["DE EERSTE STEM", "3 BIJDRAGERS"] },
      { month: "JULI", count: "118", detail: ["SCANS VAN DE ZOLDER", "4 KANALEN"] },
      { month: "SEPTEMBER", count: "204", detail: ["EEN KAART PER KANAAL", "6 BIJDRAGERS"] },
    ],
    not: "Geen eenmalige fotoverzameling",
    kinds: [
      "FOTO’S · VIDEO · STEMMEN · VERHALEN",
      "MENSEN · PLAATSEN · MUZIEK · GEWOONTES · NUTTIGE INFORMATIE",
    ],
  },
  en: {
    eyebrow: "A LIVING ARCHIVE",
    title: "It is never finished. That is the point.",
    lead: "A photo album is closed the day it is made. An archive keeps opening — the family adds, corrects and extends it for as long as it matters.",
    months: [
      { month: "MARCH", count: "14", detail: ["12 PHOTOGRAPHS", "2 CHANNELS"] },
      { month: "MAY", count: "63", detail: ["THE FIRST VOICE", "3 CONTRIBUTORS"] },
      { month: "JULY", count: "118", detail: ["SCANS FROM THE ATTIC", "4 CHANNELS"] },
      { month: "SEPTEMBER", count: "204", detail: ["A CARD PER CHANNEL", "6 CONTRIBUTORS"] },
    ],
    not: "Not a one-time photo collection",
    kinds: [
      "PHOTOS · VIDEO · VOICES · STORIES",
      "PEOPLE · PLACES · MUSIC · ROUTINES · USEFUL INFORMATION",
    ],
  },
} as const;

const MONO = "'Roboto Mono', monospace";

/* How tall each bar stands, and how solid. The last is the full height and the
   full red, because it is the month the page is written in. */
const BARS = [
  { h: "18%", fill: "rgba(193,59,34,0.3)" },
  { h: "42%", fill: "rgba(193,59,34,0.48)" },
  { h: "68%", fill: "rgba(193,59,34,0.68)" },
  { h: "100%", fill: "#C13B22" },
];

export function LivingArchive() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section
      className="s-rule flex items-center"
      style={{ minHeight: "100vh", boxSizing: "border-box" }}
    >
      <div
        className="s-wrap w-full"
        style={{ paddingTop: "clamp(56px,7vw,96px)", paddingBottom: "clamp(56px,7vw,96px)" }}
      >
        <div className="s-eyebrow">{t.eyebrow}</div>

        <div className="s-problem-head" style={{ marginTop: 20 }}>
          <h2
            style={{
              margin: 0,
              font: "600 clamp(30px,3.4vw,46px)/1.15 Archivo, sans-serif",
              letterSpacing: "-.01em",
              maxWidth: "18ch",
              textWrap: "pretty",
            }}
          >
            {t.title}
          </h2>
          <p
            style={{
              margin: 0,
              font: "400 16px/1.7 Roboto, sans-serif",
              color: "rgba(var(--s-ink),0.72)",
              maxWidth: "40ch",
            }}
          >
            {t.lead}
          </p>
        </div>

        <div
          className="s-months flex items-end"
          style={{ gap: "clamp(12px,2vw,32px)", marginTop: "clamp(40px,4.5vw,68px)" }}
        >
          {t.months.map((m, i) => (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-end" style={{ height: "clamp(96px,11vw,150px)" }} aria-hidden>
                <div
                  className="w-full"
                  style={{ height: BARS[i].h, borderRadius: "10px 10px 0 0", background: BARS[i].fill }}
                />
              </div>
              <div style={{ borderTop: "1.5px solid rgba(var(--s-ink),0.22)", paddingTop: 16 }}>
                <div
                  style={{
                    font: `400 10px/1 ${MONO}`,
                    letterSpacing: ".2em",
                    color: "rgba(var(--s-ink),0.68)",
                  }}
                >
                  {m.month}
                </div>
                <div
                  style={{
                    font: "600 clamp(26px,2.6vw,36px)/1 Archivo, sans-serif",
                    letterSpacing: "-.02em",
                    color: i === 3 ? "var(--s-red)" : "rgba(var(--s-ink),0.9)",
                    marginTop: 12,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {m.count}
                </div>
                <div
                  style={{
                    font: `400 11px/1.7 ${MONO}`,
                    letterSpacing: ".1em",
                    color: "rgba(var(--s-ink),0.6)",
                    marginTop: 9,
                  }}
                >
                  {m.detail[0]}
                  <br />
                  {m.detail[1]}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex flex-wrap items-end justify-between"
          style={{ gap: "clamp(24px,4vw,64px)", marginTop: "clamp(36px,4vw,56px)" }}
        >
          <div
            style={{
              font: "600 clamp(22px,2.4vw,32px)/1.3 Archivo, sans-serif",
              letterSpacing: "-.01em",
              maxWidth: "24ch",
              textWrap: "pretty",
            }}
          >
            <TitleDot text={t.not} size=".12em" />
          </div>
          <div
            style={{
              font: `400 11px/1.9 ${MONO}`,
              letterSpacing: ".14em",
              color: "rgba(var(--s-ink),0.6)",
              textAlign: "right",
            }}
          >
            {t.kinds[0]}
            <br />
            {t.kinds[1]}
          </div>
        </div>
      </div>
    </section>
  );
}
