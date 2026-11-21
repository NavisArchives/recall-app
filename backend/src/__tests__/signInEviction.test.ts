import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M116 — family sign-in evicts the previous family's keys (F33).
 *
 * The leak this closes was pinned with one cookie jar at one instant:
 * `/api/family/profiles` answered family B while `/api/channels` answered
 * family A, because signing into B never evicted A's `recall_profile` and
 * `recall_device`, and `requireRole`'s fallback kept serving them.
 *
 * The rule: at family sign-in the profile claim is evicted always — the
 * person at the keyboard is being re-decided — and the device credential is
 * evicted exactly when its archive is not the signing-in family's. The
 * same-family case is the display in the living room, and signing the
 * family in must never unpair her screen.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const FAMILY_B = "bbbbbbbb-0000-0000-0000-0000000000fb";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const PERSON_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

const PASSWORD = "a-long-family-passphrase";
const PASSWORD_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });

/** Family A's keys, exactly as its browser would still be holding them. */
const DEVICE_A = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
const PROFILE_A = `recall_profile=${jwt.sign(
  { personId: PERSON_A, name: "Anne", role: "admin", archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

function familyB(over: Record<string, unknown> = {}) {
  return {
    id: FAMILY_B,
    archive_id: ARCHIVE_B,
    password_hash: PASSWORD_HASH,
    session_version: 1,
    status: "active",
    platform_owner: false,
    ...over,
  };
}

const CREDENTIAL = { email: "family-b@example.invalid", password: PASSWORD };

const ADMIN_SELECT = "id, name, role, status, archived_at, pin_hash, locked_until";
const ADMIN_B_PIN = "271828";
const ADMIN_B = {
  id: "bbbbbbbb-0000-0000-0000-0000000000bd",
  name: "Bea",
  role: "admin",
  status: "active",
  archived_at: null,
  archive_id: ARCHIVE_B,
  pin_hash: await argon2.hash(ADMIN_B_PIN, { type: argon2.argon2id }),
  locked_until: null,
};

/** The set-cookie header, as the cookie strings a browser would apply. */
function cookiesOf(res: request.Response): string[] {
  const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
  return raw.map((line) => line.split(";")[0]);
}

/**
 * What the jar holds after the browser applies a response: cleared cookies
 * (empty value) leave, set cookies replace, untouched cookies stay.
 */
function jarAfter(before: string[], res: request.Response): string[] {
  const jar = new Map(before.map((c) => c.split("=") as [string, string]));
  for (const line of cookiesOf(res)) {
    const [name, value] = line.split("=");
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`);
}

beforeEach(() => {
  recorder.reset({
    families: [familyB()],
    family_sessions: [],
    installations: [],
    people: [],
    channels: [],
  });
});

describe("signing into another family evicts the old family's keys", () => {
  it("clears the profile claim and the foreign device credential", async () => {
    const res = await request(app)
      .post("/api/family/login")
      .set("Cookie", [DEVICE_A, PROFILE_A])
      .send(CREDENTIAL);

    expect(res.status).toBe(200);
    const cookies = cookiesOf(res);
    // Evicted by mechanism: the response clears both of A's keys.
    expect(cookies).toContain("recall_profile=");
    expect(cookies).toContain("recall_device=");

    /*
      And B's fresh session survives the eviction. The first shape of this
      fix cleared cookies through a helper that also clears `recall_family`
      — after the fresh one was set, in the same response. Browsers apply
      Set-Cookie lines in order, so the sign-in signed itself out. The jar's
      final state is the assertion that matters.
    */
    const jar = jarAfter([DEVICE_A, PROFILE_A], res);
    const familyCookie = jar.find((c) => c.startsWith("recall_family="));
    expect(familyCookie).toBeDefined();
    expect(familyCookie).not.toBe("recall_family=");
  });

  it("the one-jar probe answers one family, never two (F33 closed)", async () => {
    const signIn = await request(app)
      .post("/api/family/login")
      .set("Cookie", [DEVICE_A, PROFILE_A])
      .send(CREDENTIAL);
    expect(signIn.status).toBe(200);

    // The jar a browser holds after B's sign-in: none of A's keys survive,
    // and B's own session does.
    const jar = jarAfter([DEVICE_A, PROFILE_A], signIn);
    expect(jar.some((c) => c.startsWith("recall_profile="))).toBe(false);
    expect(jar.some((c) => c.startsWith("recall_device="))).toBe(false);
    expect(jar.some((c) => c.startsWith("recall_family=") && c !== "recall_family=")).toBe(true);

    // The next requests carry only B's session; the fallback has nothing of
    // A's left to serve. Every archive-scoped question must now name B.
    recorder.reset({
      family_sessions: [
        {
          id: "sess-b",
          family_id: FAMILY_B,
          archive_id: ARCHIVE_B,
          person_id: null,
          role: "admin",
          session_version: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked_at: null,
        },
      ],
      families: [familyB()],
      people: [],
      channels: [],
    });

    await request(app).get("/api/channels").set("Cookie", jar);

    const archiveFilters = recorder
      .forTable("channels")
      .flatMap((q) => q.filters)
      .filter((f) => f.column === "archive_id");
    for (const filter of archiveFilters) {
      expect(filter.value).toBe(ARCHIVE_B);
    }
    expect(archiveFilters.every((f) => f.value !== ARCHIVE_A)).toBe(true);
  });
});

describe("pairing a screen ends whatever remote session the browser held", () => {
  it("revokes and clears a lingering family session at the pairing door", async () => {
    /*
      The recorder holds one `families` row at a time, so the lingering
      session is modelled as this same family's own remote session — the
      route's rule is broader (it ends *whoever's* session, because the
      family screen runs on device + subject and nothing else), but the
      mechanism under test is identical: resolve, revoke server-side, clear.
    */
    recorder.reset(
      {
        families: [familyB()],
        family_sessions: [
          {
            id: "sess-b-old",
            family_id: FAMILY_B,
            archive_id: ARCHIVE_B,
            person_id: null,
            role: "admin",
            session_version: 1,
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            revoked_at: null,
          },
        ],
        installations: [],
        people: [],
        channels: [],
      },
      // access-2: an admin of family B confirms the pairing with their PIN.
      { [`people:select:${ADMIN_SELECT}`]: [ADMIN_B] }
    );

    const res = await request(app)
      .post("/api/family/pair-screen")
      .set("Cookie", ["recall_family=a-stale-opaque-token", PROFILE_A])
      .send({ ...CREDENTIAL, admin_person_id: ADMIN_B.id, pin: ADMIN_B_PIN });

    expect(res.status).toBe(200);
    const cookies = cookiesOf(res);
    // The stale remote session is revoked server-side, not merely forgotten…
    const updates = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update")
      .map((q) => q.payload as Record<string, unknown>);
    expect(updates.some((p) => p && "revoked_at" in p && p.revoked_at !== null)).toBe(true);

    /*
      …and it revokes exactly the one session named by its token hash (F68 #11b).
      Deleting `.eq("token_hash", hashToken(token))` from revokeSessionByToken
      leaves `UPDATE family_sessions SET revoked_at = now() WHERE revoked_at IS
      NULL` — every live session on the platform, signed out by one ordinary
      pair-a-screen. token_hash is a session identity, not a tenancy column, so
      the write-scoping backstop is the wrong guard for it; it gets its own
      assertion here. The recorder ignores filters, so this is a shape check.
    */
    const revoke = recorder
      .forTable("family_sessions")
      .find((q) => q.op === "update" && !!(q.payload as Record<string, unknown> | undefined)?.revoked_at);
    expect(revoke).toBeDefined();
    expect(revoke!.filters.some((f) => f.method === "eq" && f.column === "token_hash")).toBe(true);
    // …its cookie is cleared, the stale person goes with it, and the only
    // valued cookie left standing is the machine's own.
    expect(cookies).toContain("recall_family=");
    expect(cookies).toContain("recall_profile=");
    expect(cookies.some((c) => c.startsWith("recall_device=") && c !== "recall_device=")).toBe(
      true
    );
  });
});

describe("a same-family sign-in keeps the household screen paired", () => {
  it("clears the profile claim but leaves the family's own device credential", async () => {
    // The family screen's own jar: its device key names this same archive.
    recorder.reset({
      families: [familyB({ archive_id: ARCHIVE_A })],
      family_sessions: [],
      installations: [],
      people: [],
      channels: [],
    });

    const res = await request(app)
      .post("/api/family/login")
      .set("Cookie", [DEVICE_A, PROFILE_A])
      .send(CREDENTIAL);

    expect(res.status).toBe(200);
    const cookies = cookiesOf(res);
    expect(cookies).toContain("recall_profile=");
    // Not cleared, not re-minted: the pairing simply survives.
    expect(cookies.some((c) => c.startsWith("recall_device="))).toBe(false);
    // And nothing untrusts the installation row.
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });
});
