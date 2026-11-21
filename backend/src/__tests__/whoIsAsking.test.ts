import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  PERSON_ADMIN_COLUMNS,
  PERSON_COLUMNS,
  PERSON_MEMBER_COLUMNS,
} from "../services/dto";
import jwt from "jsonwebtoken";
import { recorder, type RecordedQuery } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M125 — one "who is asking" helper (F39).
 *
 * M116's clean jar exposed the seam it had been masking: routes that chose
 * their column list by a bare `readProfile()` saw a family-session member
 * as nobody, and served a signed-in admin the anonymous display's view —
 * Contributors all "User", the subject listed, contact columns collapsed.
 * Worse, the display-only engagement writes accepted a remote admin's
 * browsing as if Margaret had been watching.
 *
 * The property under test: a person is the same person through either
 * door. A device-session admin and a family-session admin must be served
 * the identical question to the database — and the display, which is
 * nobody, must keep its anonymous columns.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const deviceCookie = `recall_device=${jwt.sign(
  { installationId: INSTALL_A, archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;
const adminProfileCookie = `recall_profile=${jwt.sign(
  { personId: ADMIN_A, name: "Anne", role: "admin", archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

function adminPerson(over: Record<string, unknown> = {}) {
  return {
    id: ADMIN_A,
    name: "Anne",
    role: "admin",
    status: "active",
    archive_id: ARCHIVE_A,
    archived_at: null,
    ...over,
  };
}

/** The elevated family session: the password cleared, Anne's PIN answered. */
function elevatedSession(over: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    family_id: FAMILY_A,
    archive_id: ARCHIVE_A,
    person_id: ADMIN_A,
    role: "admin",
    session_version: 1,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
    ...over,
  };
}

function world(over: Record<string, unknown[]> = {}) {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null }],
    families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, session_version: 1, status: "active" }],
    family_sessions: [],
    people: [adminPerson()],
    channels: [],
    device_sessions: [{ id: "ds-1", started_at: new Date().toISOString() }],
    ...over,
  });
}

/**
 * The route's own people query — the one that chooses a column list — as
 * opposed to `readFamilySession`'s person lookup: only the route's carries
 * the archive filter.
 */
function routePeopleSelect(): RecordedQuery | undefined {
  return recorder
    .forTable("people")
    .filter(
      (q) =>
        q.op === "select" &&
        q.filters.some((f) => f.method === "eq" && f.column === "archive_id")
    )
    .at(-1);
}

beforeEach(() => world());

describe("a person is the same person through either door", () => {
  it("a family-session admin is asked for with the same columns as a device-session admin", async () => {
    await request(app)
      .get("/api/people")
      .set("Cookie", [deviceCookie, adminProfileCookie]);
    const throughDevice = routePeopleSelect()?.select;

    world({ family_sessions: [elevatedSession()] });
    await request(app).get("/api/people").set("Cookie", ["recall_family=an-opaque-token"]);
    const throughFamily = routePeopleSelect()?.select;

    // The admin view, identically, through both doors — contact details
    // included, because an authenticated admin is who they reach.
    expect(throughDevice).toBeDefined();
    expect(throughDevice).toContain("email");
    expect(throughFamily).toBe(throughDevice);
  });

  it("the display stays nobody: anonymous columns, no contact details", async () => {
    await request(app).get("/api/people").set("Cookie", [deviceCookie]);
    const display = routePeopleSelect()?.select;

    expect(display).toBeDefined();
    expect(display).not.toContain("email");
    expect(display).not.toContain("contact_number");
    /*
      044 added `admin_note` — the private note administrators keep about a
      person, "doesn't read email, call her instead". It is contact-shaped
      detail and belongs to the admin columns only.

      Pinned here rather than trusted to the column constant, because the
      constant is exactly what a future edit would change: adding it to
      PERSON_COLUMNS is a one-word mistake that puts an operational note
      about somebody's illness on the screen in their mother's living room.
    */
    expect(display).not.toContain("admin_note");
  });

  /*
    A second guarantee, and deliberately by a different mechanism.

    The assertion above observes what one route actually selected. This one
    reads the column sets themselves, so it holds for every route that will
    ever use them — including ones nobody has written. My first attempt at
    this was the same device-cookie request twice under two names: it passed,
    and it proved one thing while appearing to prove two.
  */
  it("the note is absent from the display and member column sets themselves", () => {
    expect(PERSON_COLUMNS).not.toContain("admin_note");
    expect(PERSON_MEMBER_COLUMNS).not.toContain("admin_note");
    // The control: it IS in the admin set, or the two above pass by naming
    // a column that does not exist anywhere.
    expect(PERSON_ADMIN_COLUMNS).toContain("admin_note");
  });
});

describe("a signed-out admin's profile stops widening columns — even on the trusted screen (F64)", () => {
  /** A recall_profile whose iat is an hour old — before the reset below. */
  const staleAdmin = `recall_profile=${jwt.sign(
    {
      personId: ADMIN_A,
      name: "Anne",
      role: "admin",
      archiveId: ARCHIVE_A,
      iat: Math.floor((Date.now() - 60 * 60 * 1000) / 1000),
    },
    SECRET
  )}`;

  it("returns display columns for a profile from before the family cutoff", async () => {
    // The trusted device is exempt at deviceGuard, so this stale admin profile
    // reaches the read seam — where actingProfile must now refuse it.
    world({
      families: [
        {
          id: FAMILY_A,
          archive_id: ARCHIVE_A,
          session_version: 1,
          status: "active",
          password_set_at: new Date().toISOString(),
        },
      ],
    });
    await request(app).get("/api/people").set("Cookie", [deviceCookie, staleAdmin]);
    const cols = routePeopleSelect()?.select;

    expect(cols).toBeDefined();
    expect(cols).not.toContain("email");
    expect(cols).not.toContain("contact_number");
  });

  it("fails closed to display columns when the cutoff read itself errors (F66)", async () => {
    /*
      The fail-closed operand — `cutoff.readFailed ||` — protects a state the
      happy-path fixtures never build, so deleting it stays green and F64
      regresses by way of F57's outage shape. This constructs that state: on
      the trusted screen (device-cutoff-exempt), the families read errors, and
      a fresh admin profile that would otherwise get admin columns must drop
      to display ones instead — the guard cannot confirm the token, so it
      grants nothing. Delete `cutoff.readFailed ||` and this reddens.
    */
    world();
    recorder.failNext = { table: "families", op: "select", error: { message: "connection reset" } };
    await request(app).get("/api/people").set("Cookie", [deviceCookie, adminProfileCookie]);
    const cols = routePeopleSelect()?.select;

    expect(cols).toBeDefined();
    expect(cols).not.toContain("email");
    expect(cols).not.toContain("contact_number");
  });

  it("still gives admin columns to a profile issued after the cutoff", async () => {
    // adminProfileCookie's iat is now; the reset was two hours ago.
    world({
      families: [
        {
          id: FAMILY_A,
          archive_id: ARCHIVE_A,
          session_version: 1,
          status: "active",
          password_set_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    await request(app).get("/api/people").set("Cookie", [deviceCookie, adminProfileCookie]);
    const cols = routePeopleSelect()?.select;

    expect(cols).toBeDefined();
    expect(cols).toContain("email");
  });
});

describe("an identity for another family says nothing about this archive", () => {
  const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
  const FAMILY_B = "bbbbbbbb-0000-0000-0000-0000000000fb";
  const ADMIN_B = "bbbbbbbb-0000-0000-0000-0000000000ad";

  it("a family-session admin of archive B is nobody on archive A's device", async () => {
    /*
      One jar, two archives, legitimately: a device paired to family A, and
      a family session for the visitor's own family B. B's admin role must
      not widen the columns of A's rows — the read-side of requireRole's
      device-versus-archive check. Nobody resolves; the display's anonymous
      view is served.
    */
    world({
      family_sessions: [
        elevatedSession({ family_id: FAMILY_B, archive_id: ARCHIVE_B, person_id: ADMIN_B }),
      ],
      families: [{ id: FAMILY_B, archive_id: ARCHIVE_B, session_version: 1, status: "active" }],
      people: [adminPerson({ id: ADMIN_B, archive_id: ARCHIVE_B })],
    });
    await request(app)
      .get("/api/people")
      .set("Cookie", [deviceCookie, "recall_family=an-opaque-token"]);

    const columns = routePeopleSelect()?.select;
    expect(columns).toBeDefined();
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("contact_number");
  });

  it("a profile cookie for archive B is nobody on archive A's device", async () => {
    // The same gap's older shape: a foreign profile JWT beside A's device.
    const foreignProfile = `recall_profile=${jwt.sign(
      { personId: ADMIN_B, name: "Bea", role: "admin", archiveId: ARCHIVE_B },
      SECRET,
      { expiresIn: 3600 }
    )}`;
    await request(app).get("/api/people").set("Cookie", [deviceCookie, foreignProfile]);

    const columns = routePeopleSelect()?.select;
    expect(columns).toBeDefined();
    expect(columns).not.toContain("email");
  });
});

describe("her measurement is hers alone", () => {
  it("a family-session admin's browsing is never recorded as display time", async () => {
    /*
      The regression's quiet half: with the member read as nobody, the
      display-only guard waved a remote admin through, and their page-opens
      landed in device_sessions as Margaret's viewing. 204 and no write.
    */
    world({ family_sessions: [elevatedSession()] });
    const res = await request(app)
      .post("/api/sessions")
      .set("Cookie", ["recall_family=an-opaque-token"])
      .send({});

    expect(res.status).toBe(204);
    expect(recorder.forTable("device_sessions").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("the display's own sessions still record", async () => {
    const res = await request(app).post("/api/sessions").set("Cookie", [deviceCookie]).send({});

    expect(res.status).toBe(201);
    expect(recorder.forTable("device_sessions").filter((q) => q.op === "insert")).toHaveLength(1);
  });
});

describe("/auth/session names the person requireRole would obey", () => {
  it("answers the family-session admin as that person", async () => {
    world({ family_sessions: [elevatedSession()] });
    const res = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["recall_family=an-opaque-token"]);

    expect(res.body.family).toBe(true);
    expect(res.body.profile).toMatchObject({ id: ADMIN_A, name: "Anne", role: "admin" });
  });
});
