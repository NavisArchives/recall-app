/**
 * Her word (054) — the declaration an archive rests on, and the wording it
 * was given in.
 *
 * The backend records `text_version` with every declaration, so the wording
 * below is what a signer agreed to. Changing a sentence here means a new
 * version string, never an edit under the old one: a later rewording must not
 * borrow an earlier signature. Backend twin: backend/src/services/consent.ts.
 */
export const CONSENT_TEXT_VERSION = "2026-09-16";

/*
  FRENCH ARRIVED WITHOUT A NEW VERSION, deliberately.

  A signature is identified by (text_version, lang) together, and the
  declaration itself did not change — a third rendering of the same words was
  added. No existing row is touched and no earlier wording is borrowed for a
  later signature. Widening the wording, in any language, still means a new
  version string.

  The French below is a translation of the English, using the Belgian legal
  terms: "administrateur de la personne" for bewind over de persoon, "mandat
  extrajudiciaire" for zorgvolmacht. It is the one string set in this product
  where a mistranslation has legal consequence, and it is worth a Belgian
  lawyer's eye before it meets a real family.
*/

export type ConsentBasis = "self" | "guardian" | "care_mandate";
export type ConsentLang = "en" | "nl" | "fr";

export const CONSENT_COPY: Record<
  ConsentLang,
  {
    title: string;
    lead: string;
    bases: Record<ConsentBasis, { label: string; hint: string }>;
    agree: string;
    agreeSelf: string;
    signer: string;
    printTitle: string;
    signature: string;
    date: string;
    why: string;
  }
> = {
  fr: {
    title: "Sa parole",
    lead: "Montrer la vie de quelqu’un sur son écran demande son accord — ou celui de la personne qui peut légalement décider pour elle. Indiquez ce qui s’applique. C’est conservé avec les archives et peut être retiré à tout moment.",
    bases: {
      self: {
        label: "Elle donne son accord elle-même",
        hint: "Elle comprend ce que sont ces archives et elle les veut.",
      },
      guardian: {
        label: "Je suis son administrateur de la personne (bewind over de persoon)",
        hint: "L’ordonnance du juge de paix couvre les décisions concernant sa personne.",
      },
      care_mandate: {
        label: "Je dispose d’un mandat extrajudiciaire (zorgvolmacht) qui le couvre",
        hint: "Un mandat notarié ou enregistré pour les affaires personnelles, actuellement en vigueur.",
      },
    },
    agree:
      "Je déclare que ceci est exact, que j’ai lu la politique de confidentialité, et que les photos, films et récits placés dans ces archives peuvent être montrés sur son écran à la maison.",
    agreeSelf:
      "J’accepte que les photos, films et récits placés dans ces archives soient montrés sur mon écran à la maison, et j’ai lu la politique de confidentialité.",
    signer: "Signé par",
    printTitle: "Déclaration de consentement",
    signature: "Signature",
    date: "Date",
    why: "Pourquoi nous le demandons : être le sujet d’archives Recall dit quelque chose sur sa santé, et la loi considère cela comme une donnée sensible qui exige un oui explicite.",
  },
  en: {
    title: "Her word",
    lead: "Showing someone's life on her screen needs her agreement — or that of whoever may lawfully decide for her. Say which applies. It is recorded with the archive and can be withdrawn at any time.",
    bases: {
      self: {
        label: "She agrees herself",
        hint: "She understands what the archive is and wants it.",
      },
      guardian: {
        label: "I am her court-appointed guardian (bewind over de persoon)",
        hint: "The justice of the peace's order covers decisions about her person.",
      },
      care_mandate: {
        label: "I hold a care mandate (zorgvolmacht) that covers this",
        hint: "A notarised or registered mandate for personal matters, now in force.",
      },
    },
    agree:
      "I declare that this is true, that I have read the privacy policy, and that the photographs, films and stories placed in this archive may be shown on her screen at home.",
    agreeSelf:
      "I agree that the photographs, films and stories placed in this archive may be shown on my screen at home, and I have read the privacy policy.",
    signer: "Signed by",
    printTitle: "Declaration of consent",
    signature: "Signature",
    date: "Date",
    why: "Why we ask: being the subject of a Recall archive says something about her health, and the law treats that as sensitive data that needs an explicit yes.",
  },
  nl: {
    title: "Haar woord",
    lead: "Iemands leven op haar scherm tonen vraagt haar toestemming — of die van wie wettelijk voor haar mag beslissen. Zeg wat van toepassing is. Het wordt bij het archief bewaard en kan altijd worden ingetrokken.",
    bases: {
      self: {
        label: "Zij stemt zelf toe",
        hint: "Zij begrijpt wat het archief is en wil het.",
      },
      guardian: {
        label: "Ik ben haar bewindvoerder over de persoon",
        hint: "De beschikking van de vrederechter dekt beslissingen over haar persoon.",
      },
      care_mandate: {
        label: "Ik heb een zorgvolmacht die dit dekt",
        hint: "Een notariële of geregistreerde volmacht voor persoonlijke aangelegenheden, nu in werking.",
      },
    },
    agree:
      "Ik verklaar dat dit waar is, dat ik de privacyverklaring gelezen heb, en dat de foto's, films en verhalen in dit archief op haar scherm thuis getoond mogen worden.",
    agreeSelf:
      "Ik ga ermee akkoord dat de foto's, films en verhalen in dit archief op mijn scherm thuis getoond worden, en ik heb de privacyverklaring gelezen.",
    signer: "Ondertekend door",
    printTitle: "Toestemmingsverklaring",
    signature: "Handtekening",
    date: "Datum",
    why: "Waarom we dit vragen: het onderwerp zijn van een Recall-archief zegt iets over haar gezondheid, en de wet ziet dat als gevoelige gegevens die een uitdrukkelijk ja vragen.",
  },
};

export const CONSENT_BASES: ConsentBasis[] = ["self", "guardian", "care_mandate"];

/** What the workspace reads back from GET /settings/consent. */
export interface ConsentRecord {
  id: string;
  basis: ConsentBasis;
  signer_name: string;
  signer_relationship: string | null;
  subject_name: string;
  declared_by: string | null;
  text_version: string;
  lang: ConsentLang;
  declared_at: string;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
}
