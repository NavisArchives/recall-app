/**
 * Who sells Recall — the one place the site says so.
 *
 * Belgian consumer law (WER XII.6, VI.45) wants the trader's identity, a
 * geographic address, an email and a second contact channel on every page
 * where a family can decide to buy. The footer, /terms and /privacy all read
 * this object, so the day the company details are settled they change in one
 * place and nowhere else.
 *
 * Empty strings render nothing: a line that is not known yet is left out
 * rather than invented. Fill them; never guess them.
 */
export interface Seller {
  tradeName: string;
  legalName: string;
  registration: string;
  vat: string;
  address: string;
  phone: string;
  email: string;
  iban: string;
  bic: string;
  accountHolder: string;
  region: string;
  regionNl: string;
  regionFr: string;
}

export const SELLER: Seller = {
  /** The name on the door. */
  tradeName: "Recall",
  /** Registered legal name of the seller, once confirmed by the accountant. */
  legalName: "",
  /** Company / enterprise number (KBO or foreign register). */
  registration: "",
  /** VAT number, once one exists for these sales. */
  vat: "",
  /** Geographic address for the label, the invoice and the footer. */
  address: "",
  /** A second contact channel besides email (WER XII.6). */
  phone: "",
  email: "hello@example.com",
  /**
   * Where a family's transfer lands — a EUR IBAN a Belgian bank app can pay
   * (SEPA). Empty until the owner confirms which account he holds; the
   * invoice sheet then prints the amount and the reference without a QR.
   */
  iban: "",
  bic: "",
  /** The name on that account, as the bank knows it (EPC QR line 6). */
  accountHolder: "",
  /**
   * Where the work is done — the country only (owner, 24 Sep 2026: no
   * personal name and no province on the site).
   */
  region: "Belgium",
  regionNl: "België",
  regionFr: "Belgique",
};

/** True when the registered identity is filled in — the footer says less until then. */
export function sellerIsRegistered(): boolean {
  return Boolean(SELLER.legalName && SELLER.address);
}

/**
 * The seller's region in the reader's language.
 *
 * It lived as `lang === "nl" ? regionNl : region` in two files, which was
 * already a coin-flip waiting for a third language — and when French arrived
 * both of them sent a French reader the English name of the region. One function, so
 * a fourth language is one edit here.
 */
export function sellerRegion(lang: "fr" | "nl" | "en"): string {
  if (lang === "nl") return SELLER.regionNl;
  if (lang === "fr") return SELLER.regionFr;
  return SELLER.region;
}
