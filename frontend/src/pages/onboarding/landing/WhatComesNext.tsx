import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang } from "@/lib/publicLang";

/**
 * What we are researching (26 Sep 2026): the "Level 2" research, told to
 * families. It lives on its own page, /research, linked from the footer and
 * from the "Does Recall use AI?" question on the landing page.
 *
 * WHY NOT ON THE LANDING PAGE. The landing page sells what exists. Three
 * standing rules keep research off it: person-facing answers are "never
 * demo-promised" (company doc 11), the display side is "a roadmap promise, do
 * not demo before built" (doc 20), and the vision is "never the front page"
 * (doc 09). Under the EU guidance on medical-device software (MDCG 2019-11),
 * promotional material also counts toward a product's intended purpose, so a
 * family-facing page must not read as a promise. Moving it onto the landing
 * page is the owner's call, in writing; the copy works unchanged in both
 * places.
 *
 * WHAT THE COPY REFUSES TO SAY. No date ("soon", "next"). No face: the screen
 * answers with the family's own photographs, and the section says outright
 * that there is no face and no relative's voice. No "AI": it describes an
 * archive that can be asked, and says it is a computer. "Not for sale" is in
 * the eyebrow, and the honesty line repeats it.
 *
 * WHY THE TELEPHONE LEADS WITH DIALLING. The first Recall telephone is a
 * number input: dial a channel's number and it plays, as the keypad does
 * today. The conversation is the research, and it stays inside the channel
 * she dialled, so every answer traces to something the family put there.
 * That is also how this reconciles with the 2024 tests, where two
 * command-based voice assistants failed our first user and familiar keys
 * worked.
 */

const COPY = {
  fr: {
    eyebrow: "RECHERCHE · PAS EN VENTE",
    title: "Ce que nous étudions : une archive à qui l’on peut poser des questions.",
    lead: "Tout ce que la famille ajoute reste exactement tel qu’elle l’a écrit. Avec des partenaires de soins, nous étudions si la personne pourrait aussi poser une question à son archive : avec des objets qu’elle connaît déjà, à son propre rythme, et uniquement à partir de sa propre archive.",
    objects: [
      {
        kind: "phone",
        who: "LE TÉLÉPHONE",
        claim: "Décrocher. Composer. Demander.",
        body: "Composez le numéro d’une chaîne et elle s’ouvre, comme aujourd’hui. Posez une question, et la réponse vient uniquement de ce que la famille a enregistré, une fois que la personne a fini de parler.",
      },
      {
        kind: "screen",
        who: "L’ÉCRAN",
        claim: "Demander, et ses propres photos apparaissent.",
        body: "Une réponse avec les photos que la famille a ajoutées, sur l’écran qu’elle utilise déjà. Pas de visage, pas de voix d’un proche : il dit toujours qu’il est un ordinateur.",
      },
      {
        kind: "radio",
        who: "LA RADIO",
        claim: "Tourner le bouton. Écouter son propre passé.",
        body: "Des récits tirés de sa propre archive, dans les voix que la famille a enregistrées. La famille approuve chaque récit avant sa diffusion.",
      },
    ],
    principles: [
      "AUCUNE COMMANDE À RETENIR",
      "UNIQUEMENT SA PROPRE ARCHIVE",
      "À SON PROPRE RYTHME",
      "CHAQUE FAMILLE GARDÉE À PART",
      "IL DIT TOUJOURS QU’IL EST UN ORDINATEUR",
    ],
    note: "C’est de la recherche, pas un produit que nous vendons, et cela ne change rien à ce que vous achetez aujourd’hui.",
    invite: "Votre famille aimerait participer à la recherche ? Parlons-en.",
  },
  nl: {
    eyebrow: "ONDERZOEK · NIET TE KOOP",
    title: "Wat we onderzoeken: een archief dat je iets kunt vragen.",
    lead: "Alles wat de familie toevoegt, blijft precies zoals ze het schreven. Samen met zorgpartners onderzoeken we of de persoon het archief ook iets zou kunnen vragen: met voorwerpen die ze al kennen, op hun eigen tempo, en alleen vanuit hun eigen archief.",
    objects: [
      {
        kind: "phone",
        who: "DE TELEFOON",
        claim: "De hoorn opnemen. Een nummer draaien. Iets vragen.",
        body: "Draai het nummer van een kanaal en het speelt, zoals nu. Vraag er iets over, en het antwoord komt alleen uit wat de familie opnam, pas als ze uitgesproken zijn.",
      },
      {
        kind: "screen",
        who: "HET SCHERM",
        claim: "Iets vragen, en hun eigen foto’s verschijnen.",
        body: "Een antwoord met de foto’s die de familie toevoegde, op het scherm dat ze al gebruiken. Geen gezicht en geen stem van een familielid: het zegt altijd dat het een computer is.",
      },
      {
        kind: "radio",
        who: "DE RADIO",
        claim: "Aan de knop draaien. Hun eigen verleden horen.",
        body: "Verhalen uit hun eigen archief, in de stemmen die de familie opnam. De familie keurt elk verhaal goed voor het speelt.",
      },
    ],
    principles: [
      "GEEN COMMANDO’S OM TE ONTHOUDEN",
      "ALLEEN HUN EIGEN ARCHIEF",
      "OP HUN EIGEN TEMPO",
      "ELKE FAMILIE APART BEWAARD",
      "HET ZEGT ALTIJD DAT HET EEN COMPUTER IS",
    ],
    note: "Dit is onderzoek, geen product dat we verkopen, en het verandert niets aan wat je vandaag koopt.",
    invite: "Wil je familie meewerken aan het onderzoek? Neem contact met ons op.",
  },
  en: {
    eyebrow: "RESEARCH · NOT FOR SALE",
    title: "What we are researching: an archive you can ask.",
    lead: "Everything the family adds stays exactly as they wrote it. With care partners, we are studying whether the person could also ask their archive a question: through objects they already know, at their own pace, and only from their own archive.",
    objects: [
      {
        kind: "phone",
        who: "THE TELEPHONE",
        claim: "Lift the handset. Dial. Ask.",
        body: "Dial a channel’s number and it plays, as it does today. Ask about it, and the answer comes only from what the family recorded, once they have finished speaking.",
      },
      {
        kind: "screen",
        who: "THE SCREEN",
        claim: "Ask, and their own photographs appear.",
        body: "An answer shown with the photographs the family added, on the screen they already use. No face and no relative’s voice: it always says it is a computer.",
      },
      {
        kind: "radio",
        who: "THE RADIO",
        claim: "Turn the dial. Hear their own past.",
        body: "Stories from their own archive, in the voices the family recorded. The family approves every story before it plays.",
      },
    ],
    principles: [
      "NO COMMANDS TO REMEMBER",
      "ONLY THEIR OWN ARCHIVE",
      "AT THEIR OWN PACE",
      "EVERY FAMILY KEPT APART",
      "IT ALWAYS SAYS IT IS A COMPUTER",
    ],
    note: "This is research, not something we sell, and it changes nothing about what you buy today.",
    invite: "Would your family like to take part in the research? Talk to us.",
  },
} as const;

type Kind = (typeof COPY)["en"]["objects"][number]["kind"];

const INK = "#14130F";
const RED = "#C13B22";
const MONO = "'Roboto Mono', monospace";

/**
 * The three objects, drawn the way the rest of the site draws product: a
 * picture of the thing, one red mark, never a photograph of a device that
 * does not exist yet. The screen shows a photograph in a frame, not a head:
 * the answer is her own pictures.
 */
function ObjectDrawing({ kind }: { kind: Kind }) {
  const common = {
    viewBox: "0 0 240 180",
    fill: "none",
    stroke: INK,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    style: { width: "100%", height: "auto", maxHeight: 200, display: "block", margin: "0 auto" },
  };

  const drawings: Record<Kind, ReactNode> = {
    phone: (
      <svg {...common}>
        <path d="M58 150 L74 84 Q76 78 82 78 L158 78 Q164 78 166 84 L182 150 Q183 156 177 156 L63 156 Q57 156 58 150 Z" />
        <path d="M84 78 L84 70 M156 78 L156 70" />
        <path d="M60 58 Q58 44 72 42 L92 40 Q100 40 100 48 L100 50 Q100 54 104 54 L136 54 Q140 54 140 50 L140 48 Q140 40 148 40 L168 42 Q182 44 180 58 Q179 66 170 66 L152 66 Q146 66 146 60 L146 58 L94 58 L94 60 Q94 66 88 66 L70 66 Q61 66 60 58 Z" />
        <circle cx="120" cy="118" r="27" />
        <circle cx="120" cy="118" r="10" />
        <g strokeWidth={1.3}>
          <circle cx="120" cy="99" r="4.2" />
          <circle cx="133.4" cy="104.6" r="4.2" />
          <circle cx="139" cy="118" r="4.2" />
          <circle cx="133.4" cy="131.4" r="4.2" />
          <circle cx="120" cy="137" r="4.2" />
          <circle cx="106.6" cy="131.4" r="4.2" />
          <circle cx="101" cy="118" r="4.2" />
          <circle cx="106.6" cy="104.6" r="4.2" />
        </g>
        <path d="M143 136 L150 142" strokeWidth={1.8} />
        <circle cx="120" cy="118" r="3.2" fill={RED} stroke="none" />
        <path d="M182 146 Q200 146 200 130 Q200 118 192 116 Q186 115 188 108 Q190 100 184 98" strokeWidth={1.2} />
      </svg>
    ),
    screen: (
      <svg {...common}>
        <rect x="44" y="22" width="152" height="98" rx="4" />
        <rect x="50" y="28" width="140" height="86" rx="2" strokeWidth={1} />
        {/* a photograph in a white-bordered print, a little tilted */}
        <g transform="rotate(-3 120 70)">
          <rect x="86" y="40" width="68" height="56" rx="1.5" />
          <rect x="91" y="45" width="58" height="40" strokeWidth={1.1} />
          <path d="M92 83 L108 66 L118 75 L128 64 L148 83" strokeWidth={1.2} />
          <circle cx="137" cy="54" r="3.4" fill={RED} stroke="none" />
        </g>
        <path d="M112 120 L110 132 M128 120 L130 132" />
        <rect x="52" y="132" width="136" height="22" rx="6" />
        <rect x="64" y="137" width="34" height="12" rx="2" strokeWidth={1.2} />
        <g strokeWidth={1.1}>
          <circle cx="152" cy="140" r="1.8" />
          <circle cx="160" cy="140" r="1.8" />
          <circle cx="168" cy="140" r="1.8" />
          <circle cx="152" cy="147" r="1.8" />
          <circle cx="160" cy="147" r="1.8" />
          <circle cx="168" cy="147" r="1.8" />
        </g>
      </svg>
    ),
    radio: (
      <svg {...common}>
        <path d="M40 150 L40 70 Q40 44 66 42 L174 42 Q200 44 200 70 L200 150 Q200 156 194 156 L46 156 Q40 156 40 150 Z" />
        <path d="M58 156 L58 164 M182 156 L182 164" />
        <rect x="54" y="60" width="72" height="80" rx="6" strokeWidth={1.3} />
        <path
          d="M60 70 L120 70 M60 78 L120 78 M60 86 L120 86 M60 94 L120 94 M60 102 L120 102 M60 110 L120 110 M60 118 L120 118 M60 126 L120 126 M60 134 L120 134"
          strokeWidth={1}
        />
        <rect x="138" y="60" width="50" height="34" rx="3" strokeWidth={1.3} />
        <path
          d="M144 84 L144 88 M150 82 L150 88 M156 84 L156 88 M162 82 L162 88 M168 84 L168 88 M174 82 L174 88 M180 84 L180 88"
          strokeWidth={1}
        />
        <path d="M166 64 L166 90" stroke={RED} strokeWidth={1.8} />
        <circle cx="150" cy="122" r="11" />
        <path d="M150 113 L150 118" />
        <circle cx="178" cy="122" r="11" />
        <path d="M186 116 L182 119" />
      </svg>
    ),
  };

  return <>{drawings[kind]}</>;
}

/**
 * `standalone` is the /research page: the section is the page's content, so
 * its title is the page heading and it carries no rule above it.
 */
export function WhatComesNext({ standalone = false }: { standalone?: boolean }) {
  const [lang] = useLang();
  const t = COPY[lang];
  const Heading = standalone ? "h1" : "h2";

  return (
    <section
      className={standalone ? "s-wrap" : "s-wrap s-rule"}
      style={{ paddingTop: standalone ? 36 : 90, paddingBottom: 90 }}
      aria-labelledby="research-title"
    >
      <div className="s-eyebrow">{t.eyebrow}</div>
      <Heading id="research-title" className="s-h2" style={{ maxWidth: "22ch" }}>
        {t.title}
      </Heading>
      <p className="s-lead" style={{ maxWidth: "62ch" }}>
        {t.lead}
      </p>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: "clamp(24px,3vw,48px)",
          marginTop: "clamp(36px,4vw,56px)",
        }}
      >
        {t.objects.map((o) => (
          <div key={o.kind} style={{ borderTop: "1.5px solid rgba(var(--s-ink),0.22)", paddingTop: 20 }}>
            <div style={{ background: "var(--s-card)", padding: "18px 22px", maxWidth: 360 }}>
              <ObjectDrawing kind={o.kind} />
            </div>
            <div
              style={{
                font: `400 10px/1 ${MONO}`,
                letterSpacing: ".2em",
                color: "rgba(var(--s-ink),0.68)",
                marginTop: 22,
              }}
            >
              {o.who}
            </div>
            <h3
              style={{
                margin: "12px 0 0",
                font: "600 clamp(20px,2vw,24px)/1.28 Archivo, sans-serif",
                letterSpacing: "-.01em",
                textWrap: "pretty",
              }}
            >
              {o.claim}
            </h3>
            <p
              style={{
                margin: "10px 0 0",
                font: "400 15px/1.65 Roboto, sans-serif",
                color: "rgba(var(--s-ink),0.72)",
                maxWidth: "36ch",
                textWrap: "pretty",
              }}
            >
              {o.body}
            </p>
          </div>
        ))}
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "clamp(36px,4vw,56px) 0 0",
          font: `400 11px/1.9 ${MONO}`,
          letterSpacing: ".14em",
          color: "rgba(var(--s-ink),0.6)",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "4px 22px",
        }}
      >
        {t.principles.map((p) => (
          <li key={p} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ flex: "none", width: 5, height: 5, borderRadius: "50%", background: RED }} />
            {p}
          </li>
        ))}
      </ul>

      <p
        style={{
          margin: "18px auto 0",
          font: "400 italic 14px/1.6 Roboto, sans-serif",
          color: "rgba(var(--s-ink),0.62)",
          maxWidth: "62ch",
          textAlign: "center",
          textWrap: "pretty",
        }}
      >
        {t.note}
      </p>
      <p style={{ margin: "10px 0 0", textAlign: "center", font: "500 14px/1.6 Roboto, sans-serif" }}>
        <Link to="/request" className="underline underline-offset-4">
          {t.invite}
        </Link>
      </p>
    </section>
  );
}
