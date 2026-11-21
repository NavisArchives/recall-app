import { useLang } from "@/lib/publicLang";

/**
 * Section 03 — what changes, new in "Recall Website v3.dc.html".
 *
 * It answers the section above it in one line — "Recall removes the journey" —
 * and then says what that is worth to each of the three people involved: the
 * person, the family, everyone. Three columns under three rules, no cards, no
 * icons. The section exists because the previous page went straight from the
 * problem to the mechanism, which asked a reader to work out for themselves
 * what they were being offered.
 */

const COPY = {
  fr: {
    eyebrow: "AVEC RECALL",
    title: "Recall supprime le trajet.",
    columns: [
      {
        who: "POUR EUX",
        claim: "« Je peux l’ouvrir moi-même. »",
        body: "Leurs photos, leurs proches, leurs récits et les informations utiles restent à portée sur un écran familier.",
      },
      {
        who: "POUR LA FAMILLE",
        claim: "Ajoutez-le une fois. Depuis n’importe où.",
        body: "Enfants, petits-enfants et soignants tiennent l’archive à jour sans être dans la pièce.",
      },
      {
        who: "POUR TOUT LE MONDE",
        claim: "Un seul endroit partagé pour ce qui compte.",
        body: "Au lieu de souvenirs éparpillés entre téléphones, albums, fils WhatsApp et ordinateurs.",
      },
    ],
    close: "UN ÉCRAN · UNE ARCHIVE · DES ACCÈS SIMPLES",
  },
  nl: {
    eyebrow: "MET RECALL",
    title: "Recall haalt de weg ernaartoe weg.",
    columns: [
      {
        who: "VOOR HEN",
        claim: "“Ik kan het zelf openen.”",
        body: "Hun foto’s, mensen, verhalen en nuttige informatie blijven binnen bereik op een vertrouwd scherm.",
      },
      {
        who: "VOOR DE FAMILIE",
        claim: "Eén keer toevoegen. Vanaf overal.",
        body: "Kinderen, kleinkinderen en zorgverleners houden het archief bij zonder in de kamer te zijn.",
      },
      {
        who: "VOOR IEDEREEN",
        claim: "Eén gedeelde plek voor wat telt.",
        body: "In plaats van herinneringen verspreid over telefoons, albums, WhatsApp-gesprekken en laptops.",
      },
    ],
    close: "ÉÉN SCHERM · ÉÉN ARCHIEF · EENVOUDIGE WEGEN NAAR BINNEN",
  },
  en: {
    eyebrow: "WITH RECALL",
    title: "Recall removes the journey.",
    columns: [
      {
        who: "FOR THEM",
        claim: "“I can open it myself.”",
        body: "Their photographs, people, stories and useful information stay within reach on a familiar screen.",
      },
      {
        who: "FOR THE FAMILY",
        claim: "Add it once. From anywhere.",
        body: "Children, grandchildren and carers keep the archive up to date without being in the room.",
      },
      {
        who: "FOR EVERYONE",
        claim: "One shared place for the things that matter.",
        body: "Instead of memories scattered across phones, albums, WhatsApp threads and laptops.",
      },
    ],
    close: "ONE SCREEN · ONE ARCHIVE · SIMPLE WAYS IN",
  },
} as const;

export function WhatChanges() {
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <section className="s-wrap s-rule" style={{ paddingTop: 90, paddingBottom: 90 }}>
      <div className="s-eyebrow">{t.eyebrow}</div>
      <h2 className="s-h2" style={{ maxWidth: "18ch" }}>
        {t.title}
      </h2>

      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: "clamp(24px,3vw,48px)",
          marginTop: "clamp(36px,4vw,56px)",
        }}
      >
        {t.columns.map((c) => (
          <div key={c.who} style={{ borderTop: "1.5px solid rgba(var(--s-ink),0.22)", paddingTop: 20 }}>
            <div
              style={{
                font: "400 10px/1 'Roboto Mono', monospace",
                letterSpacing: ".2em",
                color: "rgba(var(--s-ink),0.68)",
              }}
            >
              {c.who}
            </div>
            <div
              style={{
                font: "600 clamp(22px,2.2vw,28px)/1.25 Archivo, sans-serif",
                letterSpacing: "-.01em",
                marginTop: 14,
                textWrap: "pretty",
              }}
            >
              {c.claim}
            </div>
            <p
              style={{
                margin: "12px 0 0",
                font: "400 15px/1.65 Roboto, sans-serif",
                color: "rgba(var(--s-ink),0.72)",
                maxWidth: "34ch",
              }}
            >
              {c.body}
            </p>
          </div>
        ))}
      </div>

      <div
        style={{
          font: "400 11px/1.9 'Roboto Mono', monospace",
          letterSpacing: ".14em",
          color: "rgba(var(--s-ink),0.6)",
          marginTop: "clamp(36px,4vw,56px)",
          textAlign: "center",
        }}
      >
        {t.close}
      </div>
    </section>
  );
}
