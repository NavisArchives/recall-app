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
 * 041 — the installation reports which build it is running.
 *
 * "Online · software 2.1" was typed into the markup; `deviceStream` returned
 * null and called it a declared gap. The display now says so on its own
 * check-in, and these tests pin the two things that matter about that: the
 * report reaches only the reporting machine's own row, and a machine that has
 * never reported stays honestly unknown.
 *
 * The tenancy case is the important one. A device cookie is a signed claim
 * about which installation is calling; the write must be scoped by that id
 * AND by the archive, so no display can version another household's screen.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

const device = `recall_device=${jwt.sign(
  { installationId: INSTALL_A, archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

/* The stream is read by a signed-in person, not by the screen: the display
   writes its version, the family reads it. */
const asAdmin = [
  device,
  `recall_profile=${jwt.sign(
    { personId: ADMIN_A, name: "Claire", role: "admin", archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  )}`,
];

function world(installation: Record<string, unknown>) {
  recorder.reset({
    installations: [
      {
        id: INSTALL_A,
        archive_id: ARCHIVE_A,
        name: "Living-room display",
        is_trusted: true,
        revoked_at: null,
        last_used_at: new Date().toISOString(),
        ...installation,
      },
    ],
    settings: [
      {
        archive_id: ARCHIVE_A,
        current_channel_number: 6,
        screen_synced_at: new Date().toISOString(),
      },
    ],
    channel_visits: [],
    // requireRole reloads the caller's row; the recorder answers with the
    // first row whatever the filters said.
    people: [{ id: ADMIN_A, name: "Claire", role: "admin", status: "active", archive_id: ARCHIVE_A }],
  });
}

beforeEach(() => world({ software_version: null }));

describe("the display reports its build", () => {
  it("writes the version to its own installation row, scoped by archive", async () => {
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, software_version: "1.4.2" });
    expect(res.status).toBe(204);

    const write = recorder.forTable("installations").find((q) => q.op === "update");
    expect(write?.payload).toMatchObject({ software_version: "1.4.2" });

    // Tenancy: the write names this installation AND this archive. Without
    // both, a device could version a row belonging to another family.
    const columns = (write?.filters ?? []).map((f) => f.column);
    expect(columns).toContain("id");
    expect(columns).toContain("archive_id");
    expect(write?.filters.find((f) => f.column === "id")?.value).toBe(INSTALL_A);
    expect(write?.filters.find((f) => f.column === "archive_id")?.value).toBe(ARCHIVE_A);
  });

  it("a report without a version leaves the row alone", async () => {
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6 });
    expect(res.status).toBe(204);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("refuses to record a blank version, and caps a long one", async () => {
    await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, software_version: "   " });
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);

    await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, software_version: "x".repeat(200) });
    const write = recorder.forTable("installations").find((q) => q.op === "update");
    expect((write?.payload as { software_version: string }).software_version).toHaveLength(40);
  });
});

describe("the workspace reads the build", () => {
  it("serves the trusted screen's reported version", async () => {
    world({ software_version: "1.4.2" });
    const res = await request(app).get("/api/streams/device").set("Cookie", asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.software_version).toBe("1.4.2");
  });

  it("stays null when the machine has never reported — never a placeholder", async () => {
    world({ software_version: null });
    const res = await request(app).get("/api/streams/device").set("Cookie", asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.software_version).toBeNull();
    // The gaps that are still gaps stay declared.
    expect(res.body.storage).toBeNull();
    expect(res.body.backup).toBeNull();
  });
});
