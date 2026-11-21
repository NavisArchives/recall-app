import { Link } from "react-router-dom";
import { useLang } from "@/lib/publicLang";
import { SELLER, sellerIsRegistered, sellerRegion } from "@/lib/seller";

const COPY = {
  fr: {
    privacy: "Confidentialité",
    terms: "Conditions",
    postcards: "Cartes",
    pricing: "Prix",
    archive: "Service d’archivage",
    research: "Ce que nous étudions",
    help: "Aide",
    from: "depuis la",
    details: "Les coordonnées du vendeur enregistré apparaissent ici avant la première facture.",
  },
  en: {
    privacy: "Privacy",
    terms: "Terms",
    postcards: "Postcards",
    pricing: "Pricing",
    archive: "Archive service",
    research: "What we are researching",
    help: "Help",
    from: "from",
    details: "Registered seller details appear here before the first invoice is issued.",
  },
  nl: {
    privacy: "Privacy",
    terms: "Voorwaarden",
    postcards: "Kaarten",
    pricing: "Prijzen",
    archive: "Archiefdienst",
    research: "Wat we onderzoeken",
    help: "Hulp",
    from: "vanuit",
    details: "De geregistreerde verkopersgegevens verschijnen hier vóór de eerste factuur.",
  },
} as const;

/**
 * The line every public page ends on (launch sweep, 16 Sep 2026).
 *
 * Before it existed the site had no link to a privacy policy or terms, and
 * named no seller anywhere — for a distance sale to a Belgian family these
 * are preconditions of the contract, not decoration. One component, so the
 * identity is written once (lib/seller.ts) and read everywhere.
 */
export function PublicFooter() {
  const [lang] = useLang();
  const t = COPY[lang];
  const region = sellerRegion(lang);
  const link = "transition-colors hover:text-fg";
  return (
    <footer
      className="flex-none px-6 py-8 text-[13px] leading-[1.7] md:px-14"
      style={{ borderTop: "1px solid rgba(var(--ink),.12)", color: "rgba(var(--ink),.55)" }}
    >
      <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Site">
        <Link to="/privacy" className={link}>{t.privacy}</Link>
        <Link to="/terms" className={link}>{t.terms}</Link>
        <Link to="/postcards" className={link}>{t.postcards}</Link>
        <Link to="/pricing" className={link}>{t.pricing}</Link>
        <Link to="/archive-service" className={link}>{t.archive}</Link>
        <Link to="/research" className={link}>{t.research}</Link>
        <Link to="/help" className={link}>{t.help}</Link>
      </nav>
      <p className="mt-3 max-w-[70ch]">
        {SELLER.tradeName} · {t.from} {region} ·{" "}
        <a href={`mailto:${SELLER.email}`} className={link}>{SELLER.email}</a>
        {SELLER.phone ? <> · {SELLER.phone}</> : null}
      </p>
      {sellerIsRegistered() ? (
        <p className="mt-1 max-w-[70ch]">
          {SELLER.legalName}
          {SELLER.registration ? <> · {SELLER.registration}</> : null}
          {SELLER.vat ? <> · {SELLER.vat}</> : null}
          {" · "}
          {SELLER.address}
        </p>
      ) : (
        <p className="mt-1 max-w-[70ch] italic">{t.details}</p>
      )}
    </footer>
  );
}
