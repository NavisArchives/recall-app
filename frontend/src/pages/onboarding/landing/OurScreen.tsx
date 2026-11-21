import { useLang } from "@/lib/publicLang";
import { SHELF } from "./archive";

/**
 * Section 07 — the family's side, from "Recall Website v3.dc.html".
 *
 * The counterpart to the section above it: her screen holds one photograph at
 * a time, and this is the room where that gets decided. A picture of the
 * workspace — the tab row, the shelf, the Add button — then four plain claims
 * about what the family can do from anywhere, and the privacy line.
 *
 * The shelf reads the shared `SHELF`, so the three channels here are the same
 * three the rest of the page names. In the design the third is "06 The wedding
 * day" while section 04 calls 06 something else; one archive, one 06.
 *
 * "SEE WHAT MATTERS" is deliberately the weakest claim on the page: it says
 * which channels get opened and revisited, not what she felt. Insights measure
 * visits, and a page that turns that into "we tell you what she loves" would
 * be selling something the product does not do.
 */

const COPY = {
  fr: {
    eyebrow: "LA FAMILLE LA FAIT VIVRE",
    title: "Ils voient la simplicité. Vous la faites vivre.",
    lead: "Tout ce qui est difficile se passe du côté de la famille, pour que le côté de la personne reste simple.",
    tabs: ["Aperçu", "Étagère", "Cartes", "Missions", "Analyses"],
    missions: "15",
    add: "+ Ajouter des souvenirs",
    metas: ["14 PHOTOS · 2 VOIX", "22 PHOTOS · 1 VIDÉO", "9 PHOTOS · 3 RÉCITS"],
    cards: [
      { name: "AJOUTER DE PARTOUT", body: "Enfants, petits-enfants et soignants contribuent à distance, depuis leur téléphone." },
      { name: "GARDER DE L’ORDRE", body: "Photos, voix, récits et personnes restent ensemble dans des canaux qui ont du sens pour elle." },
      { name: "VOIR CE QUI COMPTE", body: "Voyez quels canaux sont ouverts et réouverts, pour savoir quoi ajouter ensuite." },
      { name: "CONTINUER À CONSTRUIRE", body: "De nouveaux souvenirs, récits et informations utiles peuvent être ajoutés aussi longtemps que cela compte." },
    ],
    privateLabel: "LEUR ARCHIVE RESTE PRIVÉE",
    privateBody: "Seuls les membres invités de la famille voient l’espace de travail. Rien n’est public.",
  },
  nl: {
    eyebrow: "DE FAMILIE HOUDT HET LEVEND",
    title: "Zij zien eenvoud. Jij houdt het levend.",
    lead: "Alles wat moeilijk is gebeurt aan de kant van de familie, zodat de kant van de persoon eenvoudig kan blijven.",
    tabs: ["Overzicht", "Rek", "Kaarten", "Missies", "Inzichten"],
    missions: "15",
    add: "+ Herinneringen toevoegen",
    metas: ["14 FOTO’S · 2 STEMMEN", "22 FOTO’S · 1 VIDEO", "9 FOTO’S · 3 VERHALEN"],
    cards: [
      { name: "VOEG TOE VANAF OVERAL", body: "Kinderen, kleinkinderen en zorgverleners dragen van op afstand bij, vanaf hun eigen telefoon." },
      { name: "HOUD HET GEORDEND", body: "Foto’s, stemmen, verhalen en mensen blijven samen in kanalen die iets voor haar betekenen." },
      { name: "ZIE WAT TELT", body: "Zie welke kanalen geopend en heropend worden, zodat je weet wat je nog kunt toevoegen." },
      { name: "BLIJF BOUWEN", body: "Nieuwe herinneringen, verhalen en nuttige informatie kunnen worden toegevoegd zolang het ertoe doet." },
    ],
    privateLabel: "HUN ARCHIEF BLIJFT PRIVÉ",
    privateBody: "Alleen uitgenodigde familieleden zien de werkruimte. Niets is openbaar.",
  },
  en: {
    eyebrow: "THE FAMILY KEEPS IT ALIVE",
    title: "They see simplicity. You keep it alive.",
    lead: "Everything difficult happens on the family side, so the person’s side can stay simple.",
    tabs: ["Overview", "Memory Shelf", "Cards", "Missions", "Insights"],
    missions: "15",
    add: "+ Add memories",
    metas: ["14 PHOTOS · 2 VOICES", "22 PHOTOS · 1 VIDEO", "9 PHOTOS · 3 STORIES"],
    cards: [
      { name: "ADD FROM ANYWHERE", body: "Children, grandchildren and carers contribute remotely, from their own phones." },
      { name: "KEEP IT ORGANISED", body: "Photos, voices, stories and people stay together in channels that mean something to her." },
      { name: "SEE WHAT MATTERS", body: "See which channels are being opened and revisited, so you know what to add next." },
      { name: "KEEP BUILDING", body: "New memories, stories and useful information can be added for as long as it matters." },
    ],
    privateLabel: "THEIR ARCHIVE STAYS PRIVATE",
    privateBody: "Only invited family members can see the workspace. Nothing is public.",
  },
} as const;

const MONO = "'Roboto Mono', monospace";
const AMBER = "#E29A68";
const CREAM = "#F2F1EE";
const ACTIVE_TAB = 1;

export function OurScreen() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section className="relative overflow-hidden" style={{ background: "var(--s-dark)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(118deg, rgba(200,121,65,.34) 0%, rgba(120,86,64,.34) 46%, rgba(19,17,16,.94) 100%)",
          }}
        />
        <img
          src="/site/sea-view.jpg"
          alt=""
          className="absolute block h-[112%] w-[112%] object-cover"
          style={{ inset: "-6%", filter: "blur(34px) saturate(1.06)", transform: "scale(1.08)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(196deg, rgba(19,17,16,.62) 0%, rgba(19,17,16,.9) 82%)" }}
        />
      </div>

      <div className="s-wrap relative" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <div style={{ font: `400 11px/1 ${MONO}`, letterSpacing: ".24em", color: AMBER }}>{t.eyebrow}</div>
        <h2
          style={{
            margin: "20px 0 0",
            font: "600 clamp(28px,3.2vw,44px)/1.18 Archivo, sans-serif",
            letterSpacing: "-.01em",
            color: CREAM,
            maxWidth: "24ch",
            textWrap: "pretty",
          }}
        >
          {t.title}
        </h2>
        <p
          style={{
            margin: "18px 0 0",
            font: "400 16px/1.6 Roboto, sans-serif",
            color: "rgba(242,241,238,0.72)",
            maxWidth: "52ch",
          }}
        >
          {t.lead}
        </p>

        {/* The workspace, as a picture of itself. */}
        <div
          className="mt-11"
          style={{
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 22,
            padding: "22px 24px",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Five tabs do not fit a 375px phone, and a picture of a tab bar
                that is cut off is worse than one you can push. It scrolls
                sideways below `sm`, the way the real tab bar does. */}
            <div
              className="s-ws-tabs scroll-thin flex max-w-full items-center gap-[2px]"
              style={{
                padding: 4,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 999,
              }}
            >
              {t.tabs.map((tab, i) => (
                <span
                  key={tab}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    background: i === ACTIVE_TAB ? CREAM : undefined,
                    font: `${i === ACTIVE_TAB ? 500 : 400} 12px/1 Roboto, sans-serif`,
                    color: i === ACTIVE_TAB ? "#141311" : "rgba(242,241,238,.75)",
                  }}
                >
                  {tab}
                  {i === 3 && (
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "rgba(200,121,65,.18)",
                        font: `500 9px/1 ${MONO}`,
                        color: AMBER,
                      }}
                    >
                      {t.missions}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <span
              className="whitespace-nowrap"
              style={{
                padding: "9px 18px",
                borderRadius: 999,
                background: CREAM,
                font: "500 12px/1 Roboto, sans-serif",
                color: "#141311",
              }}
            >
              {t.add}
            </span>
          </div>

          <div
            className="mt-5 grid gap-3.5"
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
          >
            {SHELF.map((channel, i) => (
              <div
                key={channel.n}
                className="overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14 }}
              >
                <img
                  src={channel.cover}
                  alt=""
                  className="block w-full object-cover"
                  style={{ height: 96 }}
                />
                <div style={{ padding: "12px 14px" }}>
                  <span className="flex items-baseline gap-2">
                    <span style={{ font: "300 22px/1 Roboto, sans-serif", color: CREAM }}>{channel.n}</span>
                    <span style={{ font: "500 13px/1 Roboto, sans-serif", color: CREAM }}>
                      {channel.title[lang]}
                    </span>
                  </span>
                  <span
                    className="mt-2 block"
                    style={{ font: `400 8.5px/1 ${MONO}`, letterSpacing: ".12em", color: AMBER }}
                  >
                    {t.metas[i]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
          {t.cards.map((card) => (
            <div
              key={card.name}
              style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, padding: 22 }}
            >
              <div style={{ font: `500 11px/1 ${MONO}`, letterSpacing: ".18em", color: AMBER }}>{card.name}</div>
              <p
                style={{
                  margin: "12px 0 0",
                  font: "400 14px/1.6 Roboto, sans-serif",
                  color: "rgba(242,241,238,0.72)",
                }}
              >
                {card.body}
              </p>
            </div>
          ))}
        </div>

        <div
          className="mt-4 inline-flex flex-wrap items-baseline gap-3"
          style={{ border: "1px dashed rgba(255,255,255,.2)", borderRadius: 12, padding: "14px 18px" }}
        >
          <span style={{ font: `400 10px/1 ${MONO}`, letterSpacing: ".18em", color: "rgba(242,241,238,0.72)" }}>
            {t.privateLabel}
          </span>
          <span style={{ font: "400 12.5px/1.5 Roboto, sans-serif", color: "rgba(242,241,238,0.72)" }}>
            {t.privateBody}
          </span>
        </div>
      </div>
    </section>
  );
}
