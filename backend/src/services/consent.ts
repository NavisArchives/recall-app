import { supabase } from "../config/supabase.js";

/**
 * Her word (054).
 *
 * Three ways an archive may lawfully show a person's life on her screen:
 * she agrees herself, a court-appointed guardian over her person agrees for
 * her, or the holder of a care mandate that covers this does. The wording a
 * signer agreed to is versioned (frontend/src/lib/consent.ts carries the
 * same string), so a later rewording never borrows an older signature.
 */
export const CONSENT_BASES = ["self", "guardian", "care_mandate"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

export const CONSENT_TEXT_VERSION = "2026-09-16";

export interface ConsentInput {
  basis: ConsentBasis;
  signer_name: string;
  lang: "en" | "nl" | "fr";
}

/** The declaration as a sign-up or Settings form sends it, or null when malformed. */
export function parseConsent(body: unknown): ConsentInput | null {
  if (!body || typeof body !== "object") return null;
  const { basis, signer_name, lang } = body as Record<string, unknown>;
  if (typeof basis !== "string" || !(CONSENT_BASES as readonly string[]).includes(basis)) return null;
  if (typeof signer_name !== "string" || !signer_name.trim()) return null;
  /*
    Which wording they actually signed (060). This used to read
    `lang === "nl" ? "nl" : "en"`, so a French signer was recorded as having
    signed the English declaration — a wrong fact about a legal act, on the
    one row that says a family had the right to do this at all. Anything
    unrecognised still falls to English, which is the safe direction: the
    record then names a wording that exists.
  */
  const language = lang === "nl" || lang === "fr" ? lang : "en";
  return { basis: basis as ConsentBasis, signer_name: signer_name.trim().slice(0, 160), lang: language };
}

/**
 * Write one declaration. Returns the database's error, if any, so the caller
 * decides how loud to be — sign-up must not fail a created household over
 * it, Settings must tell the admin.
 */
export async function recordConsent(row: {
  archive_id: string;
  declared_by: string | null;
  subject_name: string;
  signer_relationship: string | null;
  consent: ConsentInput;
}) {
  const { error } = await supabase.from("archive_consents").insert({
    archive_id: row.archive_id,
    basis: row.consent.basis,
    signer_name: row.consent.signer_name,
    signer_relationship: row.signer_relationship,
    subject_name: row.subject_name,
    declared_by: row.declared_by,
    text_version: CONSENT_TEXT_VERSION,
    lang: row.consent.lang,
  });
  return { error };
}
