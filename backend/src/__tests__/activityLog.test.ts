import { beforeEach, describe, expect, it, vi } from "vitest";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { logActivity } = await import("../services/activityLog.js");

/**
 * M62 — the same fact is not written twice.
 *
 * Saving one form three times is one event. The sidebar was spending all
 * three of its visible slots on "Anne updated Anne Fournier's profile",
 * which made the least-changing screen in the app also the least
 * informative one.
 */

const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const OTHER = "bbbbbbbb-0000-0000-0000-00000000000b";
const profile = { personId: "p1", name: "Anne", role: "admin" as const, archiveId: ARCHIVE };

/** The write is fire-and-forget; let its promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => recorder.reset({}));

describe("the activity log does not repeat itself", () => {
  it("skips a second identical entry inside the window", async () => {
    recorder.reset({
      activity_log: [
        {
          id: "a1",
          description: "Anne updated Anne Fournier's profile",
          created_at: new Date().toISOString(),
        },
      ],
    });

    logActivity(profile, "profile_edited", "Anne updated Anne Fournier's profile");
    await settle();

    expect(recorder.forTable("activity_log").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("still writes when the last entry said something else", async () => {
    recorder.reset({
      activity_log: [
        { id: "a1", description: "Anne added Channel 03", created_at: new Date().toISOString() },
      ],
    });

    logActivity(profile, "profile_edited", "Anne updated Anne Fournier's profile");
    await settle();

    expect(recorder.forTable("activity_log").filter((q) => q.op === "insert")).toHaveLength(1);
  });

  it("looks only at this family's history", async () => {
    recorder.reset({ activity_log: [] });

    logActivity(profile, "profile_edited", "Anne updated Anne Fournier's profile");
    await settle();

    /*
     * The read has to name the archive. A global "most recent identical row"
     * would let one family's edit suppress another's — two admins named Anne
     * a minute apart, and the second family loses its line.
     */
    const [read] = recorder.forTable("activity_log").filter((q) => q.op === "select");
    expect(read.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE)).toBe(true);
    expect(read.filters.some((f) => f.column === "archive_id" && f.value === OTHER)).toBe(false);
  });

  it("writes anyway when the dedup read fails", async () => {
    // A logging hiccup must never cost the family the line itself.
    recorder.reset({});
    recorder.failure = { message: "connection refused" };

    logActivity(profile, "profile_edited", "Anne updated Anne Fournier's profile");
    await settle();

    expect(recorder.forTable("activity_log").filter((q) => q.op === "insert")).toHaveLength(1);
  });
});
