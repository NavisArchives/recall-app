import { useLang } from "@/lib/publicLang";

/**
 * Section 02 — the problem, from "Recall Website v3.dc.html".
 *
 * v3 turned this section around. It used to open by describing the state of
 * the world; it now opens by describing what the reader is already doing —
 * "You may already be doing this for them" over five errands they will
 * recognise. The argument is the same and lands harder: the memories are not
 * lost, the route to them is.
 *
 * Underneath, the thing itself. A scattered field of photographs, notes and
 * tapes, each hanging by a thin line from one horizontal rule — a life's
 * worth of material, and every piece of it reachable only by going down a
 * wire. Then the five questions that journey actually asks, as a chain, with
 * the last one red because it is the one people give up on.
 *
 * THE SCATTER IS DATA, not twelve hand-placed spans. The design repeats one
 * card twelve times at different angles, opacities and offsets, so it is a
 * list here; a thirteenth is one line, and none of them can drift out of the
 * rhythm the design set.
 */

const COPY = {
  fr: {
    eyebrow: "CELA VOUS PARLE ?",
    heading: "Vous le faites peut-être déjà pour eux.",
    errands: [
      "Retrouver des photos quand ils les demandent.",
      "Ouvrir la bonne application.",
      "Expliquer où se trouve quelque chose.",
      "Renvoyer la même information.",
      "Rappeler sur quel bouton appuyer.",
    ],
    nothingLost:
      "Rien de ce qui compte n’a disparu. C’est le chemin pour y accéder qui est devenu trop difficile.",
    reach: "POUR ATTEINDRE QUOI QUE CE SOIT",
    questions: [
      "QUE VEUX-JE ?",
      "OÙ EST-CE ?",
      "QUEL APPAREIL ?",
      "QUELLE APPLI ?",
      "COMMENT J’Y ARRIVE ?",
    ],
  },
  nl: {
    eyebrow: "KLINKT DIT BEKEND?",
    heading: "Misschien doe je dit al voor hen.",
    errands: [
      "Foto’s zoeken wanneer ze erom vragen.",
      "De juiste app openen.",
      "Uitleggen waar iets staat.",
      "Dezelfde informatie opnieuw sturen.",
      "Eraan herinneren op welke knop te drukken.",
    ],
    nothingLost:
      "Niets van wat telt is verdwenen. De weg ernaartoe is te moeilijk geworden.",
    reach: "OM ER IETS VAN TE BEREIKEN",
    questions: [
      "WAT WIL IK?",
      "WAAR STAAT HET?",
      "WELK TOESTEL?",
      "WELKE APP?",
      "HOE GERAAK IK ER?",
    ],
  },
  en: {
    eyebrow: "DOES THIS SOUND FAMILIAR?",
    heading: "You may already be doing this for them.",
    errands: [
      "Finding photographs when they ask.",
      "Opening the right app.",
      "Explaining where something is.",
      "Sending the same information again.",
      "Reminding them which button to press.",
    ],
    nothingLost:
      "Nothing that matters has disappeared. The route to it has become too difficult.",
    reach: "TO REACH ANY OF IT",
    questions: [
      "WHAT DO I WANT?",
      "WHERE IS IT?",
      "WHICH DEVICE?",
      "WHICH APP?",
      "HOW DO I GET THERE?",
    ],
  },
} as const;

type Piece =
  | { kind: "photo"; src: string; w: number; h: number }
  | { kind: "note"; w: number; h: number }
  | { kind: "tape"; w: number; h: number };

interface Scattered {
  left: number;
  top: number;
  rot: number;
  op: number;
  piece: Piece;
}

/* Straight from the design: twelve pieces, their angles and how far each has
   faded. The order is the order they are drawn, so the later, fainter ones
   sit under the earlier ones where they overlap. */
const SCATTER: Scattered[] = [
  { left: 2, top: 6, rot: -6, op: 1, piece: { kind: "photo", src: "/site/sea-view.jpg", w: 104, h: 75 } },
  { left: 17, top: 0, rot: 4, op: 0.96, piece: { kind: "note", w: 64, h: 70 } },
  { left: 31, top: 11, rot: 5, op: 0.97, piece: { kind: "photo", src: "/site/room-terracotta.jpg", w: 92, h: 66 } },
  { left: 52, top: 2, rot: -4, op: 0.94, piece: { kind: "tape", w: 120, h: 30 } },
  { left: 70, top: 9, rot: 6, op: 0.92, piece: { kind: "photo", src: "/site/sunflower-wall.jpg", w: 96, h: 69 } },
  { left: 0, top: 44, rot: 5, op: 0.88, piece: { kind: "tape", w: 112, h: 30 } },
  { left: 20, top: 48, rot: -5, op: 0.9, piece: { kind: "photo", src: "/site/sicily.jpg", w: 88, h: 63 } },
  { left: 44, top: 43, rot: 7, op: 0.86, piece: { kind: "note", w: 58, h: 64 } },
  { left: 58, top: 47, rot: -3, op: 0.8, piece: { kind: "photo", src: "/site/her-painting.jpg", w: 92, h: 66 } },
  { left: 82, top: 40, rot: -6, op: 0.74, piece: { kind: "note", w: 60, h: 66 } },
  { left: 10, top: 78, rot: 3, op: 0.62, piece: { kind: "photo", src: "/site/breakfast.jpg", w: 86, h: 62 } },
  { left: 36, top: 80, rot: -2, op: 0.52, piece: { kind: "tape", w: 108, h: 30 } },
];

/* The wires. Each is a line down to the rule at 36%; the last two come up
   from below and bend, because their pieces lie under it. */
const WIRES = [
  "M7.2 16.6 V36",
  "M20.4 10 V36",
  "M35.7 20.5 V36",
  "M58 7 V36",
  "M74.9 18.9 V36",
  "M5.6 49 V36",
  "M24.5 57.1 V36",
  "M47.1 52.3 V36",
  "M62.7 56.5 V36",
  "M85.2 49.5 V36",
  "M14.4 87 V70 H24.5 V36",
  "M41.4 81 V70 H47.1 V36",
];

const JOINTS = [7.2, 20.4, 35.7, 58, 74.9, 5.6, 24.5, 47.1, 62.7, 85.2, 14.4, 41.4];

const NOTE_LINES = [100, 86, 94, 62, 80, 50];
const TAPE_BARS = [5, 18, 12, 14, 16, 8, 18, 9, 16, 15, 10];

function Piece({ piece }: { piece: Piece }) {
  if (piece.kind === "photo") {
    return (
      <span
        className="block overflow-hidden"
        style={{ width: piece.w, height: piece.h, background: "var(--s-slot)" }}
      >
        <img src={piece.src} alt="" className="block h-full w-full object-cover" />
      </span>
    );
  }
  if (piece.kind === "note") {
    return (
      <span
        className="box-border flex flex-col gap-[5px]"
        style={{ width: piece.w, height: piece.h, padding: "9px 8px", background: "#fff" }}
      >
        {NOTE_LINES.map((w, i) => (
          <span key={i} className="block h-[2px]" style={{ width: `${w}%`, background: "rgba(20,19,15,0.2)" }} />
        ))}
      </span>
    );
  }
  return (
    <span
      className="box-border flex items-center gap-[7px]"
      style={{ width: piece.w, height: piece.h, padding: "0 9px", background: "#fff" }}
    >
      <span className="h-3.5 w-3.5 flex-none rounded-full" style={{ background: "var(--s-red)" }} />
      <span className="flex items-center gap-[2px]">
        {TAPE_BARS.map((h, i) => (
          <span
            key={i}
            className="block w-[2px] rounded-[1px]"
            style={{ height: h, background: i < 4 ? "var(--s-red)" : "rgba(20,19,15,0.28)" }}
          />
        ))}
      </span>
    </span>
  );
}

export function Problem() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section className="s-wrap s-rule" style={{ paddingTop: 90, paddingBottom: 90 }}>
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
          {t.heading}
        </h2>
        <div className="min-w-0">
          {/* Five errands, one per line. They are a list, not a paragraph:
              the recognition is in seeing them stack up. */}
          <p
            style={{
              margin: 0,
              font: "400 16px/1.9 Roboto, sans-serif",
              color: "rgba(var(--s-ink),0.72)",
              maxWidth: "40ch",
            }}
          >
            {t.errands.map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
          <p
            style={{
              margin: "20px 0 0",
              font: "500 16px/1.7 Roboto, sans-serif",
              color: "var(--s-ink-hex)",
              maxWidth: "40ch",
              textWrap: "pretty",
            }}
          >
            {t.nothingLost}
          </p>
        </div>
      </div>

      {/* The field. `preserveAspectRatio="none"` on the wires so they stretch
          with the box and stay attached to the percentages the pieces sit at. */}
      <div className="s-problem-field" style={{ marginTop: "clamp(40px,4.5vw,64px)" }}>
        <div className="s-problem-field-inner">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {WIRES.map((d) => (
              <path key={d} d={d} fill="none" stroke="rgba(20,19,15,.22)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path
              d="M5.6 36 H85.2"
              fill="none"
              stroke="rgba(20,19,15,.3)"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {JOINTS.map((x) => (
            <span
              key={x}
              aria-hidden
              className="pointer-events-none absolute block h-[5px] w-[5px]"
              style={{ left: `${x}%`, top: "36%", margin: "-2.5px 0 0 -2.5px", background: "rgba(20,19,15,.3)" }}
            />
          ))}

          {SCATTER.map((s, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute block"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                transform: `rotate(${s.rot}deg)`,
                opacity: s.op,
                background: "#FBF8F1",
                border: "1px solid rgba(20,19,15,0.12)",
                borderRadius: 4,
                padding: 5,
                boxShadow: "0 12px 28px rgba(20,19,15,.16)",
              }}
            >
              <Piece piece={s.piece} />
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          font: "500 10.5px/1 'Roboto Mono', monospace",
          letterSpacing: ".2em",
          color: "var(--s-red)",
          marginTop: "clamp(28px,3vw,44px)",
          textAlign: "center",
        }}
      >
        {t.reach}
      </div>

      {/* The journey, said as the questions it actually asks. The last one is
          filled because it is the one people give up on. */}
      <div
        className="mt-[22px] flex flex-wrap items-center justify-center"
        style={{ gap: "clamp(6px,0.9vw,12px)" }}
      >
        {t.questions.map((q, i) => {
          const last = i === t.questions.length - 1;
          return (
            <span key={q} className="flex items-center" style={{ gap: "clamp(6px,0.9vw,12px)" }}>
              <span
                className="inline-flex items-center whitespace-nowrap"
                style={{
                  padding: "13px 21px",
                  borderRadius: 999,
                  background: last ? "var(--s-red)" : "#fff",
                  border: `1px solid ${last ? "var(--s-red)" : "rgba(20,19,15,0.16)"}`,
                  font: `${last ? 500 : 400} 12px/1 'Roboto Mono', monospace`,
                  letterSpacing: ".1em",
                  color: last ? "var(--s-ground)" : "rgba(20,19,15,0.84)",
                  boxShadow: last ? "none" : "0 4px 12px rgba(20,19,15,.06)",
                }}
              >
                {q}
              </span>
              {!last && (
                <svg
                  width="24"
                  height="8"
                  viewBox="0 0 24 8"
                  fill="none"
                  stroke="rgba(20,19,15,0.3)"
                  strokeWidth="1.3"
                  className="flex-none"
                  aria-hidden
                >
                  <path d="M0 4h20M17 1l3 3-3 3" />
                </svg>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}
