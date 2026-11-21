import { useNavigate } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import "./site.css";
import { BackCircle } from "@/components/BackCircle";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

/**
 * The postcard explainer (backlog #3) — the loop in family language.
 *
 * Three beats, because that is the whole product: you send a memory, it
 * arrives in her letterbox, she opens it with a number. No mechanism talk —
 * the words a daughter would use to her brother on the phone.
 */

const COPY = {
  fr: {
    eyebrow: "LA CARTE POSTALE",
    title: "Un souvenir que vous postez, un monde qu'elle ouvre.",
    lead:
      "Chaque archive Recall a un battement de cœur : une vraie carte, imprimée et postée, qui arrive dans sa boîte aux lettres comme le courrier l'a toujours fait. Au dos, un nombre à deux chiffres. Ce nombre ouvre les souvenirs sur son écran.",
    steps: [
      {
        n: "01",
        title: "Vous envoyez un souvenir",
        body:
          "Depuis votre téléphone : choisissez une photographie, et la carte reprend ses mots de la chaîne qu'elle ouvre. Rien à mettre en page, rien à taper deux fois.",
      },
      {
        n: "02",
        title: "Elle arrive dans sa boîte aux lettres",
        body:
          "Une carte imprimée, à son nom, avec la photographie au recto et un court message au verso — le genre de courrier qu'on garde sur la cheminée.",
      },
      {
        n: "03",
        title: "Elle l'ouvre avec un nombre",
        body:
          "Sur la carte, il est écrit : pour ouvrir, tapez 02. Elle le tape sur le grand clavier — ou pose une carte reliée sur le lecteur — et toute la chaîne est là, sur son écran.",
      },
    ],
    why: "Pourquoi une carte, et pas une notification ?",
    whyBody:
      "Parce que le courrier, ses mains le connaissent déjà. Une carte, on la tient dans la main, on la pose debout, on la retrouve le dimanche. Elle ne lui demande rien de neuf à apprendre — elle lui demande ce qu'elle fait depuis toujours : lire le nombre, et regarder.",
    cta: "Voir ce que coûte Recall",
    request: "Demander une invitation",
    back: "Retour",
  },
  en: {
    eyebrow: "THE POSTCARD",
    title: "A memory you post, a world she opens.",
    lead:
      "Every Recall archive has a heartbeat: a real card, printed and posted, arriving in her letterbox the way post always has. On the back, a two-digit number. That number opens the memories on her screen.",
    steps: [
      {
        n: "01",
        title: "You send a memory",
        body:
          "From your phone: pick a photograph, and the card takes its words from the channel it opens. Nothing to design, nothing typed twice.",
      },
      {
        n: "02",
        title: "It arrives in her letterbox",
        body:
          "A printed card, addressed to her, with the photograph on the front and a short message on the back — the kind of post worth keeping on the mantelpiece.",
      },
      {
        n: "03",
        title: "She opens it with a number",
        body:
          "The card says: to open, type 02. She types it on the big keyboard — or lays a connected card on the reader — and the whole channel is there on her screen.",
      },
    ],
    why: "Why a card, and not a notification?",
    whyBody:
      "Because post is something her hands already know. A card can be held, propped up, found again on Sunday. It doesn't ask her to learn anything — it asks her to do what she has done all her life: read the number, and look.",
    cta: "See what Recall costs",
    request: "Request an invitation",
    back: "Back",
  },
  nl: {
    eyebrow: "DE POSTKAART",
    title: "Een herinnering die jij verstuurt, een wereld die zij opent.",
    lead:
      "Elk Recall-archief heeft een hartslag: een echte kaart, gedrukt en gepost, die in haar brievenbus valt zoals post dat altijd al deed. Op de achterkant staat een getal van twee cijfers. Dat getal opent de herinneringen op haar scherm.",
    steps: [
      {
        n: "01",
        title: "Jij verstuurt een herinnering",
        body:
          "Vanop je telefoon: kies een foto, en de kaart neemt haar woorden over van het kanaal dat ze opent. Niets te ontwerpen, niets twee keer te typen.",
      },
      {
        n: "02",
        title: "Ze valt in haar brievenbus",
        body:
          "Een gedrukte kaart, aan haar gericht, met de foto op de voorkant en een kort bericht op de achterkant — het soort post dat op de schouw blijft staan.",
      },
      {
        n: "03",
        title: "Zij opent ze met een getal",
        body:
          "Op de kaart staat: typ 02 om te openen. Zij typt het op het grote klavier — of legt een verbonden kaart op de lezer — en heel het kanaal staat op haar scherm.",
      },
    ],
    why: "Waarom een kaart, en geen melding?",
    whyBody:
      "Omdat post iets is wat haar handen al kennen. Een kaart kun je vasthouden, rechtzetten, zondag opnieuw vinden. Ze vraagt haar niets nieuws te leren — alleen wat ze heel haar leven al doet: het getal lezen, en kijken.",
    cta: "Bekijk wat Recall kost",
    request: "Vraag een uitnodiging aan",
    back: "Terug",
  },
} as const;

export function PostcardsPage() {
  const navigate = useNavigate();
  const [lang] = useLang();
  const t = COPY[lang];

  return (
    <div className="site scroll-thin flex h-full flex-col overflow-y-auto">
      <PublicHeader />

      {/* Under the rule, aligned with the wordmark above it — not a third
          thing in the corner beside the language switch. */}
      <div className="flex-none px-6 pt-6 md:px-14">
        <BackCircle label={t.back} />
      </div>

      <div className="mx-auto w-full max-w-[880px] px-6 pb-14 pt-8 md:px-10">
        <p className="font-mono text-[11px] leading-none tracking-[0.18em] text-accent">
          {t.eyebrow}
        </p>
        <h1
          className="mt-5 text-[34px] font-bold leading-[1.15] md:text-[44px]"
          style={{ letterSpacing: "-.015em", textWrap: "balance" }}
        >
          {t.title}
        </h1>
        <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.65] text-fg-muted" style={{ textWrap: "pretty" }}>
          {t.lead}
        </p>

        <div className="mt-10 flex flex-col gap-4">
          {t.steps.map((step) => (
            <div
              key={step.n}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-5 rounded-[18px] p-6"
              style={{ border: "1px solid rgba(var(--ink),.14)", background: "rgba(var(--ink),.03)" }}
            >
              <span className="font-mono text-[26px] font-light" style={{ color: "var(--accent-soft)" }}>
                {step.n}
              </span>
              <div>
                <h2 className="text-[17px] font-medium">{step.title}</h2>
                <p className="mt-1.5 max-w-[58ch] text-[14.5px] leading-[1.65] text-fg-muted">
                  {step.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-[18px] p-6" style={{ border: "1px solid rgba(var(--ink),.14)" }}>
          <h2 className="text-[17px] font-medium">{t.why}</h2>
          <p className="mt-2 max-w-[62ch] text-[14.5px] leading-[1.7] text-fg-muted" style={{ textWrap: "pretty" }}>
            {t.whyBody}
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => navigate("/pricing")}
            className="rounded-[12px] bg-accent px-8 py-[17px] text-[15px] font-medium leading-none text-accent-foreground transition-opacity hover:opacity-90"
          >
            {t.cta}
          </button>
          <button
            type="button"
            onClick={() => navigate("/request")}
            className="rounded-[12px] px-8 py-[17px] text-[15px] leading-none transition-colors hover:border-fg"
            style={{ border: "1px solid rgba(var(--ink),.2)" }}
          >
            {t.request}
          </button>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
