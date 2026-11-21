import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import argon2 from "argon2";
import request from "supertest";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "dotenv";
import type { Express } from "express";

config();

/**
 * A typed address matches one family exactly, proven against a real database.
 *
 * `.ilike()` hands its value to Postgres as a LIKE pattern, so `_` and `%` are
 * wildcards. Before `exactIlike`, a stranger who typed `jan_peeters@…` was
 * matched to the family stored as `jan.peeters@…`, and /recover mailed that
 * family's reset link to the address the stranger typed.
 *
 * The offline suite proves every route hands `.ilike()` the escaped pattern.
 * It cannot prove that the escaped pattern then *means* "exactly this": a
 * mock has no LIKE. This file asks a real PostgREST and a real Postgres, and
 * goes through the real routes, so it checks the escape and the routes in one.
 *
 * Same guards as staging.test.ts: it runs only with STAGING_* credentials,
 * refuses PRODUCTION_SUPABASE_URL, and writes only when STAGING_PROJECT_REF
 * names the project the URL resolves to. Everything it creates it removes.
 */

const url = process.env.STAGING_SUPABASE_URL ?? "";
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? "";
const productionUrl = process.env.PRODUCTION_SUPABASE_URL ?? "";
const projectRef = (() => {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
})();
const identified = !!projectRef && projectRef === (process.env.STAGING_PROJECT_REF ?? "");
const isProduction = !!productionUrl && url.trim() === productionUrl.trim();
const suite = url && key && identified && !isProduction ? describe : describe.skip;

const PEPPER = randomBytes(32).toString("hex");
const hmac = (domain: string, value: string) =>
  createHmac("sha256", PEPPER).update(`${domain}:${value}`).digest("hex");

const tag = randomBytes(4).toString("hex");
const STORED = `jan.peeters-${tag}@example.invalid`;
const PASSWORD = `staging-${randomBytes(9).toString("base64url")}`;

/** Addresses a stranger could type, none of which is the family's. */
const WILDCARDS = [
  `jan_peeters-${tag}@example.invalid`, // `_` stands for the `.`
  `jan%-${tag}@example.invalid`, // `%` stands for ".peeters"
  `%-${tag}@example.invalid`, // `%` stands for the whole local part
  `jan.peeters-${tag}@example.invali_`, // a wildcard in the domain
];

let supabase: SupabaseClient;
let app: Express;
let familyId = "";
let archiveId = "";

async function tokens(purpose: string) {
  const { data, error } = await supabase
    .from("family_recovery_tokens")
    .select("id")
    .eq("family_id", familyId)
    .eq("purpose", purpose);
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

async function clearTokens() {
  await supabase.from("family_recovery_tokens").delete().eq("family_id", familyId);
}

suite("a typed address never matches another family (real database)", () => {
  beforeAll(async () => {
    supabase = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

    // The app reads its configuration when it is first imported.
    Object.assign(process.env, {
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SESSION_SECRET: randomBytes(48).toString("base64"),
      CODE_PEPPER: PEPPER,
      EMAIL_USER: "",
      EMAIL_PASS: "",
      NODE_ENV: "test",
    });
    const { createApp } = await import("../../app.js");
    app = createApp() as unknown as Express;

    // One real family, created the way signup creates one.
    const receipt = randomBytes(32).toString("base64url");
    const founder = randomBytes(32).toString("base64url");
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const v = await supabase.from("email_verifications").insert({
      email: STORED, code_hash: "staging", expires_at: soon, purpose: "signup",
      receipt_hash: hmac("receipt", receipt), receipt_expires_at: soon, verified_at: new Date().toISOString(),
    });
    if (v.error) throw new Error(v.error.message);
    const f = await supabase.from("founding_invitations").insert({
      email: STORED, note: "staging: wildcard addresses", token_hash: hmac("founder", founder), expires_at: soon,
    });
    if (f.error) throw new Error(f.error.message);

    const { data, error } = await supabase.rpc("create_household", {
      p_receipt_hash: hmac("receipt", receipt),
      p_email: STORED,
      p_display_name: "Staging",
      p_admin_name: "Staging Admin",
      p_admin_pin_hash: "$argon2id$staging",
      p_relationship: "Daughter",
      p_about: "someone",
      p_subject_name: "Staging Subject",
      p_birth_date: "1950-01-01",
      p_residence: "Nowhere",
      p_install_name: "staging browser",
      p_install_username: `web-${tag}`,
      p_install_secret: "$argon2id$staging",
      p_password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      p_founder_hash: hmac("founder", founder),
    });
    if (error) throw new Error(`create_household: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, string>;
    familyId = row.account_id;
    archiveId = row.archive_id;
  });

  afterAll(async () => {
    if (!supabase) return;
    if (familyId) await clearTokens();
    if (archiveId) await supabase.from("archives").delete().eq("id", archiveId);
    await supabase.from("families").delete().eq("email", STORED);
    await supabase.from("founding_invitations").delete().eq("email", STORED);
    await supabase.from("email_verifications").delete().eq("email", STORED);
  });

  it("the danger is real here: a raw pattern does match the family", async () => {
    // Without this, every "matches nothing" below could be a database that
    // simply has no family in it.
    const { data } = await supabase.from("families").select("id").ilike("email", WILDCARDS[0]);
    expect(data?.map((r) => r.id)).toContain(familyId);
  });

  it("/recover: the exact address mints a password link (the control)", async () => {
    await clearTokens();
    const res = await request(app).post("/api/family/recover").send({ email: STORED.toUpperCase() });
    expect(res.status).toBe(200);
    expect(await tokens("password")).toBe(1);
  });

  it.each(WILDCARDS)("/recover: %s mints nothing for the family", async (typed) => {
    await clearTokens();
    const res = await request(app).post("/api/family/recover").send({ email: typed });
    expect(res.status).toBe(200); // the same calm answer as any unknown address
    expect(await tokens("password")).toBe(0);
  });

  it.each(WILDCARDS)("/replace-screen: %s mints nothing for the family", async (typed) => {
    await clearTokens();
    const res = await request(app).post("/api/family/replace-screen").send({ email: typed });
    expect(res.status).toBeLessThan(500);
    expect(await tokens("device")).toBe(0);
  });

  it.each(WILDCARDS)("/login: %s with the right password is refused", async (typed) => {
    const res = await request(app).post("/api/family/login").send({ email: typed, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"] ?? []).toHaveLength(0);
  });

  it("/login: the exact address with the right password is let in (the control)", async () => {
    const res = await request(app).post("/api/family/login").send({ email: STORED, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});
