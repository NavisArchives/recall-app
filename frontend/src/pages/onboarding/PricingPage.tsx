import { Link, useNavigate } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import "./site.css";
import { BackCircle } from "@/components/BackCircle";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

/**
 * Two ways to hold it (owner, 17 Sep 2026).
 *
 * The four-tier ladder is retired. There is Recall — the archive on the
 * screen a family already owns — and Recall Dock, the same archive with the
 * physical media hub, keyboard and connected-card reader. A reader or a
 * keyboard on its own becomes a package on top of Recall later, never a
 * separate priced tier. Both cost the same subscription: €25 a month, or
 * €275 a year (one month free), incl. 21% VAT. Only the Dock adds a
 * one-time device charge — and that charge has no settled price yet
 * (15-product-ladder: settle the real production cost before a number goes
 * on a page), so it reads "confirmed at your invoice" rather than a number
 * nobody can stand behind.
 *
 * Payment is by invoice, by hand, because the first families are few and
 * known. The page says so instead of dressing a request up as a checkout.
 */

const COPY = {
  fr: {
    eyebrow: "CE QUE RECALL COÛTE",
    title: "Les mêmes archives, deux façons de les avoir chez soi.",
    lead:
      "Dans les deux cas, ce sont les mêmes archives et le même cycle — une carte dans la boîte aux lettres, des souvenirs sur l'écran. La différence : Recall tourne sur l'écran que vous avez déjà, ou il arrive avec son propre dock.",
    setupLabel: "frais d'installation uniques",
    monthly: "Ensuite €25 par mois pour l'un comme pour l'autre, TVA de 21% comprise — ou €275 par an, avec un mois gratuit.",
    arrives: "Ce qui arrive",
    tiers: [
      {
        key: "digital",
        name: "Recall",
        who: "Pour l'écran que vous avez déjà",
        arrives: "Chaque mois, une carte imprimée par la poste, à son nom",
        hardware: "Rien à installer. Recall tourne sur sa télévision ou sur un écran dans la pièce, et s'ouvre avec un numéro.",
        setup: "€75",
        device: "Installé sur un écran que vous avez déjà" as string | null,
      },
      {
        key: "dock",
        name: "Recall Dock",
        who: "L'expérience physique complète",
        arrives: "Le dock, livré à la porte — et la même carte chaque mois",
        hardware: "Un hub média avec un clavier et un lecteur de cartes connectées. Une carte posée dessus ouvre son canal.",
        setup: "€490",
        device: "Le Dock inclus, il vous appartient" as string | null,
      },
    ],
    includes: "Les deux comprennent",
    included: [
      "Les archives personnelles — canaux, photos, films, récits",
      "L'espace de la famille, depuis n'importe quel téléphone ou ordinateur portable",
      "Une carte par la poste, à son nom, qui ouvre un canal sur son écran",
      "Le stockage, les mises à jour et une personne à qui envoyer un e-mail",
    ],
    smallPrint: "Les petits caractères, en entier",
    promises: [
      "Chaque prix est le total que vous payez, TVA de 21% comprise. Pas de frais cachés, pas de durée minimale.",
      "Des frais d'installation uniques de €75 pour Recall, ou €490 pour le Recall Dock, facturés une seule fois au début.",
      "Ensuite €25 par mois, ou €275 par an avec un mois gratuit. Vous pouvez arrêter chaque mois par e-mail ; cela se termine à la fin de la période payée.",
      "Garantie de 30 jours : arrêtez dans les 30 jours après votre premier paiement et tout vous est remboursé.",
      "En cas de décès, la facturation s'arrête le jour où vous nous le dites. Vous recevez l'ensemble des archives en téléchargement dans les 14 jours.",
      "Le paiement se fait par facture une fois votre demande acceptée — aucune donnée de carte bancaire sur ce site. Le Dock n'est facturé que lorsqu'il est prêt à partir, avec une date.",
      "Le droit légal de rétractation de 14 jours s'applique en plus. Les conditions et le formulaire type se trouvent sur la page des conditions.",
    ],
    cta: "Demander une invitation",
    note: "Recall est uniquement sur invitation. Faites la demande, dites laquelle des deux vous voulez et comment vous souhaitez payer, et une personne vous répond.",
    scanLabel: "BOÎTES À CHAUSSURES ET ALBUMS",
    scanTitle: "Les photos papier, nous pouvons les numériser pour vous.",
    scanBody: "Le service d’archivage est distinct de l’abonnement : €450, une seule fois, pour 500 photographies, la visite à domicile comprise. Un mois de Recall est offert et les frais d’installation de Recall sautent.",
    scanCta: "Voir le service d’archivage",
    back: "Retour",
  },
  en: {
    eyebrow: "WHAT RECALL COSTS",
    title: "One archive, two ways to hold it.",
    lead:
      "Both are the same archive and the same loop — a card in the letterbox, memories on the screen. The difference is whether Recall runs on the screen you already own, or arrives with its own dock.",
    setupLabel: "one-time setup",
    /* Said once, under both cards, because it IS once: the monthly price is
       the same either way, and printing it on each card made the two look
       like different subscriptions when the only difference is the setup. */
    monthly: "Then €25 a month for either one, incl. 21% VAT — or €275 a year with one month free.",
    arrives: "What arrives",
    tiers: [
      {
        key: "digital",
        name: "Recall",
        who: "For the screen you already have",
        arrives: "A printed card in the post every month, addressed to them",
        hardware: "Nothing to install. Recall runs on their television or a screen in the room, opened with a number.",
        setup: "€75",
        device: "Set up on a screen you already have" as string | null,
      },
      {
        key: "dock",
        name: "Recall Dock",
        who: "The complete physical experience",
        arrives: "The dock, delivered to the door — and the same monthly card",
        hardware: "A media hub with a keyboard and a connected-card reader. A card laid on it opens its channel.",
        setup: "€490",
        device: "The Dock included, yours to keep" as string | null,
      },
    ],
    includes: "Both include",
    included: [
      "The personal archive — channels, photographs, films, stories",
      "The family workspace, from any phone or laptop",
      "A card in the post, addressed to them, opening a channel on their screen",
      "Storage, updates and a person to email",
    ],
    smallPrint: "The small print, in full",
    promises: [
      "Every price is the total you pay, including 21% VAT. No hidden costs, no minimum term.",
      "A one-time setup fee of €75 for Recall, or €490 for the Recall Dock, invoiced once at the start.",
      "€25 a month after that, or €275 a year with one month free. Cancel any month by email; it ends at the end of the paid period.",
      "30-day guarantee: stop within 30 days of your first payment and everything comes back.",
      "On a death, billing stops the day you tell us. You receive the whole archive as a download within 14 days.",
      "Payment is by invoice after your request is approved — no card details on this site. The Dock is invoiced only when it is ready to ship, with a date.",
      "The legal 14-day right of withdrawal applies as well. Terms and the model form are on the terms page.",
    ],
    cta: "Request an invitation",
    note: "Recall is invitation-only. Ask, say which of the two you want and how you would like to pay, and a person gets back to you.",
    scanLabel: "SHOEBOXES AND ALBUMS",
    scanTitle: "Prints on paper — we can scan them for you.",
    scanBody: "The Archive service is separate from the subscription: €450, one time, for 500 photographs with the home visit included. A month of Recall comes with it, and the Recall setup fee is waived.",
    scanCta: "See the Archive service",
    back: "Back",
  },
  nl: {
    eyebrow: "WAT RECALL KOST",
    title: "Eén archief, twee manieren om het vast te houden.",
    lead:
      "Beide zijn hetzelfde archief en dezelfde kringloop — een kaart in de brievenbus, herinneringen op het scherm. Het verschil: draait Recall op het scherm dat je al hebt, of komt het met zijn eigen dock.",
    setupLabel: "eenmalige installatie",
    monthly: "Daarna €25 per maand voor allebei, incl. 21% btw — of €275 per jaar met één maand gratis.",
    arrives: "Wat er toekomt",
    tiers: [
      {
        key: "digital",
        name: "Recall",
        who: "Voor het scherm dat je al hebt",
        arrives: "Elke maand een gedrukte kaart met de post, aan haar gericht",
        hardware: "Niets te installeren. Recall draait op haar televisie of een scherm in de kamer, geopend met een nummer.",
        device: null as string | null,
      },
      {
        key: "dock",
        name: "Recall Dock",
        who: "De volledige fysieke ervaring",
        arrives: "De dock, tot aan de deur — en dezelfde maandelijkse kaart",
        hardware: "Een mediahub met klavier en lezer voor verbonden kaarten. Een kaart erop gelegd opent haar kanaal.",
        setup: "€490",
        device: "Met de dock erbij, van jou" as string | null,
      },
    ],
    includes: "Beide omvatten",
    included: [
      "Het persoonlijke archief — kanalen, foto's, films, verhalen",
      "De familieruimte, vanop elke telefoon of laptop",
      "Een kaart met de post, aan haar gericht, die een kanaal op haar scherm opent",
      "Opslag, updates en een mens die je kunt mailen",
    ],
    smallPrint: "De kleine lettertjes, voluit",
    promises: [
      "Elke prijs is het totaal dat je betaalt, inclusief 21% btw. Geen verborgen kosten, geen minimumduur.",
      "Een eenmalige installatiekost van €75 voor Recall, of €490 voor de Recall Dock, één keer gefactureerd bij de start.",
      "Daarna €25 per maand, of €275 per jaar met één maand gratis. Maandelijks opzegbaar per mail; het eindigt op het einde van de betaalde periode.",
      "30 dagen garantie: stop binnen 30 dagen na je eerste betaling en je krijgt alles terug.",
      "Bij een overlijden stopt de facturatie de dag dat je het ons zegt. Binnen 14 dagen krijg je het volledige archief als download.",
      "Betalen gaat per factuur nadat je aanvraag is goedgekeurd — geen kaartgegevens op deze site. De dock wordt pas gefactureerd wanneer ze verzendklaar is, met een datum.",
      "Het wettelijke herroepingsrecht van 14 dagen geldt daarbovenop. Voorwaarden en modelformulier staan op de voorwaardenpagina.",
    ],
    cta: "Vraag een uitnodiging aan",
    note: "Recall is enkel op uitnodiging. Vraag het aan, zeg welke van de twee je wilt en hoe je wilt betalen, en een mens antwoordt je.",
    scanLabel: "SCHOENENDOZEN EN ALBUMS",
    scanTitle: "Papieren foto’s kunnen wij voor je scannen.",
    scanBody: "De archiefdienst staat los van het abonnement: €450, eenmalig, voor 500 foto’s met het huisbezoek inbegrepen. Er komt een maand Recall bij en de installatiekost van Recall valt weg.",
    scanCta: "Bekijk de archiefdienst",
    back: "Terug",
  },
};

export function PricingPage() {
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

      <div className="mx-auto w-full max-w-[1080px] px-6 pb-14 pt-8 md:px-10">
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

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {t.tiers.map((tier) => (
            <div
              key={tier.key}
              className="flex flex-col rounded-[18px] p-6"
              style={{ border: "1px solid rgba(var(--ink),.14)", background: "rgba(var(--ink),.03)" }}
            >
              <h2 className="text-[17px] font-medium">{tier.name}</h2>
              <p className="mt-1 text-[13px] text-fg-faint">{tier.who}</p>
              {/* The number that actually differs. The monthly price is the
                  same for both and is stated once, under the pair. */}
              <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[36px] font-light leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {tier.setup}
                </span>
                <span className="text-[14px] text-fg-muted">{t.setupLabel}</span>
              </p>
              {tier.device && (
                <p className="mt-1.5 font-mono text-[11px] leading-[1.5] tracking-[0.06em] text-fg-faint">
                  {tier.device}
                </p>
              )}
              <div className="mt-5 flex flex-col gap-2 border-t border-line-soft pt-5 text-[13.5px] leading-[1.55]">
                <p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    {t.arrives}
                  </span>
                  <span className="mt-0.5 block">{tier.arrives}</span>
                </p>
                <p className="text-fg-muted">{tier.hardware}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[15px] leading-[1.6] text-fg-muted">{t.monthly}</p>

        <div className="mt-8 rounded-[18px] p-6" style={{ border: "1px solid rgba(var(--ink),.14)" }}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-accent">{t.includes}</p>
          <ul className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {t.included.map((line) => (
              <li key={line} className="flex gap-2.5 text-[14px] leading-[1.6] text-fg-muted">
                <span className="mt-[9px] size-1 flex-none rounded-full" style={{ background: "var(--accent-soft)" }} aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/*
          The one thing on this page that is not the subscription, and it says
          so in its own first line. A family reading about €25 a month is the
          family with a cupboard of prints, and until now the only way to
          discover the scanning service was the footer.
        */}
        <div className="mt-6 rounded-[18px] p-6" style={{ border: "1px solid rgba(var(--ink),.14)" }}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-accent">{t.scanLabel}</p>
          <h2 className="mt-4 max-w-[36ch] text-[19px] font-semibold" style={{ letterSpacing: "-.01em" }}>
            {t.scanTitle}
          </h2>
          <p className="mt-2 max-w-[62ch] text-[14.5px] leading-[1.65] text-fg-muted">{t.scanBody}</p>
          <Link to="/archive-service" className="s-btn s-btn--sm s-btn--line mt-5">
            {t.scanCta}
          </Link>
        </div>

        <div className="mt-6 rounded-[18px] p-6" style={{ border: "1px solid rgba(var(--ink),.14)" }}>
          <p className="font-mono text-[11px] tracking-[0.18em] text-accent">{t.smallPrint}</p>
          <ul className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {t.promises.map((line) => (
              <li key={line} className="flex gap-2.5 text-[14px] leading-[1.6] text-fg-muted">
                <span className="mt-[9px] size-1 flex-none rounded-full" style={{ background: "var(--accent-soft)" }} aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 flex flex-col items-start gap-4">
          <button
            type="button"
            onClick={() => navigate("/request")}
            className="rounded-[12px] bg-accent px-8 py-[17px] text-[15px] font-medium leading-none text-accent-foreground transition-opacity hover:opacity-90"
          >
            {t.cta}
          </button>
          <p className="max-w-[62ch] text-[13px] leading-[1.6] text-fg-faint">{t.note}</p>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
