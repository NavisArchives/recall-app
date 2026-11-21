import { useLang } from "@/lib/publicLang";
import { BARCELONA } from "./archive";

/**
 * Section 06 — what they see, from "Recall Website v3.dc.html".
 *
 * A full screen given to one picture of her display: the channel number in
 * the corner, the clock, the photograph, who added it, and the strip of what
 * else is in the channel. It is a drawing, not a live render — a stranger has
 * no archive — but every element on it is something the real display shows.
 *
 * TWO NUMBERS IN THE DESIGN ARE CANVAS STATE, NOT DESIGN: the export carries
 * `width: 1225px` on the header row and `width: 585px; height: 113px` on the
 * heading block, which are the design tool recording where its own frame
 * happened to be. Copying them would pin this section to one window size. The
 * same mistake as the login door's rounded corners, and left out for the same
 * reason.
 */

const COPY = {
  fr: {
    eyebrow: "CE QU’ILS VOIENT",
    title: ["Un canal.", "Un numéro."],
    lead: "Chaque collection reçoit un numéro simple. 06 — Notre voyage à Barcelone. Tapez 06 sur la télécommande, ou posez sa carte sur le lecteur. Aucun menu à retenir.",
    channel: "CANAL",
    clock: "23:05",
    date: "Jeudi 27 août",
    hint: ["Utilisez les flèches pour", "la photo suivante"],
    position: "4 SUR 9",
    kicker: "album · ajouté par sa fille",
    stillTitle: "LA MAISON EN FRANCE",
    stillDate: "14 juin 1998",
    stillBody: "Le premier soir, avant que personne n’ait défait ses valises.",
    who: "Sa fille",
    relation: "Fille",
  },
  nl: {
    eyebrow: "WAT ZIJ ZIEN",
    title: ["Eén kanaal.", "Eén nummer."],
    lead: "Elke verzameling krijgt een eenvoudig eigen nummer. 06 — Onze reis naar Barcelona. Typ 06 op de afstandsbediening, of leg de kaart op de lezer. Geen menu’s om te onthouden.",
    channel: "KANAAL",
    clock: "23:05",
    date: "Donderdag 27 augustus",
    hint: ["Gebruik de pijlen voor", "de volgende foto"],
    position: "4 VAN 9",
    kicker: "album · toegevoegd door haar dochter",
    stillTitle: "HET HUIS IN FRANKRIJK",
    stillDate: "14 juni 1998",
    stillBody: "De eerste avond, voor iemand had uitgepakt.",
    who: "Haar dochter",
    relation: "Dochter",
  },
  en: {
    eyebrow: "WHAT THEY SEE",
    title: ["One channel.", "One number."],
    lead: "Every collection gets a simple number of its own. 06 — Our trip to Barcelona. Type 06 on the remote, or place its card on the reader. No menus to remember.",
    channel: "CHANNEL",
    clock: "23:05",
    date: "Thursday 27 August",
    hint: ["Use the arrows for", "the next photo"],
    position: "4 OF 9",
    kicker: "album · added by her daughter",
    stillTitle: "THE HOUSE IN FRANCE",
    stillDate: "14 June 1998",
    stillBody: "The first evening, before anyone had unpacked.",
    who: "Her daughter",
    relation: "Daughter",
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const CREAM = "#F2F1EE";
const DIM = "rgba(242,241,238,0.72)";

/* The six frames in the strip; the fourth is the one being shown.
   These are 74px, but they are a picture of her screen, and the point of
   the section is that it looks like her life.

   THE CAPTION MATCHES THE PICTURE. The design captioned an interior "MY
   GARDEN IN FRANCE / On the Grand-Place, a festive afternoon" — a garden, a
   city square and a room, in one three-line caption. A screenshot nobody
   believes is worse than no screenshot. */
const STRIP = [
  "/site/sea-view.jpg",
  "/site/sicily.jpg",
  "/site/room-terracotta.jpg",
  "/site/sea-room.jpg",
  "/site/sicily.jpg",
  "/site/her-painting.jpg",
];
const SHOWING = 3;

export function TheirScreen() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section
      className="s-rule flex items-center"
      style={{ minHeight: "100vh", boxSizing: "border-box" }}
    >
      <div
        className="s-wrap flex w-full flex-col"
        style={{
          gap: "clamp(32px,4vw,52px)",
          paddingTop: "clamp(56px,7vw,96px)",
          paddingBottom: "clamp(56px,7vw,96px)",
        }}
      >
        <div
          className="grid items-end"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "clamp(24px,3vw,56px)" }}
        >
          <div className="min-w-0">
            <div className="s-eyebrow">{t.eyebrow}</div>
            <p
              style={{
                margin: "22px 0 0",
                font: "600 clamp(24px,2.7vw,36px)/1.28 Archivo, sans-serif",
                letterSpacing: "-.015em",
                maxWidth: "20ch",
                textWrap: "pretty",
              }}
            >
              {t.title[0]}
              <br />
              {t.title[1]}
            </p>
          </div>
          <p
            style={{
              margin: 0,
              font: "400 16px/1.7 Roboto, sans-serif",
              color: "rgba(var(--s-ink),.72)",
              maxWidth: "44ch",
              justifySelf: "end",
            }}
          >
            {t.lead}
          </p>
        </div>

        <div className="flex w-full flex-col items-center">
          {/* The screen's bezel, then the screen. */}
          <div
            className="s-screen box-border w-full"
            style={{
              maxWidth: 900,
              padding: "clamp(10px,1.1vw,16px)",
              background: "linear-gradient(180deg,#2A2724,#191715)",
              borderRadius: 22,
              boxShadow: "0 40px 90px rgba(20,19,15,.34)",
            }}
          >
            <div className="h-full overflow-hidden" style={{ borderRadius: 16, background: "#0B0B0C" }}>
              <div
                className="relative box-border flex h-full flex-col"
                style={{ padding: "clamp(18px,2vw,26px) clamp(20px,2.2vw,30px)" }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "radial-gradient(900px 420px at 74% 4%, rgba(200,121,65,.16), transparent 62%)",
                  }}
                />

                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <div style={{ font: `400 9px/1 ${MONO}`, letterSpacing: ".3em", color: DIM }}>
                      {t.channel}
                    </div>
                    <div
                      style={{
                        font: "italic 300 clamp(34px,3.4vw,46px)/1 Roboto, sans-serif",
                        color: CREAM,
                        marginTop: 8,
                      }}
                    >
                      {BARCELONA.n}
                    </div>
                  </div>
                  <div className="text-center">
                    <div style={{ font: `400 clamp(22px,2.2vw,30px)/1 ${MONO}`, color: CREAM }}>{t.clock}</div>
                    <div style={{ font: "400 11px/1 Roboto, sans-serif", color: DIM, marginTop: 7 }}>
                      {t.date}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", font: `400 9px/1.9 ${MONO}`, color: DIM }}>
                    {t.hint[0]}
                    <br />
                    {t.hint[1]}
                    <br />
                    <span style={{ color: "#E29A68" }}>{t.position}</span>
                  </div>
                </div>

                <div
                  className="s-screen-body relative min-h-0 flex-1"
                  style={{ gap: "clamp(18px,2vw,28px)", marginTop: "clamp(18px,2vw,28px)" }}
                >
                  <div>
                    <div style={{ font: "italic 300 10.5px/1 Roboto, sans-serif", color: DIM }}>{t.kicker}</div>
                    <div
                      style={{
                        font: "700 clamp(20px,2vw,26px)/1.1 Roboto, sans-serif",
                        color: CREAM,
                        marginTop: 10,
                      }}
                    >
                      {t.stillTitle}
                    </div>
                    <div style={{ font: "italic 300 12.5px/1 Roboto, sans-serif", color: DIM, marginTop: 10 }}>
                      {t.stillDate}
                    </div>
                    <div
                      style={{
                        font: "300 13.5px/1.55 Roboto, sans-serif",
                        color: "rgba(242,241,238,0.9)",
                        marginTop: 12,
                      }}
                    >
                      {t.stillBody}
                    </div>

                    <div className="flex items-center gap-[11px]" style={{ marginTop: "clamp(18px,2vw,26px)" }}>
                      <span
                        className="block flex-none overflow-hidden rounded-full"
                        style={{ width: 36, height: 36, border: "1px solid rgba(242,241,238,0.3)" }}
                      >
                        <img src="/site/sunflower-wall.jpg" alt="" className="block h-full w-full object-cover" />
                      </span>
                      <span>
                        <span className="block" style={{ font: "400 12.5px/1 Roboto, sans-serif", color: CREAM }}>
                          {t.who}
                        </span>
                        <span
                          className="block"
                          style={{ font: "400 9.5px/1 Roboto, sans-serif", color: DIM, marginTop: 5 }}
                        >
                          {t.relation}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="s-screen-still min-h-0 overflow-hidden" style={{ borderRadius: 12 }}>
                    <img src="/site/sea-room.jpg" alt="" className="block h-full w-full object-cover" />
                  </div>
                </div>

                <div className="relative flex gap-[9px]" style={{ marginTop: "clamp(16px,1.8vw,24px)" }}>
                  {STRIP.map((src, i) => (
                    <span
                      key={i}
                      className="block flex-1 overflow-hidden"
                      style={{
                        height: "clamp(44px,5vw,74px)",
                        borderRadius: 8,
                        opacity: i === SHOWING ? 1 : 0.72,
                        outline: i === SHOWING ? "2px solid #C87941" : undefined,
                        outlineOffset: i === SHOWING ? 2 : undefined,
                      }}
                    >
                      <img src={src} alt="" className="block h-full w-full object-cover" />
                    </span>
                  ))}
                </div>

                <div className="relative mt-3.5 flex justify-center gap-2" aria-hidden>
                  {Array.from({ length: 9 }, (_, i) => (
                    <span
                      key={i}
                      className="block h-[7px] w-[7px] rounded-full"
                      style={{ background: i === SHOWING ? "#C87941" : "rgba(242,241,238,0.28)" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
