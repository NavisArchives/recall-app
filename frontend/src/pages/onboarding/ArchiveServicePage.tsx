import { useNavigate } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import { LangToggle } from "@/components/login/LangToggle";
import { SiteMenu } from "@/components/public/SiteMenu";
import { Wordmark } from "@/components/Wordmark";
import { PublicFooter } from "@/components/public/PublicFooter";
import "./site.css";

/**
 * The Archive Service — "Recall Archive Service v2.dc.html" (Claude Design
 * project 6d67cd0d, 18 Sep 2026), rebuilt screen for screen.
 *
 * Six screens: a dark hero, the session, what we do, what you get, the price,
 * the footer. The argument is the same one the owner wrote out by hand a day
 * earlier — a photograph outlives the memory of it, so scanning alone
 * preserves half of what a family thinks it is preserving — but the design
 * tells it with pictures rather than paragraphs, and that is the change. The
 * long prose version of this page is gone; every section now shows the thing
 * it is describing.
 *
 * THE DARK BANDS ARE THE LANDING PAGE'S OWN DEVICE, not a theme. Three
 * screens sit on near-black with a heavily blurred photograph and two angled
 * gradients over it, exactly as the landing hero and the sign-in door do. The
 * owner's rule that no public page carries a dark *theme* is about family
 * colour schemes following you around the public site; it has never meant the
 * site cannot have a dark band, and this design has three.
 *
 * WHAT IS DRAWN, NOT LIVE. The scan card with its tagged hotspots, the
 * workstation window, the pile of loose photographs and the finished archive
 * are all pictures of the product, built from the same photographs the rest of
 * the site uses. Nothing here reads a database — this is a page a stranger
 * sees before they have an archive at all.
 *
 * TWO PLACES WHERE THE DESIGN AND THE PRODUCT DISAGREE, and the product wins:
 *
 *   - The design's footer hard-codes a hard-coded address and "EN / NL". The real
 *     footer is the shared `PublicFooter`, which reads lib/seller.ts — the
 *     address there is hello@example.com — and the site speaks three
 *     languages, not two. Shipping a contact address the company does not own
 *     onto a live commercial page is not a design decision to honour.
 *   - The design's nav links to other .dc.html files. Here they are routes.
 *
 * The design also drops two lines the owner's own copy carried in its included
 * list — one month of Recall, and no setup fee on the digital configuration.
 * They are not re-added here: this is the design, and those are money
 * promises, so putting them back is the owner's call and not a builder's.
 */

/* The design's own palette. `#FBF8F1` is the one value site.css has no token
   for — the near-white a printed photograph is mounted on. */
const INK = "#131110";
const CARD = "#FBF8F1";
const SLOT = "#E8E2D2";
const RED = "#C13B22";
const AMBER = "#E29A68";
const CREAM = "#F2F1EE";

const PHOTO = {
  hero: "/site/sea-view.jpg",
  work: "/site/her-painting.jpg",
  scan: "/site/sunflower-wall.jpg",
  window: "/site/room-terracotta.jpg",
  holiday: "/site/sicily.jpg",
} as const;

const COPY = {
  fr: {
    navHow: "Comment ça marche",
    navService: "Service d’archivage",
    navPricing: "Prix",
    navSignIn: "Se connecter",
    tagline: "Une archive vivante",

    eyebrow: "SERVICE D’ARCHIVAGE",
    title: "Les photographies ne sont que la moitié de l’histoire",
    survives: "Une photographie peut traverser cent ans.",
    questions: [
      "Mais qui était là ?",
      "Où a-t-elle été prise ?",
      "Pourquoi riaient-ils tous ?",
      "Qui est le petit garçon dans le coin ?",
    ],
    disappear: "Ce sont ces choses-là qui disparaissent en premier.",
    forever: "Nous vous aiderons à les faire durer pour toujours.",
    book: "Réserver une séance",
    whoIsShe: "qui est-elle ?",
    unknown: "INCONNUE",

    s1Label: "01 · UNE SÉANCE D’ARCHIVAGE PERSONNELLE",
    s1Title: "Nous venons à vous.",
    s1Body:
      "Vous n’avez rien à trier, nulle part où aller, et personne à qui confier vos photographies. Nous apportons le matériel et passons une demi-journée à votre table, à votre rythme.",
    s1Steps: ["NOUS VENONS CHEZ VOUS.", "NOUS PARLONS ET NOUS NOTONS.", "ET NOUS PRÉSERVONS CE DONT VOUS VOUS SOUVENEZ."],

    scan: "SCAN 041",
    tagged4: "4 DÉTAILS NOTÉS",
    tagged3: "3 DÉTAILS NOTÉS",
    kPerson: "PERSONNE",
    kPlace: "LIEU",
    kDate: "DATE",
    kStory: "HISTOIRE",
    qSister: "« C’est ma sœur. »",
    qSeafront: "« Sur la digue à Ostende. »",
    qSummer82: "« L’été 1982. »",
    qCousin: "« Le garçon au ballon, c’est son cousin Thomas. »",
    qSpain: "« L’été où nous sommes allés en Espagne. »",

    s2Label: "02 · CE QUE NOUS FAISONS",
    s2Title: "Nous transformons vos souvenirs en archive.",
    flowA: ["NUMÉRISER", "PRÉSERVER", "CONSTRUIRE"],
    workstation: "recall · poste d’archivage",
    recording: "ENREGISTREMENT",
    tagging: "SCAN 041 · ANNOTATION",
    count: "041 / 412",
    vPerson: "Rosa — sa sœur",
    vPlace: "Ostende, la digue",
    vDate: "Juillet 1982",
    listening: "à l’écoute…",
    elapsed: "0:42",
    heard: "« Le garçon au ballon, c’est son cousin Thomas… »",
    does: [
      ["NUMÉRISER —", "les photographies qui comptent, chez vous"],
      ["PRÉSERVER —", "les noms, les dates, les lieux et les histoires"],
      ["CONSTRUIRE —", "une seule archive Recall personnelle"],
    ],

    s3Label: "03 · CE QUE VOUS RECEVEZ",
    s3TitleA: "Une seule archive,",
    s3TitleB: "à vous pour toujours.",
    s3Body:
      "Tout ce qui était éparpillé sur une vie devient une archive que vous gardez sous forme de fichiers ordinaires. Pas d’application, pas de compte, rien à renouveler.",
    comesIn: "CE QUI ENTRE",
    youReceive: "CE QUE VOUS RECEVEZ",
    piles: ["PERSONNES", "LIEUX", "DATES", "SOUVENIRS"],
    flowB: ["NUMÉRISÉ", "ANNOTÉ", "PRÉSERVÉ"],
    driveName: "archive-peeters-2026 / accueil",
    month: "SEPTEMBRE 2026",
    archiveTitle: "L’archive de votre famille",
    archiveSub: "huit canaux · s’ouvre dans n’importe quel navigateur",
    channels: ["Famille", "Vacances", "La maison", "Voix"],
    counts: "412 PHOTOGRAPHIES · 14 ENREGISTREMENTS",
    noInternet: "AUCUNE CONNEXION NÉCESSAIRE",
    driveNote: [
      "UN PETIT SITE HORS LIGNE SUR UN DISQUE — ET LES FICHIERS BRUTS",
      "À VOUS DÉFINITIVEMENT · RIEN À RENOUVELER",
    ],

    s4Label: "COMMENÇONS",
    s4Title: "Que l’histoire continue",
    pricing: "PRIX",
    price: "€450",
    once: "UNE SEULE FOIS",
    priceNote: "Une demi-journée à domicile · jusqu’à 500 photographies",
    included: "CE QUI EST COMPRIS",
    includes: [
      ["VISITE À DOMICILE", "Nous venons chez vous."],
      ["JUSQU’À 500 PHOTOGRAPHIES", "Numérisées et organisées."],
      ["PRÉSERVATION DES HISTOIRES", "Noms, lieux, dates et souvenirs recueillis."],
      ["MISE EN FORME PERSONNELLE", "Nous transformons la matière en archive structurée."],
      ["VOS ORIGINAUX RESTENT CHEZ VOUS", "Rien ne doit quitter la maison — nous apportons le matériel."],
      ["VOTRE ARCHIVE, À VOUS", "Vous recevez un export complet de l’archive."],
    ],
  },

  nl: {
    navHow: "Zo werkt het",
    navService: "Archiefdienst",
    navPricing: "Prijzen",
    navSignIn: "Inloggen",
    tagline: "Een levend archief",

    eyebrow: "ARCHIEFDIENST",
    title: "De foto’s zijn maar de helft van het verhaal",
    survives: "Een foto kan honderd jaar meegaan.",
    questions: [
      "Maar wie was erbij?",
      "Waar is ze genomen?",
      "Waarom lachte iedereen?",
      "Wie is dat jongetje in de hoek?",
    ],
    disappear: "Dat zijn de dingen die het eerst verdwijnen.",
    forever: "Wij helpen je ze voorgoed te bewaren.",
    book: "Boek een sessie",
    whoIsShe: "wie is zij?",
    unknown: "ONBEKEND",

    s1Label: "01 · EEN PERSOONLIJKE ARCHIEFSESSIE",
    s1Title: "Wij komen naar jou.",
    s1Body:
      "Je hoeft niets uit te zoeken, nergens naartoe, en je foto’s aan niemand af te geven. Wij brengen de apparatuur mee en nemen een halve dag aan jouw tafel, op jouw tempo.",
    s1Steps: ["WIJ KOMEN LANGS.", "WIJ PRATEN EN NOTEREN.", "EN WIJ BEWAREN WAT JIJ JE NOG HERINNERT."],

    scan: "SCAN 041",
    tagged4: "4 DETAILS GENOTEERD",
    tagged3: "3 DETAILS GENOTEERD",
    kPerson: "PERSOON",
    kPlace: "PLAATS",
    kDate: "DATUM",
    kStory: "VERHAAL",
    qSister: "“Dat is mijn zus.”",
    qSeafront: "“Op de zeedijk in Oostende.”",
    qSummer82: "“De zomer van 1982.”",
    qCousin: "“De jongen met de bal is haar neef Thomas.”",
    qSpain: "“De zomer dat we naar Spanje gingen.”",

    s2Label: "02 · WAT WIJ DOEN",
    s2Title: "Wij maken van wat jij je herinnert een archief.",
    flowA: ["DIGITALISEREN", "BEWAREN", "BOUWEN"],
    workstation: "recall · archiefwerkplek",
    recording: "OPNAME",
    tagging: "SCAN 041 · NOTEREN",
    count: "041 / 412",
    vPerson: "Rosa — haar zus",
    vPlace: "Oostende, de zeedijk",
    vDate: "Juli 1982",
    listening: "luistert…",
    elapsed: "0:42",
    heard: "“De jongen met de bal is haar neef Thomas…”",
    does: [
      ["DIGITALISEREN —", "de foto’s die ertoe doen, bij jou thuis"],
      ["BEWAREN —", "namen, data, plaatsen en verhalen"],
      ["BOUWEN —", "één persoonlijk Recall-archief"],
    ],

    s3Label: "03 · WAT JE KRIJGT",
    s3TitleA: "Eén archief,",
    s3TitleB: "en voorgoed van jou.",
    s3Body:
      "Alles wat over een heel leven verspreid raakte wordt één archief dat je als gewone bestanden houdt. Geen app, geen account, niets te verlengen.",
    comesIn: "WAT ERIN GAAT",
    youReceive: "WAT JE KRIJGT",
    piles: ["MENSEN", "PLAATSEN", "DATA", "HERINNERINGEN"],
    flowB: ["GEDIGITALISEERD", "GENOTEERD", "BEWAARD"],
    driveName: "archief-peeters-2026 / start",
    month: "SEPTEMBER 2026",
    archiveTitle: "Het archief van je familie",
    archiveSub: "acht kanalen · opent in elke browser",
    channels: ["Familie", "Vakanties", "Het huis", "Stemmen"],
    counts: "412 FOTO’S · 14 OPNAMES",
    noInternet: "GEEN INTERNET NODIG",
    driveNote: [
      "EEN KLEINE OFFLINE WEBSITE OP EEN SCHIJF — PLUS DE GEWONE BESTANDEN",
      "VOORGOED VAN JOU · NIETS TE VERLENGEN",
    ],

    s4Label: "LATEN WE BEGINNEN",
    s4Title: "Laat het verhaal verdergaan",
    pricing: "PRIJS",
    price: "€450",
    once: "EENMALIG",
    priceNote: "Een halve dag bij jou thuis · tot 500 foto’s",
    included: "WAT INBEGREPEN IS",
    includes: [
      ["HUISBEZOEK", "Wij komen naar jou."],
      ["TOT 500 FOTO’S", "Gedigitaliseerd en geordend."],
      ["VERHALEN BEWAARD", "Namen, plaatsen, data en herinneringen vastgelegd."],
      ["PERSOONLIJKE ORDENING", "Wij maken van het materiaal een gestructureerd archief."],
      ["JE ORIGINELEN BLIJVEN BIJ JOU", "Niets hoeft het huis te verlaten — wij brengen de apparatuur."],
      ["JE ARCHIEF, VAN JOU", "Je krijgt een volledige export van het archief."],
    ],
  },

  en: {
    navHow: "How it works",
    navService: "Archive service",
    navPricing: "Pricing",
    navSignIn: "Sign in",
    tagline: "A living archive",

    eyebrow: "ARCHIVE SERVICE",
    title: "The photographs are only half the story",
    survives: "A photograph can survive for a hundred years.",
    questions: [
      "But who was there?",
      "Where was it taken?",
      "Why was everyone laughing?",
      "Who is the little boy standing in the corner?",
    ],
    disappear: "Those are the things that disappear first.",
    forever: "We will help you make them last forever.",
    book: "Book a session",
    whoIsShe: "who is she?",
    unknown: "UNKNOWN",

    s1Label: "01 · A PERSONAL ARCHIVE SESSION",
    s1Title: "We come to you.",
    s1Body:
      "You don’t need to sort anything first, travel anywhere, or hand your photographs to a stranger. We bring the equipment and spend a half-day at your table, at your pace.",
    s1Steps: ["WE COME OVER.", "WE TALK AND TAG.", "AND WE PRESERVE WHAT YOU STILL REMEMBER."],

    scan: "SCAN 041",
    tagged4: "4 DETAILS TAGGED",
    tagged3: "3 DETAILS TAGGED",
    kPerson: "PERSON",
    kPlace: "PLACE",
    kDate: "DATE",
    kStory: "STORY",
    qSister: "“That’s my sister.”",
    qSeafront: "“On the seafront in Ostend.”",
    qSummer82: "“The summer of 1982.”",
    qCousin: "“The boy with the ball is her cousin Thomas.”",
    qSpain: "“The summer we went to Spain.”",

    s2Label: "02 · WHAT WE DO",
    s2Title: "We turn what you remember into an archive.",
    flowA: ["DIGITISE", "PRESERVE", "BUILD"],
    workstation: "recall · archive workstation",
    recording: "RECORDING",
    tagging: "SCAN 041 · TAGGING",
    count: "041 / 412",
    vPerson: "Rosa — her sister",
    vPlace: "Ostend, the seafront",
    vDate: "July 1982",
    listening: "listening…",
    elapsed: "0:42",
    heard: "“The boy with the ball is her cousin Thomas…”",
    does: [
      ["DIGITISE —", "the photographs that matter, in your home"],
      ["PRESERVE —", "names, dates, places and stories"],
      ["BUILD —", "one personal Recall archive"],
    ],

    s3Label: "03 · WHAT YOU GET",
    s3TitleA: "One archive build,",
    s3TitleB: "and yours forever.",
    s3Body:
      "Everything scattered across a lifetime becomes one archive you keep as ordinary files. No app, no account, nothing to renew.",
    comesIn: "WHAT COMES IN",
    youReceive: "WHAT YOU RECEIVE",
    piles: ["PEOPLE", "PLACES", "DATES", "MEMORIES"],
    flowB: ["DIGITISED", "TAGGED", "PRESERVED"],
    driveName: "archief-peeters-2026 / home",
    month: "SEPTEMBER 2026",
    archiveTitle: "The archive of your family",
    archiveSub: "eight channels · opens in any browser",
    channels: ["Family", "Holidays", "The house", "Voices"],
    counts: "412 PHOTOGRAPHS · 14 RECORDINGS",
    noInternet: "NO INTERNET NEEDED",
    driveNote: [
      "A SMALL OFFLINE WEBSITE ON A DRIVE — PLUS THE PLAIN FILES",
      "YOURS PERMANENTLY · NOTHING TO RENEW",
    ],

    s4Label: "LET’S GET STARTED",
    s4Title: "Let the story live on",
    pricing: "PRICING",
    price: "€450",
    once: "ONE TIME",
    priceNote: "A half-day at home · up to 500 photographs",
    included: "WHAT’S INCLUDED",
    includes: [
      ["HOME VISIT", "We come to you."],
      ["UP TO 500 PHOTOGRAPHS", "Digitised and organised."],
      ["STORY PRESERVATION", "Names, places, dates and memories captured."],
      ["PERSONAL CURATION", "We turn the material into a structured archive."],
      ["YOUR ORIGINALS STAY WITH YOU", "Nothing needs to leave the home — we bring the equipment to you."],
      ["YOUR ARCHIVE, YOURS TO KEEP", "You receive an export of the complete archive."],
    ],
  },
} as const;

/* ── the pieces the design repeats ──────────────────────────────────────── */

const MONO = "'Roboto Mono', ui-monospace, monospace";
const SERIF = "'Cormorant Garamond', Georgia, serif";

/** The blurred photograph and its two gradients — the site's dark ground. */
function Ground({ src, angle = 198, top = 0.5 }: { src: string; angle?: number; top?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(118deg, rgba(200,121,65,.3) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
        }}
      />
      <img
        src={src}
        alt=""
        className="absolute block h-[112%] w-[112%] object-cover"
        style={{ inset: "-6%", filter: "blur(40px) saturate(1.05)", transform: "scale(1.08)" }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${angle}deg, rgba(19,17,16,${top}) 0%, rgba(19,17,16,.92) 84%)`,
        }}
      />
    </div>
  );
}

/** A red dot with a soft ring — one thing the session noticed in a photograph. */
function Hotspot({ left, top }: { left: string; top: string }) {
  return (
    <span
      aria-hidden
      className="absolute z-[2] block h-[11px] w-[11px] rounded-full"
      style={{ left, top, margin: "-5.5px 0 0 -5.5px", background: RED, boxShadow: `0 0 0 4px rgba(193,59,34,.2)` }}
    />
  );
}

/** A mounted photograph with a caption strip — the design's scan card. */
function Scan({
  src,
  left,
  right,
  hotspots = [],
  className,
  style,
}: {
  src: string;
  left: string;
  right: string;
  hotspots?: { left: string; top: string }[];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: CARD,
        border: "1px solid rgba(20,19,15,.12)",
        borderRadius: 5,
        padding: 10,
        boxShadow: "0 28px 60px rgba(11,11,12,.5)",
        ...style,
      }}
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: "4 / 3", background: SLOT }}>
        <img src={src} alt="" className="block h-full w-full object-cover" />
        {hotspots.map((h) => (
          <Hotspot key={`${h.left}${h.top}`} {...h} />
        ))}
      </div>
      <div
        className="flex items-center justify-between gap-2.5"
        style={{ padding: "11px 3px 2px", font: `400 9px/1 ${MONO}`, letterSpacing: ".16em", color: "rgba(20,19,15,.6)" }}
      >
        <span>{left}</span>
        <span style={{ color: RED }}>{right}</span>
      </div>
    </div>
  );
}

/** A labelled thing somebody said, on paper. */
function Said({ label, quote, style }: { label: string; quote: string; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: CARD,
        border: "1px solid rgba(20,19,15,0.16)",
        borderRadius: 10,
        padding: "12px 15px",
        boxShadow: "0 12px 28px rgba(20,19,15,.12)",
        ...style,
      }}
    >
      <span className="block" style={{ font: `500 9px/1 ${MONO}`, letterSpacing: ".2em", color: RED }}>
        {label}
      </span>
      <span
        className="mt-[7px] block"
        style={{ font: `italic 500 clamp(14px,1.4vw,17px)/1.3 ${SERIF}`, color: "rgba(20,19,15,0.88)" }}
      >
        {quote}
      </span>
    </div>
  );
}

/** The arrow-and-verbs hinge the design puts between two panels. */
function Flow({ words, colour }: { words: readonly string[]; colour: string }) {
  return (
    <div className="s-svc-arrow flex flex-col items-center justify-center gap-2.5">
      <svg width="46" height="14" viewBox="0 0 46 14" fill="none" stroke={colour} strokeWidth="1.4" aria-hidden>
        <path d="M0 7h40M36 3l4 4-4 4" />
      </svg>
      <span style={{ font: `500 9.5px/1.7 ${MONO}`, letterSpacing: ".16em", color: colour, textAlign: "center" }}>
        {words.map((w) => (
          <span key={w} className="block">
            {w}
          </span>
        ))}
      </span>
    </div>
  );
}

/** A recorder's level meter. Fixed bars — it is a drawing, not a signal. */
const BARS = [3, 15, 14, 5, 15, 12, 7, 16, 11, 9, 16, 9, 11, 16, 7, 12, 15, 5, 14, 15, 3, 15, 13, 5, 15, 12];

function Waveform({ lit, on, off }: { lit: number; on: string; off: string }) {
  return (
    <span aria-hidden className="flex items-center gap-[2px]">
      {BARS.map((h, i) => (
        <span
          key={i}
          className="block w-[2px] rounded-[1px]"
          style={{ height: h, background: i < lit ? on : off }}
        />
      ))}
    </span>
  );
}

/** One row of the workstation's tag list. */
function TagRow({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <div
      className="grid items-center gap-3.5"
      style={{ gridTemplateColumns: "82px minmax(0,1fr)", padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,.1)" }}
    >
      <span style={{ font: `500 9px/1 ${MONO}`, letterSpacing: ".18em", color: dim ? "rgba(242,241,238,0.42)" : AMBER }}>
        {label}
      </span>
      <span
        className="block"
        style={{
          padding: "8px 11px",
          borderRadius: 6,
          background: dim ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.08)",
          border: `1px solid rgba(255,255,255,${dim ? ".1" : ".18"})`,
          font: dim ? `400 13px/1.2 ${MONO}` : "400 13px/1.2 Roboto, sans-serif",
          color: dim ? "rgba(242,241,238,0.35)" : CREAM,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** A window's three dots and its title strip. */
function Chrome({ name, dark, right }: { name: string; dark: boolean; right?: React.ReactNode }) {
  const dot = dark ? ["rgba(255,255,255,.22)", "rgba(255,255,255,.16)"] : ["rgba(20,19,15,0.22)", "rgba(20,19,15,0.16)"];
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: "11px 14px",
        borderBottom: `1px solid rgba(${dark ? "255,255,255,.12" : "20,19,15,0.14"})`,
        background: dark ? "rgba(255,255,255,.05)" : "rgba(20,19,15,.04)",
      }}
    >
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot[0] }} />
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot[1] }} />
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot[1] }} />
      <span
        className="ml-2 truncate"
        style={{
          font: `400 9.5px/1 ${MONO}`,
          letterSpacing: ".1em",
          color: dark ? "rgba(242,241,238,0.66)" : "rgba(20,19,15,0.6)",
        }}
      >
        {name}
      </span>
      {right && <span className="ml-auto flex flex-none items-center gap-1.5">{right}</span>}
    </div>
  );
}

/** A loose photograph or slip in the pile that arrives. */
function Loose({
  style,
  children,
}: {
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className="absolute box-border block"
      style={{
        background: CARD,
        border: "1px solid rgba(20,19,15,0.14)",
        borderRadius: 4,
        padding: 5,
        boxShadow: "0 10px 24px rgba(20,19,15,.14)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function LooseShot({ src, height }: { src: string; height: number }) {
  return (
    <span className="block overflow-hidden" style={{ height, background: SLOT }}>
      <img src={src} alt="" className="block h-full w-full object-cover" />
    </span>
  );
}

function LooseNote() {
  return (
    <span className="flex flex-col gap-1" style={{ padding: "8px 7px", background: "#fff" }}>
      {[100, 82, 92, 60, 74].map((w, i) => (
        <span key={i} className="block h-[2px]" style={{ width: `${w}%`, background: "rgba(20,19,15,0.2)" }} />
      ))}
    </span>
  );
}

function LooseTape() {
  return (
    <span className="flex items-center gap-1.5" style={{ height: 26, padding: "0 7px", background: "#fff" }}>
      <span className="h-3 w-3 flex-none rounded-full" style={{ background: RED }} />
      <Waveform lit={4} on={RED} off="rgba(20,19,15,0.3)" />
    </span>
  );
}

/** A word on a pill, dropped at an angle into the pile. */
function PilePill({ text, style }: { text: string; style: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      className="absolute whitespace-nowrap"
      style={{
        padding: "8px 13px",
        borderRadius: 999,
        background: CARD,
        border: "1px solid rgba(20,19,15,0.16)",
        boxShadow: "0 8px 20px rgba(20,19,15,.1)",
        font: `500 10px/1 ${MONO}`,
        letterSpacing: ".12em",
        color: "rgba(20,19,15,0.74)",
        ...style,
      }}
    >
      {text}
    </span>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

export function ArchiveServicePage() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];

  const book = () => navigate("/archive-service/book");

  const bookButton = (
    <button
      type="button"
      onClick={book}
      className="pressable inline-flex items-center gap-2.5"
      style={{
        padding: "15px 28px",
        borderRadius: 999,
        background: RED,
        font: "500 15px/1 Roboto, sans-serif",
        color: "#F7F3EB",
      }}
    >
      {t.book}
      <svg width="18" height="9" viewBox="0 0 22 10" fill="none" stroke="#F7F3EB" strokeWidth="1.4" aria-hidden>
        <path d="M0 5h20M16 1l4 4-4 4" />
      </svg>
    </button>
  );

  return (
    <div className="site scroll-thin h-full overflow-y-auto">
      {/* ── 01 · the hero ────────────────────────────────────────────── */}
      <div className="s-svc-screen relative flex flex-col overflow-hidden" style={{ background: INK, minHeight: "100vh" }}>
        <Ground src={PHOTO.hero} />

        {/*
          The landing page's bar, with routes instead of the design's links to
          other .dc.html files, and the shared language switch standing in the
          page's own corner exactly as it does on the front page.
        */}
        <div className="relative flex-none">
          <nav
            aria-label={t.navHow}
            className="s-wrap flex flex-wrap items-center justify-between gap-6"
            style={{ padding: "24px calc(var(--s-gutter) + 62px) 24px var(--s-gutter)" }}
          >
            <a href="/welcome" style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
              <Wordmark size={18} style={{ color: CREAM }} />
              <span style={{ font: "italic 300 12px/1 Roboto, sans-serif", color: "rgba(242,241,238,.7)" }}>
                {t.tagline}
              </span>
            </a>
            {/* Hidden below 900px, where SiteMenu's burger takes over (site.css). */}
            <div className="s-nav-desktop">
              <a href="/welcome#how" className="s-nav-link">
                {t.navHow}
              </a>
              {/* The page you are on is not a link. */}
              <span style={{ font: "400 14px/1 Roboto, sans-serif", color: AMBER }}>{t.navService}</span>
              <a href="/pricing" className="s-nav-link">
                {t.navPricing}
              </a>
              <button
                type="button"
                className="s-btn s-btn--ghost s-btn--nav"
                onClick={() => navigate("/login")}
              >
                {t.navSignIn}
              </button>
            </div>
          </nav>
          {/* Glass takes its tint from the text colour around it; on this
              dark band that has to be stated. */}
          <div className="s-nav-corner">
            <span className="s-nav-lang">
              <LangToggle />
            </span>
            <SiteMenu />
          </div>
        </div>

        <section className="relative flex flex-1 items-center">
          <div
            className="s-wrap s-svc-hero w-full"
            style={{ paddingTop: "clamp(16px,3.6vh,52px)", paddingBottom: "clamp(16px,3.6vh,52px)" }}
          >
            <div className="min-w-0">
              <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.eyebrow}</div>
              <h1
                style={{
                  margin: "clamp(14px,2vh,22px) 0 0",
                  font: "600 clamp(32px,4vw,56px)/1.08 Archivo, sans-serif",
                  letterSpacing: "-.02em",
                  color: CREAM,
                  maxWidth: "20ch",
                  textWrap: "pretty",
                }}
              >
                {t.title}
                <span className="s-dot" />
              </h1>
              <p
                style={{
                  margin: "clamp(14px,2vh,22px) 0 0",
                  font: "400 16px/1.6 Roboto, sans-serif",
                  color: "rgba(242,241,238,.72)",
                }}
              >
                {t.survives}
              </p>

              {/*
                The four questions, each on its own pill and each a shade
                quieter than the one before — the design's way of showing a
                memory fading rather than saying so.
              */}
              <div className="flex flex-wrap gap-[9px]" style={{ marginTop: "clamp(14px,2vh,22px)", maxWidth: "46ch" }}>
                {t.questions.map((q, i) => (
                  <span
                    key={q}
                    style={{
                      padding: "11px 18px",
                      borderRadius: 999,
                      background: `rgba(255,255,255,${[".08", ".07", ".06", ".05"][i]})`,
                      border: `1px solid rgba(255,255,255,${[".22", ".2", ".18", ".16"][i]})`,
                      font: `italic 500 clamp(15px,1.5vw,19px)/1 ${SERIF}`,
                      color: `rgba(242,241,238,${[1, 0.9, 0.82, 0.74][i]})`,
                    }}
                  >
                    {q}
                  </span>
                ))}
              </div>

              <p
                style={{
                  margin: "clamp(16px,2.4vh,26px) 0 0",
                  font: "500 16px/1.6 Roboto, sans-serif",
                  color: AMBER,
                  maxWidth: "34ch",
                }}
              >
                {t.disappear}
                <br />
                <span style={{ color: CREAM }}>{t.forever}</span>
              </p>

              <div style={{ marginTop: "clamp(18px,2.6vh,30px)" }}>{bookButton}</div>
            </div>

            {/* The photograph nobody can name yet. */}
            <div className="flex min-w-0 justify-center">
              <div
                className="relative"
                style={{
                  width: "min(100%, min(360px, 38vh))",
                  background: CARD,
                  border: "1px solid rgba(20,19,15,.12)",
                  borderRadius: 5,
                  padding: 12,
                  boxShadow: "0 40px 90px rgba(11,11,12,.55)",
                  transform: "rotate(-2deg)",
                }}
              >
                <div className="overflow-hidden" style={{ height: "min(384px, 42vh)", background: SLOT }}>
                  <img src={PHOTO.hero} alt="" className="block h-full w-full object-cover" />
                </div>
                <div
                  className="flex items-baseline justify-between gap-2.5"
                  style={{ padding: "12px 3px 2px" }}
                >
                  <span style={{ font: `italic 500 15px/1 ${SERIF}`, color: "rgba(20,19,15,.75)" }}>
                    {t.whoIsShe}
                  </span>
                  <span style={{ font: `400 9px/1 ${MONO}`, letterSpacing: ".16em", color: RED }}>{t.unknown}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── 02 · the session ─────────────────────────────────────────── */}
      <section className="s-wrap" style={{ paddingTop: "clamp(72px,8vw,120px)", paddingBottom: "clamp(72px,8vw,120px)" }}>
        <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: RED }}>{t.s1Label}</div>
        <h2 className="s-h2" style={{ maxWidth: "14ch" }}>
          {t.s1Title}
        </h2>

        <div
          className="s-svc-two"
          style={{ marginTop: "clamp(22px,2.6vw,34px)" }}
        >
          <div>
            <p
              style={{
                margin: "0 0 clamp(22px,2.6vw,32px)",
                paddingLeft: 25,
                font: "400 16px/1.7 Roboto, sans-serif",
                color: "rgba(20,19,15,0.72)",
                maxWidth: "40ch",
              }}
            >
              {t.s1Body}
            </p>

            {/* Three beats down a thread — the last one is the one that matters
                and it is the one that takes the red. */}
            {t.s1Steps.map((step, i) => {
              const last = i === t.s1Steps.length - 1;
              return (
                <div key={step} className="flex items-start gap-4">
                  <span aria-hidden className="flex flex-none flex-col items-center self-stretch">
                    <span
                      className="h-[9px] w-[9px] flex-none rounded-full"
                      style={{ background: last ? RED : "rgba(20,19,15,0.4)", marginTop: 3 }}
                    />
                    {!last && <span className="w-px flex-1" style={{ minHeight: 26, background: "rgba(20,19,15,0.2)" }} />}
                  </span>
                  <span
                    style={{
                      font: `500 12px/1 ${MONO}`,
                      letterSpacing: ".16em",
                      color: last ? RED : "rgba(20,19,15,0.84)",
                      paddingBottom: last ? 0 : 22,
                    }}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>

          {/*
            One scan, four things noticed about it, joined by lines. The lines
            are a `viewBox="0 0 100 100"` with `preserveAspectRatio="none"`, so
            they stretch with the box and stay attached to the percentages the
            hotspots and cards are placed at.
          */}
          <div className="s-svc-diagram">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
            >
              {[
                "M14 18 H44 V10 H52",
                "M30 28 H46 V34 H52",
                "M12 46 H42 V58 H52",
                "M34 52 H48 V82 H52",
              ].map((d) => (
                <path key={d} d={d} fill="none" stroke="rgba(20,19,15,0.26)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>

            <Scan
              src={PHOTO.scan}
              left={t.scan}
              right={t.tagged4}
              className="absolute z-[2]"
              style={{ left: 0, top: "4%", width: "44%", padding: 8, boxShadow: "0 20px 44px rgba(20,19,15,.18)" }}
            />

            {[
              { left: "14%", top: "18%" },
              { left: "30%", top: "28%" },
              { left: "12%", top: "46%" },
              { left: "34%", top: "52%" },
            ].map((h) => (
              <Hotspot key={h.top} {...h} />
            ))}

            {[
              { top: "10%", label: t.kPerson, quote: t.qSister },
              { top: "34%", label: t.kPlace, quote: t.qSeafront },
              { top: "58%", label: t.kDate, quote: t.qSummer82 },
              { top: "82%", label: t.kStory, quote: t.qCousin },
            ].map((c) => (
              <span key={c.top}>
                <span
                  aria-hidden
                  className="absolute z-[2] block h-1.5 w-1.5"
                  style={{ left: "52%", top: c.top, margin: "-3px 0 0 -3px", background: "rgba(20,19,15,0.34)" }}
                />
                <Said
                  label={c.label}
                  quote={c.quote}
                  style={{
                    position: "absolute",
                    left: "52%",
                    top: c.top,
                    transform: "translateY(-50%)",
                    width: "46%",
                    zIndex: 2,
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 03 · what we do ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ background: INK }}>
        <Ground src={PHOTO.work} angle={196} top={0.62} />
        <div className="s-wrap relative" style={{ paddingTop: "clamp(72px,8vw,120px)", paddingBottom: "clamp(72px,8vw,120px)" }}>
          <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.s2Label}</div>
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
            {t.s2Title}
          </h2>

          <div
            className="s-svc-flow"
            style={{ marginTop: "clamp(40px,4.5vw,64px)" }}
          >
            <div className="relative">
              <Scan
                src={PHOTO.hero}
                left={t.scan}
                right={t.tagged3}
                hotspots={[
                  { left: "26%", top: "30%" },
                  { left: "62%", top: "58%" },
                  { left: "40%", top: "78%" },
                ]}
                style={{ width: "100%" }}
              />
              <div className="mt-3.5 grid gap-2">
                {[
                  { k: t.kPerson, v: t.qSister, a: ".06", b: ".14", c: CREAM },
                  { k: t.kPlace, v: t.qSpain, a: ".05", b: ".12", c: "rgba(242,241,238,.9)" },
                ].map((row) => (
                  <span
                    key={row.k}
                    className="inline-flex items-baseline gap-2.5"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: `rgba(255,255,255,${row.a})`,
                      border: `1px solid rgba(255,255,255,${row.b})`,
                    }}
                  >
                    <span className="flex-none" style={{ font: `500 9px/1 ${MONO}`, letterSpacing: ".18em", color: AMBER }}>
                      {row.k}
                    </span>
                    <span style={{ font: `italic 500 15px/1.2 ${SERIF}`, color: row.c }}>{row.v}</span>
                  </span>
                ))}
              </div>
            </div>

            <Flow words={t.flowA} colour={AMBER} />

            <div>
              <div
                className="overflow-hidden"
                style={{
                  border: "1px solid rgba(255,255,255,.16)",
                  borderRadius: 14,
                  background: "rgba(11,11,12,.72)",
                  boxShadow: "0 28px 60px rgba(11,11,12,.5)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <Chrome
                  dark
                  name={t.workstation}
                  right={
                    <>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: RED }} />
                      <span style={{ font: `400 8.5px/1 ${MONO}`, letterSpacing: ".16em", color: AMBER }}>
                        {t.recording}
                      </span>
                    </>
                  }
                />
                <div style={{ padding: "clamp(16px,1.8vw,24px)" }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span style={{ font: `500 11px/1 ${MONO}`, letterSpacing: ".16em", color: CREAM }}>{t.tagging}</span>
                    <span style={{ font: `400 9.5px/1 ${MONO}`, letterSpacing: ".14em", color: "rgba(242,241,238,0.62)" }}>
                      {t.count}
                    </span>
                  </div>
                  <div className="mt-[11px] h-1 rounded-sm" style={{ background: "rgba(255,255,255,.14)" }}>
                    <div className="h-1 rounded-sm" style={{ width: "10%", background: AMBER }} />
                  </div>

                  <div className="mt-4">
                    <TagRow label={t.kPerson} value={t.vPerson} />
                    <TagRow label={t.kPlace} value={t.vPlace} />
                    <TagRow label={t.kDate} value={t.vDate} />
                    <TagRow label={t.kStory} value={t.listening} dim />
                  </div>

                  <div
                    className="mt-4 flex items-center gap-3"
                    style={{ paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.1)" }}
                  >
                    <Waveform lit={9} on={AMBER} off="rgba(242,241,238,0.22)" />
                    <span
                      className="ml-auto"
                      style={{ font: `400 9px/1 ${MONO}`, letterSpacing: ".14em", color: "rgba(242,241,238,0.6)" }}
                    >
                      {t.elapsed}
                    </span>
                  </div>
                  <div className="mt-[13px]" style={{ font: `italic 500 15px/1.4 ${SERIF}`, color: "rgba(242,241,238,0.82)" }}>
                    {t.heard}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2.5">
                {t.does.map(([verb, rest]) => (
                  <span key={verb} style={{ font: `500 10.5px/1 ${MONO}`, letterSpacing: ".18em", color: "rgba(242,241,238,0.86)" }}>
                    {verb} <span style={{ color: "rgba(242,241,238,0.66)" }}>{rest}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 · what you get ────────────────────────────────────────── */}
      <section className="s-wrap" style={{ paddingTop: "clamp(64px,7vw,104px)", paddingBottom: "clamp(64px,7vw,104px)" }}>
        <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: RED }}>{t.s3Label}</div>
        <div
          className="s-svc-head" style={{ marginTop: 20 }}
        >
          <h2
            style={{
              margin: 0,
              font: "600 clamp(30px,3.4vw,46px)/1.12 Archivo, sans-serif",
              letterSpacing: "-.02em",
              maxWidth: "18ch",
              textWrap: "pretty",
            }}
          >
            {t.s3TitleA}
            <br />
            {t.s3TitleB}
          </h2>
          <p style={{ margin: 0, font: "400 16px/1.7 Roboto, sans-serif", color: "rgba(20,19,15,0.72)", maxWidth: "42ch" }}>
            {t.s3Body}
          </p>
        </div>

        <div
          className="s-svc-flow s-svc-flow--wide"
          style={{ marginTop: "clamp(40px,4.5vw,64px)" }}
        >
          {/* The shoebox: photographs, tapes and slips of paper, at angles. */}
          <div>
            <div style={{ font: `500 10.5px/1 ${MONO}`, letterSpacing: ".2em", color: "rgba(20,19,15,0.6)" }}>
              {t.comesIn}
            </div>
            <div className="s-svc-pile mt-[18px]">
              <Loose style={{ left: "0%", top: "2%", transform: "rotate(-6deg)", width: 104 }}>
                <LooseShot src={PHOTO.scan} height={73} />
              </Loose>
              <Loose style={{ left: "48%", top: "0%", transform: "rotate(4deg)", opacity: 0.96, width: 118 }}>
                <LooseTape />
              </Loose>
              <Loose style={{ left: "26%", top: "16%", transform: "rotate(5deg)", opacity: 0.97, width: 92 }}>
                <LooseShot src={PHOTO.window} height={64} />
              </Loose>
              <Loose style={{ left: "64%", top: "20%", transform: "rotate(-5deg)", opacity: 0.94, width: 58 }}>
                <LooseNote />
              </Loose>
              <Loose style={{ left: "2%", top: "40%", transform: "rotate(4deg)", opacity: 0.92, width: 88 }}>
                <LooseShot src={PHOTO.hero} height={62} />
              </Loose>
              <Loose style={{ left: "30%", top: "44%", transform: "rotate(-4deg)", opacity: 0.88, width: 110 }}>
                <LooseTape />
              </Loose>
              <Loose style={{ left: "0%", top: "68%", transform: "rotate(6deg)", opacity: 0.8, width: 54 }}>
                <LooseNote />
              </Loose>
              <Loose style={{ left: "46%", top: "58%", transform: "rotate(-3deg)", opacity: 0.84, width: 86 }}>
                <LooseShot src={PHOTO.hero} height={60} />
              </Loose>

              <PilePill text={t.piles[0]} style={{ left: "22%", top: "74%", transform: "rotate(3deg)", opacity: 0.72 }} />
              <PilePill text={t.piles[1]} style={{ left: "48%", top: "84%", transform: "rotate(-4deg)", opacity: 0.64 }} />
              <PilePill text={t.piles[2]} style={{ left: "70%", top: "72%", transform: "rotate(5deg)", opacity: 0.58 }} />
              <PilePill text={t.piles[3]} style={{ left: "20%", top: "90%", transform: "rotate(-2deg)", opacity: 0.5 }} />
            </div>
          </div>

          <Flow words={t.flowB} colour={RED} />

          {/* The finished thing: an offline page on a drive, with its channels. */}
          <div>
            <div style={{ font: `500 10.5px/1 ${MONO}`, letterSpacing: ".2em", color: RED }}>{t.youReceive}</div>
            <div
              className="mt-[18px] overflow-hidden"
              style={{
                border: "1px solid rgba(20,19,15,0.2)",
                borderRadius: 14,
                background: CARD,
                boxShadow: "0 22px 50px rgba(20,19,15,.16)",
              }}
            >
              <Chrome dark={false} name={t.driveName} />
              <div style={{ padding: "clamp(18px,2vw,24px)" }}>
                <div className="flex items-baseline justify-between gap-3">
                  <Wordmark size={10} style={{ color: "rgba(20,19,15,0.8)" }} />
                  <span style={{ font: `400 8.5px/1 ${MONO}`, letterSpacing: ".16em", color: "rgba(20,19,15,0.6)" }}>
                    {t.month}
                  </span>
                </div>
                <div
                  className="mt-3.5"
                  style={{
                    font: "600 clamp(19px,1.9vw,24px)/1.15 Archivo, sans-serif",
                    letterSpacing: "-.02em",
                    color: "rgba(20,19,15,0.92)",
                  }}
                >
                  {t.archiveTitle}
                </div>
                <div className="mt-2" style={{ font: `italic 500 12.5px/1 ${SERIF}`, color: "rgba(20,19,15,0.66)" }}>
                  {t.archiveSub}
                </div>

                <div className="mt-[18px] grid gap-2.5" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
                  {[PHOTO.scan, PHOTO.holiday, PHOTO.hero, PHOTO.window].map((src, i) => (
                    <div key={src + i} className="flex flex-col">
                      <div className="overflow-hidden" style={{ aspectRatio: "4 / 3", background: SLOT }}>
                        <img src={src} alt="" className="block h-full w-full object-cover" />
                      </div>
                      <div
                        className="mt-[7px] flex items-baseline gap-[7px]"
                        style={{ paddingTop: 7, borderTop: "1px solid rgba(20,19,15,0.2)" }}
                      >
                        <span style={{ font: `500 13px/1 ${MONO}`, color: "rgba(20,19,15,0.9)" }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span
                          className="truncate"
                          style={{
                            font: "600 11.5px/1.2 Archivo, sans-serif",
                            letterSpacing: "-.005em",
                            color: "rgba(20,19,15,0.88)",
                          }}
                        >
                          {t.channels[i]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  className="mt-4 flex items-center justify-between gap-3"
                  style={{
                    paddingTop: 12,
                    borderTop: "1px solid rgba(20,19,15,0.14)",
                    font: `400 9px/1 ${MONO}`,
                    letterSpacing: ".14em",
                    color: "rgba(20,19,15,0.62)",
                  }}
                >
                  <span>{t.counts}</span>
                  <span style={{ color: RED }}>{t.noInternet}</span>
                </div>
              </div>
            </div>

            <div
              className="mt-3.5"
              style={{ font: `400 10.5px/1.9 ${MONO}`, letterSpacing: ".12em", color: "rgba(20,19,15,0.62)" }}
            >
              {t.driveNote[0]}
              <br />
              {t.driveNote[1]}
            </div>
          </div>
        </div>
      </section>

      {/* ── 05 · the price ───────────────────────────────────────────── */}
      <section id="book" className="relative overflow-hidden" style={{ background: INK }}>
        <Ground src={PHOTO.window} angle={190} top={0.62} />
        <div className="s-wrap relative" style={{ paddingTop: "clamp(72px,8vw,120px)", paddingBottom: "clamp(72px,8vw,120px)" }}>
          <div className="text-center">
            <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.s4Label}</div>
            <h2
              style={{
                margin: "20px 0 0",
                font: "600 clamp(24px,3vw,42px)/1.1 Archivo, sans-serif",
                letterSpacing: "-.02em",
                color: CREAM,
                textWrap: "balance",
              }}
            >
              {t.s4Title}
              <span className="s-dot" />
            </h2>
          </div>

          <div
            className="s-svc-price"
            style={{ marginTop: "clamp(44px,5vw,72px)" }}
          >
            <div style={{ paddingRight: "clamp(24px,4vw,56px)" }}>
              <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.pricing}</div>
              <div className="mt-[18px] flex items-baseline gap-3">
                <span
                  style={{
                    font: "600 clamp(48px,5.4vw,76px)/0.9 Archivo, sans-serif",
                    letterSpacing: "-.035em",
                    color: CREAM,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t.price}
                </span>
                <span style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".18em", color: "rgba(242,241,238,0.66)" }}>
                  {t.once}
                </span>
              </div>
              <p style={{ margin: "16px 0 0", font: "500 15.5px/1.6 Roboto, sans-serif", color: CREAM, maxWidth: "30ch" }}>
                {t.priceNote}
              </p>
            </div>

            <div
              className="s-price-list"
              style={{ paddingLeft: "clamp(24px,4vw,56px)", borderLeft: "1px solid rgba(255,255,255,.14)" }}
            >
              <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.included}</div>
              <div
                className="mt-5 grid"
                style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "20px 32px" }}
              >
                {t.includes.map(([name, body]) => (
                  <div key={name}>
                    <div style={{ font: `500 10.5px/1 ${MONO}`, letterSpacing: ".16em", color: "rgba(242,241,238,0.86)" }}>
                      {name}
                    </div>
                    <p style={{ margin: "7px 0 0", font: "400 14px/1.6 Roboto, sans-serif", color: "rgba(242,241,238,0.68)" }}>
                      {body}
                    </p>
                  </div>
                ))}
              </div>
              <div
                className="flex flex-col items-end text-right"
                style={{ marginTop: "clamp(28px,3vw,40px)" }}
              >
                {bookButton}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The site's own footer, not the design's — see the note at the top of
          this file about the address it hard-codes. */}
      <PublicFooter />
    </div>
  );
}
