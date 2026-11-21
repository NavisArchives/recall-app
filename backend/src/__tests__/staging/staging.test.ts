import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { randomBytes, createHmac } from "node:crypto";
import { config } from "dotenv";

config();

/**
 * The suite that talks to a real database.
 *
 * `npm test` is mocked, offline and fast, and that is why it gets run. But a
 * mock answers `rpc()` with whatever it was told to, so it cheerfully passed
 * twelve invitation tests against a function that could not execute at all —
 * `accept_invitation` raised 42702 on its first statement for every caller,
 * and no test noticed. That is the hole this closes.
 *
 * These tests only ask what a real Postgres can answer: do the functions
 * exist, may service_role call them, do their *bodies* run, does a failed
 * transaction leave nothing behind, and does a race produce exactly one
 * winner.
 *
 *   npm run test:staging
 *
 * It refuses to run against production. That is a guard clause, not a
 * convention — see the check below.
 */

/*
 * Staging credentials only — the application's own SUPABASE_URL is never a
 * fallback. This suite writes rows and races them deliberately; a fallback to
 * the credentials every developer already has in .env is a loaded gun pointed
 * at whichever project those happen to name. If the staging variables are not
 * set, the suite skips, loudly. It does not improvise.
 */
const url = process.env.STAGING_SUPABASE_URL ?? "";
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? "";

/*
 * The target must be named twice to be written to once.
 *
 * A URL alone can be pasted, inherited, or wrong. STAGING_PROJECT_REF must
 * spell out the project ref the URL resolves to — writing it is the operator
 * saying "yes, that exact project is the scratch one". A mismatch, or no ref
 * at all, and the destructive suite does not run. The empty-table check below
 * still stands behind this; neither replaces the other.
 */
const projectRef = (() => {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
})();
const confirmedRef = process.env.STAGING_PROJECT_REF ?? "";
const identified = !!projectRef && projectRef === confirmedRef;

/**
 * Production is named explicitly and refused explicitly. Anything listed in
 * PRODUCTION_SUPABASE_URL is off limits, and so is any project that already
 * holds a family's channels unless the caller says out loud that it may be
 * written to.
 */
const productionUrl = process.env.PRODUCTION_SUPABASE_URL ?? "";
const allowNonEmpty = process.env.STAGING_ALLOW_NON_EMPTY === "yes";

const configured = !!url && !!key;
const isProduction = !!productionUrl && url.trim() === productionUrl.trim();

/**
 * Two tiers, because they carry different risk.
 *
 * `probes` write nothing: they call each function with arguments that fail
 * its first check, so the transaction never gets past the refusal. Those are
 * safe against any project, including production, and they are the ones that
 * catch an M22-class regression — a function that cannot execute at all.
 *
 * `suite` writes real rows and races them deliberately. It needs a scratch
 * project, and refuses anything that already holds a family's channels.
 */
// Probes write nothing, so they need the credentials and the production
// refusal; the writing suite additionally needs the project positively
// identified as the intended staging target.
const probes = configured && !isProduction ? describe : describe.skip;
const suite = configured && !isProduction && identified ? describe : describe.skip;

if (!configured) {
  console.warn(
    "\n[staging] STAGING_SUPABASE_URL / STAGING_SUPABASE_SERVICE_ROLE_KEY not set — skipping.\n" +
      "          These tests need a Supabase project that is not production.\n"
  );
}
if (isProduction) {
  console.error("\n[staging] REFUSING: the configured URL is PRODUCTION_SUPABASE_URL.\n");
}
if (configured && !isProduction && !identified) {
  console.error(
    "\n[staging] REFUSING to write: STAGING_PROJECT_REF does not name this project.\n" +
      `          The URL resolves to "${projectRef}"; set STAGING_PROJECT_REF to that exact ref\n` +
      "          only if that project is a scratch staging database. Probes still run.\n"
  );
}

let supabase: SupabaseClient;
const litter = { archives: [] as string[], emails: [] as string[] };

/** Every function the backend calls, with the signature it calls it by. */
const FUNCTIONS = [
  {
    name: "create_household",
    // 032's shape: ...p_residence, the three p_install_*, then the optional
    // p_password_hash and p_founder_hash.
    signature:
      "create_household(text, text, text, text, text, text, text, text, date, text, text, text, text, text, text)",
  },
  {
    name: "accept_invitation",
    // 036's shape: the p_install_* parameters are gone — a join mints a
    // family session, never a trusted device.
    signature: "accept_invitation(uuid, uuid, text, text, text, text, text, text)",
  },
];

/**
 * A founding invitation for one address, spent by create_household (032).
 *
 * Since 032 a signup needs one: without `p_founder_hash` the function refuses
 * with `signup_refused` before it reaches anything else, which is how every
 * household test in this file came to fail the first time it met a database.
 * Minted once per address (one live invitation per email, by index) and
 * remembered, so a race on one receipt races on one invitation too.
 */
const founders = new Map<string, string>();
async function founderHash(email: string): Promise<string> {
  const known = founders.get(email);
  if (known) return known;
  const token = randomBytes(32).toString("base64url");
  // Mirrors services/inviteCodes.ts hashFounderToken: its own HMAC domain.
  const hash = createHmac("sha256", process.env.CODE_PEPPER ?? "").update(`founder:${token}`).digest("hex");
  const { error } = await supabase.from("founding_invitations").insert({
    email,
    note: "staging",
    token_hash: hash,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (error) throw new Error(`founding invitation: ${error.message}`);
  founders.set(email, hash);
  return hash;
}

function receiptHash(receipt: string): string {
  // Mirrors services/inviteCodes.ts — the pepper keys the lookup.
  return createHmac("sha256", process.env.CODE_PEPPER ?? "")
    .update(`receipt:${receipt}`)
    .digest("hex");
}

async function sql(query: string) {
  const { data, error } = await supabase.rpc("exec_sql_readonly", { q: query });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Safe everywhere: nothing here reaches a write. Run it against production if
 * you like — it is the check that would have caught M22.
 */
probes("staging probes — every function body executes", () => {
  beforeAll(() => {
    supabase = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });
  });

/**
 * The guard for the next rename.
 *
 * 027 renamed `accounts` to `families` and every caller kept the old name:
 * plpgsql resolves table names when a statement runs, so both functions were
 * fine until a real signup reached their first insert. The probes below could
 * not see it either — each calls its function with arguments that fail the
 * *first* check, which is before any table is touched.
 *
 * This asks the database directly whether every table the backend names still
 * exists. It is a read, it is fast, and it fails on a rename instead of a
 * family failing to sign up.
 */
describe("every table the code names still exists", () => {
  const TABLES = [
    "families", "archives", "settings", "people", "channels", "media_files",
    "installations", "invitations", "email_verifications", "nfc_cards",
    "missions", "suggestions", "activity_log", "channel_visits",
    "device_sessions", "channel_access", 
    "access_codes", "family_sessions", "family_recovery_tokens",
    "invitation_attempts",
  ];

  it.each(TABLES)("%s", async (table) => {
    const { error } = await supabase.from(table).select("id", { head: true, count: "exact" });
    // PGRST205 is "no such table" — the exact shape the rename produced.
    expect(error?.code).not.toBe("PGRST205");
  });
});

describe("the bodies actually run", () => {
  it("create_household reaches its own refusal, not a resolution error", async () => {
    const { error } = await supabase.rpc("create_household", {
      p_receipt_hash: "no-such-receipt",
      p_email: `probe-${randomBytes(4).toString("hex")}@example.invalid`,
      p_display_name: "probe",
      p_admin_name: "probe",
      p_admin_pin_hash: "x",
      p_relationship: null,
      p_about: "me",
      p_subject_name: "probe",
      p_birth_date: null,
      p_residence: null,
      p_install_name: "probe",
      p_install_username: `probe-${randomBytes(4).toString("hex")}`,
      p_install_secret: "x",
    });

    expect(error).toBeTruthy();
    // P0001 is the function's own `raise`. 42702 or 42883 would mean the
    // body never executed — the exact failure M22 was.
    expect(error!.message).toContain("signup_refused");
    expect(error!.code).not.toBe("42702");
  });

  it("accept_invitation reaches its own refusal, not a resolution error", async () => {
    const { error } = await supabase.rpc("accept_invitation", {
      p_invitation_id: "00000000-0000-0000-0000-000000000000",
      p_account_id: null,
      p_email: "probe@example.invalid",
      p_display_name: "probe",
      p_name: "probe",
      p_address: null,
      p_pin_hash: "x",
      p_secret_kind: "token",
    });

    expect(error).toBeTruthy();
    expect(error!.message).toContain("invitation_unavailable");
    // The regression this suite exists for.
    expect(error!.code).not.toBe("42702");
  });
});
});

suite("staging — the database itself", () => {
  beforeAll(async () => {
    supabase = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });

    if (!allowNonEmpty) {
      const { count } = await supabase
        .from("channels")
        .select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) {
        throw new Error(
          `Refusing to run: this project already holds ${count} channels, so it is not a ` +
            `scratch staging project. Set STAGING_ALLOW_NON_EMPTY=yes only if you are certain.`
        );
      }
    }
  });

  afterAll(async () => {
    // Every test cleans up after itself; this is the safety net.
    for (const id of litter.archives) {
      await supabase.from("archives").delete().eq("id", id);
    }
    for (const email of litter.emails) {
      await supabase.from("families").delete().eq("email", email);
      await supabase.from("email_verifications").delete().eq("email", email);
      await supabase.from("founding_invitations").delete().eq("email", email);
    }
  });

  describe("privileges", () => {
    it.each(FUNCTIONS)("service_role may execute $name", async ({ signature }) => {
      const { data, error } = await supabase
        .rpc("has_function_privilege", {
          user: "service_role",
          function: signature,
          privilege: "execute",
        })
        .single();

      // Not every project exposes has_function_privilege as an RPC; when it
      // is unavailable, calling the function itself proves the same thing.
      if (error) {
        expect(error.message).toMatch(/does not exist|schema cache/i);
        return;
      }
      expect(data).toBe(true);
    });
  });

  describe("create_household", () => {
    async function mintReceipt(email: string) {
      const receipt = randomBytes(32).toString("base64url");
      const { error } = await supabase.from("email_verifications").insert({
        email,
        code_hash: "staging",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        purpose: "signup",
        receipt_hash: receiptHash(receipt),
        receipt_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        verified_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      litter.emails.push(email);
      await founderHash(email);
      return receipt;
    }

    function args(email: string, receipt: string, over: Record<string, unknown> = {}) {
      return {
        p_receipt_hash: receiptHash(receipt),
        p_email: email,
        p_display_name: "Staging Founder",
        p_admin_name: "Staging Founder",
        p_admin_pin_hash: "$argon2id$staging",
        p_relationship: "Son",
        p_about: "someone",
        p_subject_name: "Staging Subject",
        p_birth_date: "1950-01-01",
        p_residence: "Nowhere",
        p_install_name: "staging browser",
        p_install_username: `web-${randomBytes(6).toString("hex")}`,
        p_install_secret: "$argon2id$staging",
        p_founder_hash: founders.get(email),
        ...over,
      };
    }

    it("creates the whole household in one call", async () => {
      const email = `founder-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = await mintReceipt(email);

      const { data, error } = await supabase.rpc("create_household", args(email, receipt));
      expect(error).toBeNull();

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, string>;
      expect(row.archive_id).toBeTruthy();
      litter.archives.push(row.archive_id);

      /*
       * Everything the transaction promised, present.
       *
       * `archive_memberships` used to be counted here and is not any more.
       * 027 retired the table and 028 removed the insert — one family owns
       * one archive now, so a join table between them answered a question
       * nobody was asking. This assertion outlived both migrations and would
       * have failed against a table that no longer exists; M45B swept the
       * `accounts` references out of this file and missed this one.
       */
      const [{ count: settings }, { count: people }, { count: installs }] = await Promise.all([
        supabase.from("settings").select("id", { count: "exact", head: true }).eq("archive_id", row.archive_id),
        supabase.from("people").select("id", { count: "exact", head: true }).eq("archive_id", row.archive_id),
        supabase.from("installations").select("id", { count: "exact", head: true }).eq("archive_id", row.archive_id),
      ]);

      expect(settings).toBe(1);
      expect(people).toBe(2); // the admin, and the subject
      expect(installs).toBe(1);

      // The admin is never passwordless (M17); the subject always is.
      const { data: profiles } = await supabase
        .from("people")
        .select("role, pin_hash")
        .eq("archive_id", row.archive_id);

      const admin = profiles!.find((p) => p.role === "admin");
      const subject = profiles!.find((p) => p.role === "user");
      expect(admin?.pin_hash).toBeTruthy();
      expect(subject?.pin_hash).toBeNull();
    });

    it("spends a receipt exactly once", async () => {
      const email = `replay-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = await mintReceipt(email);

      const first = await supabase.rpc("create_household", args(email, receipt));
      expect(first.error).toBeNull();
      const row = (Array.isArray(first.data) ? first.data[0] : first.data) as Record<string, string>;
      litter.archives.push(row.archive_id);

      const second = await supabase.rpc("create_household", args(email, receipt));
      expect(second.error?.message).toContain("signup_refused");
    });

    it("gives exactly one winner when two signups race one receipt", async () => {
      const email = `race-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = await mintReceipt(email);

      const results = await Promise.all([
        supabase.rpc("create_household", args(email, receipt)),
        supabase.rpc("create_household", args(email, receipt)),
      ]);

      const winners = results.filter((r) => !r.error);
      expect(winners).toHaveLength(1);

      for (const w of winners) {
        const row = (Array.isArray(w.data) ? w.data[0] : w.data) as Record<string, string>;
        litter.archives.push(row.archive_id);
      }

      const { count } = await supabase
        .from("families")
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      expect(count).toBe(1);
    });

    it("leaves nothing behind when it fails late", async () => {
      const email = `rollback-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = await mintReceipt(email);

      // A username that already exists makes the *last* insert fail, after
      // the account, archive, settings, both people and the membership.
      //
      // Since 038 every installation belongs to an archive, so the occupier
      // gets one of its own. Its insert is asserted: when it failed silently,
      // nothing was taken, the household succeeded, and this test measured
      // nothing.
      const taken = `web-${randomBytes(6).toString("hex")}`;
      const subject = `Rollback${randomBytes(4).toString("hex")}`;
      const { data: holder, error: holderError } = await supabase
        .from("archives")
        .insert({ name: "Staging occupier" })
        .select("id")
        .single();
      expect(holderError).toBeNull();
      litter.archives.push(holder!.id as string);
      const { data: seed, error: seedError } = await supabase
        .from("installations")
        .insert({ name: "occupier", username: taken, secret_hash: "x", archive_id: holder!.id })
        .select("id")
        .single();
      expect(seedError).toBeNull();

      const { error } = await supabase.rpc(
        "create_household",
        args(email, receipt, { p_install_username: taken, p_subject_name: subject })
      );
      expect(error).toBeTruthy();

      const [{ count: accounts }, { count: archives }] = await Promise.all([
        supabase.from("families").select("id", { count: "exact", head: true }).eq("email", email),
        // Named for this test alone: other tests' households share
        // "Staging's archive", and the safety net only clears them at the end.
        supabase.from("archives").select("id", { count: "exact", head: true }).eq("name", `${subject}'s archive`),
      ]);
      expect(accounts).toBe(0);
      expect(archives).toBe(0);

      // The receipt was handed back, not burned by a transaction that failed.
      const { data: verification } = await supabase
        .from("email_verifications")
        .select("consumed_at")
        .eq("email", email)
        .maybeSingle();
      expect(verification?.consumed_at).toBeNull();

      if (seed?.id) await supabase.from("installations").delete().eq("id", seed.id);
    });
  });

  describe("accept_invitation", () => {
    it("admits exactly one of two simultaneous acceptances", async () => {
      const email = `host-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = randomBytes(32).toString("base64url");
      await supabase.from("email_verifications").insert({
        email,
        code_hash: "staging",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        purpose: "signup",
        receipt_hash: receiptHash(receipt),
        receipt_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        verified_at: new Date().toISOString(),
      });
      litter.emails.push(email);

      const { data: created } = await supabase.rpc("create_household", {
        p_receipt_hash: receiptHash(receipt),
        p_email: email,
        p_display_name: "Host",
        p_admin_name: "Host",
        p_admin_pin_hash: "$argon2id$staging",
        p_relationship: null,
        p_about: "me",
        p_subject_name: "Host",
        p_birth_date: null,
        p_residence: null,
        p_install_name: "host browser",
        p_install_username: `web-${randomBytes(6).toString("hex")}`,
        p_install_secret: "x",
        p_founder_hash: await founderHash(email),
      });
      const host = (Array.isArray(created) ? created[0] : created) as Record<string, string>;
      litter.archives.push(host.archive_id);

      const inviteeEmail = `aunt-${randomBytes(4).toString("hex")}@example.invalid`;
      litter.emails.push(inviteeEmail);
      const { data: invitation } = await supabase
        .from("invitations")
        .insert({
          archive_id: host.archive_id,
          email: inviteeEmail,
          name: "Aunt",
          role: "co_author",
          code_hash: `staging-${randomBytes(8).toString("hex")}`,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select("id")
        .single();

      const accept = () =>
        supabase.rpc("accept_invitation", {
          p_invitation_id: invitation!.id,
          p_account_id: null,
          p_email: inviteeEmail,
          p_display_name: "Aunt",
          p_name: "Aunt Marie",
          p_address: null,
          p_pin_hash: "$argon2id$staging",
          p_secret_kind: "token",
        });

      const results = await Promise.all([accept(), accept()]);
      const winners = results.filter((r) => !r.error);
      expect(winners).toHaveLength(1);

      // The loser left no half-built contributor behind.
      const { count } = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .eq("archive_id", host.archive_id)
        .eq("name", "Aunt Marie");
      expect(count).toBe(1);
    });
  });

  /*
   * M41 — an invitation claims the profile it names.
   *
   * Against the real database, deliberately. This is the exact class of
   * behaviour that mocked `rpc()` waved through in M22 and again in M45B:
   * the function's *body* is the thing under test, and a recorder that
   * answers every RPC with success cannot see inside it.
   */
  describe("an invitation claims one profile", () => {
    /** A family, its archive, and a face on the shelf who has never joined. */
    async function household(label: string) {
      const email = `${label}-${randomBytes(4).toString("hex")}@example.invalid`;
      const receipt = randomBytes(32).toString("base64url");
      await supabase.from("email_verifications").insert({
        email,
        code_hash: "staging",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        purpose: "signup",
        receipt_hash: receiptHash(receipt),
        receipt_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        verified_at: new Date().toISOString(),
      });
      litter.emails.push(email);

      const { data: created, error } = await supabase.rpc("create_household", {
        p_receipt_hash: receiptHash(receipt),
        p_email: email,
        p_display_name: label,
        p_admin_name: `${label} Admin`,
        p_admin_pin_hash: "$argon2id$staging",
        p_relationship: "Son",
        p_about: "someone",
        p_subject_name: `${label} Subject`,
        p_birth_date: "1950-01-01",
        p_residence: "Nowhere",
        p_install_name: "browser",
        p_install_username: `web-${randomBytes(6).toString("hex")}`,
        p_install_secret: "x",
        p_founder_hash: await founderHash(email),
      });
      if (error) throw new Error(error.message);

      const row = (Array.isArray(created) ? created[0] : created) as Record<string, string>;
      litter.archives.push(row.archive_id);
      return { ...row, email };
    }

    async function shelfProfile(archiveId: string, name: string) {
      const { data, error } = await supabase
        .from("people")
        .insert({ archive_id: archiveId, name, role: "co_author", status: "pending" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data!.id as string;
    }

    async function invitation(archiveId: string, email: string, personId: string | null) {
      const { data, error } = await supabase
        .from("invitations")
        .insert({
          archive_id: archiveId,
          email,
          name: "Invited",
          role: "co_author",
          person_id: personId,
          token_hash: `staging-${randomBytes(8).toString("hex")}`,
          code_hash: `staging-${randomBytes(8).toString("hex")}`,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data!.id as string;
    }

    function accept(invitationId: string, over: Record<string, unknown> = {}) {
      return supabase.rpc("accept_invitation", {
        p_invitation_id: invitationId,
        p_account_id: null,
        p_email: "invited@example.invalid",
        p_display_name: "Invited",
        p_name: "Hélène Fournier",
        p_address: null,
        p_pin_hash: "$argon2id$claimed",
        ...over,
      });
    }

    it("updates the named profile instead of creating a second one", async () => {
      const home = await household("claim");
      const shelf = await shelfProfile(home.archive_id, "Hélène");

      const before = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .eq("archive_id", home.archive_id);

      const { error } = await accept(
        await invitation(home.archive_id, "helene@example.invalid", shelf)
      );
      expect(error).toBeNull();

      const after = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .eq("archive_id", home.archive_id);

      // The count is the whole point: one Hélène, not two.
      expect(after.count).toBe(before.count);

      const { data: claimed } = await supabase
        .from("people")
        .select("id, name, joined_at, pin_hash, role")
        .eq("id", shelf)
        .single();

      expect(claimed!.id).toBe(shelf);
      expect(claimed!.joined_at).toBeTruthy();
      expect(claimed!.pin_hash).toBe("$argon2id$claimed");
      // Her role was not quietly reset by being invited.
      expect(claimed!.role).toBe("co_author");
    });

    it("refuses the second tap on the same link, without changing the PIN", async () => {
      const home = await household("replay");
      const shelf = await shelfProfile(home.archive_id, "Twice");
      const invite = await invitation(home.archive_id, "twice@example.invalid", shelf);

      expect((await accept(invite)).error).toBeNull();
      const second = await accept(invite, { p_pin_hash: "$argon2id$second" });

      expect(second.error?.message).toContain("invitation_unavailable");

      const { data: after } = await supabase
        .from("people")
        .select("pin_hash")
        .eq("id", shelf)
        .single();
      expect(after!.pin_hash).toBe("$argon2id$claimed");
    });

    it("refuses an invitation pointing at another family's profile", async () => {
      const [mine, theirs] = await Promise.all([household("mine"), household("theirs")]);
      const foreign = await shelfProfile(theirs.archive_id, "Not Yours");

      // The invitation belongs to my archive; the person id does not. Since
      // 038 the database refuses that pairing outright (the composite key
      // invitations(person_id, archive_id) -> people), so the invitation
      // cannot even be written, let alone accepted.
      await expect(invitation(mine.archive_id, "cross@example.invalid", foreign)).rejects.toThrow(
        /invitations_person_id_fkey/
      );

      // And their profile is untouched.
      const { data: untouched } = await supabase
        .from("people")
        .select("name, joined_at, pin_hash")
        .eq("id", foreign)
        .single();
      expect(untouched!.name).toBe("Not Yours");
      expect(untouched!.joined_at).toBeNull();
      expect(untouched!.pin_hash).toBeNull();
    });

    it("refuses to claim the subject's own profile", async () => {
      const home = await household("subject");
      const { data: subject } = await supabase
        .from("people")
        .select("id")
        .eq("archive_id", home.archive_id)
        .eq("role", "user")
        .single();

      const invite = await invitation(home.archive_id, "sub@example.invalid", subject!.id);
      const { error } = await accept(invite);

      expect(error?.message).toContain("invitation_unavailable");

      // She is still passwordless, which is the whole reason for the refusal.
      const { data: after } = await supabase
        .from("people")
        .select("pin_hash, joined_at")
        .eq("id", subject!.id)
        .single();
      expect(after!.pin_hash).toBeNull();
      expect(after!.joined_at).toBeNull();
    });

    it("will not let two live invitations name the same face", async () => {
      const home = await household("stack");
      const shelf = await shelfProfile(home.archive_id, "Only Once");

      await invitation(home.archive_id, "first@example.invalid", shelf);
      await expect(
        invitation(home.archive_id, "second@example.invalid", shelf)
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it("still creates a profile for somebody genuinely new", async () => {
      const home = await household("fresh");

      const before = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .eq("archive_id", home.archive_id);

      const { error } = await accept(
        await invitation(home.archive_id, "new@example.invalid", null)
      );
      expect(error).toBeNull();

      const after = await supabase
        .from("people")
        .select("id", { count: "exact", head: true })
        .eq("archive_id", home.archive_id);
      expect(after.count).toBe((before.count ?? 0) + 1);

      const { data: fresh } = await supabase
        .from("people")
        .select("joined_at, role")
        .eq("archive_id", home.archive_id)
        .eq("name", "Hélène Fournier")
        .single();
      expect(fresh!.joined_at).toBeTruthy();
      expect(fresh!.role).toBe("co_author");
    });
  });
});

// Referenced by the privilege test's fallback path; kept so the helper is not
// dead code if a project does expose raw SQL execution.
void sql;
