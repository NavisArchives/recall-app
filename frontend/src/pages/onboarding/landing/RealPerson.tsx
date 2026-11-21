import { useLang } from "@/lib/publicLang";

/**
 * Section 05 — built around a real person, new in "Recall Website v3.dc.html".
 *
 * The one section on the page that is not about the product. Recall began as a
 * thesis about one neighbour who could not reach her own digital world any
 * more, and this says so in the plainest words the page owns: it did not begin
 * as an idea for a market.
 *
 * ⚠ A NAME UNDER THESE QUOTES IS A HEALTH CLAIM. On a public page for a
 * product about cognitive decline, naming the person who said them is an
 * assertion about her health: special-category data under the GDPR (Art. 9),
 * which needs her explicit, documented, withdrawable consent, and her
 * daughter's for the second quote. This public snapshot therefore attributes
 * both quotes anonymously, and the picture beside them is a drawing, not a
 * photograph of anyone.
 */

const COPY = {
  fr: {
    eyebrow: "CONSTRUIT AUTOUR D’UNE PERSONNE RÉELLE",
    title: "Recall n’a pas commencé comme une idée pour un marché.",
    lead: "Cela a commencé avec une personne qui avait besoin d’une autre porte vers son monde numérique. Sa famille a construit une vraie archive avec elle, et Recall a été testé chez elle.",
    quote: "« On dirait vraiment ma propre télévision. »",
    attribution: "ELLE A TESTÉ RECALL CHEZ ELLE",
    quote2:
      "« Cela va m’épargner beaucoup de coups de téléphone frustrants à expliquer à ma mère comment utiliser ses appareils. »",
    attribution2: "SA FILLE",
    caption: ["UNE VRAIE ARCHIVE", "UNE VRAIE MAISON"],
  },
  nl: {
    eyebrow: "GEBOUWD ROND EEN ECHTE PERSOON",
    title: "Recall begon niet als een idee voor een markt.",
    lead: "Het begon met één persoon die een andere weg naar haar digitale wereld nodig had. Haar familie bouwde samen met haar een echt archief, en Recall werd bij haar thuis getest.",
    quote: "“Het voelt net als mijn eigen televisie.”",
    attribution: "ZIJ TESTTE RECALL THUIS",
    quote2:
      "“Dit gaat me een hoop frustrerende telefoontjes besparen waarin ik mama uitleg hoe haar toestellen werken.”",
    attribution2: "HAAR DOCHTER",
    caption: ["EEN ECHT ARCHIEF", "EEN ECHT THUIS"],
  },
  en: {
    eyebrow: "BUILT AROUND A REAL PERSON",
    title: "Recall didn’t begin as an idea for a market.",
    lead: "It began with one person who needed another way into her digital world. Her family built a real archive with her, and Recall was tested with her at home.",
    quote: "“It feels just like using my own television.”",
    attribution: "SHE TESTED RECALL AT HOME",
    quote2:
      "“This will save me a lot of frustrating phone calls explaining to my mum how to use her devices.”",
    attribution2: "HER DAUGHTER",
    caption: ["A REAL ARCHIVE", "A REAL HOME"],
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const SERIF = "'Cormorant Garamond', Georgia, serif";

export function RealPerson() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section
      id="proof"
      className="s-wrap s-rule grid items-center"
      style={{
        gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
        gap: "clamp(32px,4vw,64px)",
        paddingTop: 90,
        paddingBottom: 90,
      }}
    >
      <div className="min-w-0">
        <div className="s-eyebrow">{t.eyebrow}</div>
        <h2 className="s-h2" style={{ maxWidth: "16ch" }}>
          {t.title}
        </h2>
        <p
          style={{
            margin: "22px 0 0",
            font: "400 16px/1.7 Roboto, sans-serif",
            color: "rgba(var(--s-ink),0.72)",
            maxWidth: "44ch",
            textWrap: "pretty",
          }}
        >
          {t.lead}
        </p>

        {/* Hers takes the red rule; her daughter's the quiet one. The order is
            the argument: the person first, the family second. */}
        <div className="mt-9 grid gap-[22px]" style={{ maxWidth: "46ch" }}>
          <blockquote
            style={{ margin: 0, borderLeft: "1.5px solid var(--s-red)", paddingLeft: 20 }}
          >
            <div
              style={{
                font: `italic 600 clamp(20px,2vw,26px)/1.3 ${SERIF}`,
                color: "var(--s-ink-hex)",
                textWrap: "pretty",
              }}
            >
              {t.quote}
            </div>
            <cite
              className="not-italic"
              style={{
                display: "block",
                font: `400 10px/1 ${MONO}`,
                letterSpacing: ".2em",
                color: "rgba(var(--s-ink),0.62)",
                marginTop: 10,
              }}
            >
              {t.attribution}
            </cite>
          </blockquote>

          <blockquote
            style={{ margin: 0, borderLeft: "1.5px solid rgba(var(--s-ink),0.22)", paddingLeft: 20 }}
          >
            <div
              style={{
                font: `italic 600 clamp(18px,1.7vw,22px)/1.35 ${SERIF}`,
                color: "rgba(var(--s-ink),0.86)",
                textWrap: "pretty",
              }}
            >
              {t.quote2}
            </div>
            <cite
              className="not-italic"
              style={{
                display: "block",
                font: `400 10px/1 ${MONO}`,
                letterSpacing: ".2em",
                color: "rgba(var(--s-ink),0.62)",
                marginTop: 10,
              }}
            >
              {t.attribution2}
            </cite>
          </blockquote>
        </div>
      </div>

      <div className="flex min-w-0 justify-center">
        <div
          className="relative overflow-hidden"
          style={{
            width: "min(100%,460px)",
            aspectRatio: "4 / 5",
            borderRadius: 18,
            boxShadow: "0 34px 70px rgba(20,19,15,.28)",
          }}
        >
          <img
            src="/site/room-terracotta.jpg"
            alt=""
            className="absolute inset-0 block h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute bottom-0 left-0 right-0"
            style={{
              height: "40%",
              background: "linear-gradient(180deg, rgba(11,11,12,0) 0%, rgba(11,11,12,.7) 100%)",
            }}
          />
          <div
            className="absolute"
            style={{
              left: 24,
              bottom: 22,
              font: `400 9.5px/1.9 ${MONO}`,
              letterSpacing: ".22em",
              color: "rgba(242,241,238,.82)",
            }}
          >
            {t.caption[0]}
            <br />
            {t.caption[1]}
          </div>
        </div>
      </div>
    </section>
  );
}
