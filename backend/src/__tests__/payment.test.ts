import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * The first euro (055) — manual invoices, moved only by the platform owner.
 *
 * Outward: every payment route is on the owner surface, so a family admin,
 * a stranger and a device all get the same 404 the rest of /owner gives.
 * Inward: each move reads the state first and refuses (409) when the family
 * is not where the move starts, then writes a conditional update keyed on
 * that same state — two owner tabs cannot invoice the same family twice.
 * The family itself reads what is owed through /family/payment, with a
 * profile, never as the bare display.
 *
 * The recorder answers a query by table, never by filter, so the acted-on
 * family and the platform row are one row here. What these tests prove is
 * the QUERY each route sends and the state it refuses on.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const MINE = "aaaaaaaa-0000-0000-0000-00000000000a";
const THEIRS = "bbbbbbbb-0000-0000-0000-00000000000b";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ME = "aaaaaaaa-0000-0000-0000-0000000000ad";

function device(archiveId: string) {
  return [`recall_device=${jwt.sign({ installationId: INSTALL, archiveId }, SECRET, { expiresIn: 3600 })}`];
}
function session(archiveId: string, role = "admin") {
  if (archiveId === MINE) return ["recall_family=owner-session-token"];
  return [
    ...device(archiveId),
    `recall_profile=${jwt.sign({ personId: ME, name: "Andy", role, archiveId }, SECRET, {
      expiresIn: 3600,
    })}`,
  ];
}

/** The family in a given payment state. */
function inState(state: string, extra: Record<string, unknown> = {}) {
  return {
    payment_state: state,
    tier: state === "none" ? null : "digital",
    invoice_number: state === "none" ? null : "R-2026-0001",
    invoice_amount_cents: state === "none" ? null : 2500,
    invoiced_at: state === "none" ? null : "2026-09-10T00:00:00.000Z",
    paid_at: state === "active" ? "2026-09-12T00:00:00.000Z" : null,
    activated_at: state === "active" ? "2026-09-12T00:00:00.000Z" : null,
    paused_at: state === "paused" ? "2026-09-15T00:00:00.000Z" : null,
    ...extra,
  };
}

function world(isOwner: boolean, payment: Record<string, unknown> = inState("none")) {
  recorder.reset({
    families: [
      {
        id: "fam-1",
        archive_id: MINE,
        display_name: "Fournier",
        email: "andy@example.invalid",
        created_at: "2026-01-01T00:00:00.000Z",
        platform_owner: isOwner,
        subscription: null,
        ...payment,
        status: "active",
        session_version: 1,
      },
    ],
    family_sessions: [{
      id: "owner-session",
      family_id: "fam-1",
      archive_id: MINE,
      person_id: null,
      role: null,
      session_version: 1,
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    }],
    people: [{ id: ME, archive_id: MINE, name: "Andy", role: "admin", status: "active", archived_at: null }],
    installations: [{ id: INSTALL, archive_id: MINE, is_trusted: true, revoked_at: null }],
    "rpc:next_invoice_number": ["R-2026-0001"],
  });
}

const updates = () => recorder.forTable("families").filter((q) => q.op === "update");

beforeEach(() => world(true));

describe("who may move a family's money", () => {
  it("a family admin who is not the platform owner meets the same 404 as the rest of /owner", async () => {
    world(false);
    const res = await request(app)
      .post("/api/owner/families/fam-1/invoice")
      .set("Cookie", session(MINE))
      .send({ tier: "digital" });
    expect(res.status).toBe(404);
    expect(updates()).toHaveLength(0);
  });

  it("nobody anonymous moves anything", async () => {
    for (const path of ["/invoice", "/paid", "/pause", "/resume", "/close"]) {
      const res = await request(app).post(`/api/owner/families/fam-1${path}`).send({ tier: "digital" });
      expect(res.status).toBe(404);
    }
    expect(updates()).toHaveLength(0);
  });
});

describe("invoicing", () => {
  it("issues a database-minted number, the tier's price incl. VAT, and moves none → invoiced", async () => {
    const res = await request(app)
      .post("/api/owner/families/fam-1/invoice")
      .set("Cookie", session(MINE))
      .send({ tier: "digital" });

    expect(res.status).toBe(201);
    expect(recorder.forTable("rpc:next_invoice_number")).toHaveLength(1);
    const [update] = updates();
    expect(update?.payload).toMatchObject({
      payment_state: "invoiced",
      tier: "digital",
      invoice_number: "R-2026-0001",
      invoice_amount_cents: 2500,
    });
    // Keyed on the state it leaves: only a family with nothing running.
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "id", value: "fam-1" },
        { method: "in", column: "payment_state", value: ["none", "closed"] },
      ])
    );
  });

  it("refuses a configuration with no settled price unless the amount is given", async () => {
    const bare = await request(app)
      .post("/api/owner/families/fam-1/invoice")
      .set("Cookie", session(MINE))
      .send({ tier: "dock" });
    expect(bare.status).toBe(400);
    expect(updates()).toHaveLength(0);

    const priced = await request(app)
      .post("/api/owner/families/fam-1/invoice")
      .set("Cookie", session(MINE))
      .send({ tier: "dock", amount_cents: 46500 });
    expect(priced.status).toBe(201);
    expect(updates()[0]?.payload).toMatchObject({ invoice_amount_cents: 49000 }); // 46500 device + 2500 default monthly
  });

  it("refuses to invoice a family that already has one — 409, no number minted, no write", async () => {
    world(true, inState("invoiced"));
    const res = await request(app)
      .post("/api/owner/families/fam-1/invoice")
      .set("Cookie", session(MINE))
      .send({ tier: "digital" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("wrong_state");
    expect(updates()).toHaveLength(0);
    expect(recorder.forTable("rpc:next_invoice_number")).toHaveLength(0);
  });
});

describe("the moves after the invoice", () => {
  it("paid: invoiced → active, stamps paid_at and activated_at, and fills the 034 subscription seam", async () => {
    world(true, inState("invoiced"));
    const res = await request(app).post("/api/owner/families/fam-1/paid").set("Cookie", session(MINE));
    expect(res.status).toBe(200);
    const [update] = updates();
    expect(update?.payload).toMatchObject({ payment_state: "active", subscription: "digital", paused_at: null });
    expect((update?.payload as Record<string, unknown>).paid_at).toBeTruthy();
    expect((update?.payload as Record<string, unknown>).activated_at).toBeTruthy();
    expect(update?.filters).toEqual(
      expect.arrayContaining([{ method: "in", column: "payment_state", value: ["invoiced", "paused"] }])
    );
  });

  it("pause: active → paused", async () => {
    world(true, inState("active"));
    const res = await request(app).post("/api/owner/families/fam-1/pause").set("Cookie", session(MINE));
    expect(res.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ payment_state: "paused" });
  });

  it("resume: back to active when it was paid, back to invoiced when it never was", async () => {
    world(true, inState("paused", { paid_at: "2026-09-12T00:00:00.000Z" }));
    const paid = await request(app).post("/api/owner/families/fam-1/resume").set("Cookie", session(MINE));
    expect(paid.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ payment_state: "active", paused_at: null });

    world(true, inState("paused", { paid_at: null }));
    const unpaid = await request(app).post("/api/owner/families/fam-1/resume").set("Cookie", session(MINE));
    expect(unpaid.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ payment_state: "invoiced", paused_at: null });
  });

  it("close: ends the plan and empties the subscription seam", async () => {
    world(true, inState("active"));
    const res = await request(app).post("/api/owner/families/fam-1/close").set("Cookie", session(MINE));
    expect(res.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ payment_state: "closed", subscription: null });
  });

  it("a move from the wrong state is refused before any write", async () => {
    world(true, inState("none"));
    const res = await request(app).post("/api/owner/families/fam-1/paid").set("Cookie", session(MINE));
    expect(res.status).toBe(409);
    expect(updates()).toHaveLength(0);
  });

  it("an unknown action is a 404, not a state change", async () => {
    world(true, inState("active"));
    const res = await request(app).post("/api/owner/families/fam-1/refund").set("Cookie", session(MINE));
    expect(res.status).toBe(404);
    expect(updates()).toHaveLength(0);
  });
});

describe("the printed invoice", () => {
  it("carries the number, the amounts, the buyer and whom the archive is for — and nothing without an invoice", async () => {
    world(true, inState("invoiced"));
    recorder.reset({
      families: [
        {
          id: "fam-1",
          archive_id: MINE,
          display_name: "Fournier",
          email: "andy@example.invalid",
          platform_owner: true,
          status: "active",
          session_version: 1,
          ...inState("invoiced"),
        },
      ],
      family_sessions: [{
        id: "owner-session",
        family_id: "fam-1",
        archive_id: MINE,
        person_id: null,
        role: null,
        session_version: 1,
        expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: null,
      }],
      people: [{ id: ME, archive_id: MINE, name: "Andy", role: "admin", address: "Voorbeeldstraat 1, 1000 Brussel", status: "active", archived_at: null }],
      installations: [{ id: INSTALL, archive_id: MINE, is_trusted: true, revoked_at: null }],
      settings: [{ archive_id: MINE, display_name: "Margaret" }],
    });
    const res = await request(app).get("/api/owner/families/fam-1/invoice").set("Cookie", session(MINE));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      invoice_number: "R-2026-0001",
      amount_cents: 2500,
      monthly_cents: 2500,
      yearly_cents: 27500,
      tier_label: "Recall",
      due_at: "2026-09-24T00:00:00.000Z",
      buyer: { family_name: "Fournier", admin_name: "Andy", address: "Voorbeeldstraat 1, 1000 Brussel" },
      for_whom: "Margaret",
    });

    world(true, inState("none"));
    const none = await request(app).get("/api/owner/families/fam-1/invoice").set("Cookie", session(MINE));
    expect(none.status).toBe(404);
  });
});

describe("what the family reads about its own money", () => {
  function theirs(state: string) {
    recorder.reset({
      families: [
        { id: "fam-2", archive_id: THEIRS, display_name: "Peeters", email: "peeters@example.invalid", platform_owner: false, ...inState(state) },
      ],
      people: [{ id: ME, archive_id: THEIRS, name: "Jan", role: "co_author", status: "active", archived_at: null }],
      installations: [{ id: INSTALL, archive_id: THEIRS, is_trusted: true, revoked_at: null }],
    });
  }

  it("a signed-in member sees the state, the invoice and a due date 14 days after invoicing", async () => {
    theirs("invoiced");
    const res = await request(app).get("/api/family/payment").set("Cookie", session(THEIRS, "co_author"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ payment_state: "invoiced", invoice_number: "R-2026-0001", invoice_amount_cents: 2500 });
    expect(res.body.due_at).toBe("2026-09-24T00:00:00.000Z");
    const q = recorder.forTable("families").find((x) => x.op === "select");
    expect(q?.filters).toEqual(expect.arrayContaining([{ method: "eq", column: "archive_id", value: THEIRS }]));
  });

  it("the bare display — a device cookie with nobody at the keyboard — is refused", async () => {
    theirs("invoiced");
    const res = await request(app).get("/api/family/payment").set("Cookie", device(THEIRS));
    expect(res.status).toBe(401);
    expect(recorder.forTable("families")).toHaveLength(0);
  });

  it("anonymous is refused", async () => {
    const res = await request(app).get("/api/family/payment");
    expect(res.status).toBe(401);
  });
});
