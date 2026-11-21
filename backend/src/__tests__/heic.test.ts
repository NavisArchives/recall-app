import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({}) }));

const { verifyFile } = await import("../services/media.js");

/**
 * Photographs arrive as HEIC.
 *
 * It is the default on every iPhone and in macOS Photos, so it is not an edge
 * case — it is most of what a family will actually try to add. Refusing it
 * means refusing the camera roll.
 *
 * No browser renders HEIC, so accepting it is only half the job: it has to
 * become something Margaret's screen can show. That conversion belongs here,
 * where every upload path already passes through, rather than in each route.
 */

const fixture = path.join(__dirname, "fixtures", "photo.heic");

describe("HEIC photographs", () => {
  it("is a real HEIC to begin with", async () => {
    const detected = await fileTypeFromBuffer(await readFile(fixture));
    expect(detected?.mime).toBe("image/heic");
  });

  it("is accepted and converted to JPEG", async () => {
    const verified = await verifyFile(await readFile(fixture), "image");

    expect(verified).not.toBeNull();
    expect(verified!.kind).toBe("image");
    expect(verified!.mime).toBe("image/jpeg");
    expect(verified!.extension).toBe("jpg");
  });

  it("returns bytes that really are a JPEG, not a renamed HEIC", async () => {
    const verified = await verifyFile(await readFile(fixture), "image");

    // The stored object is what the browser will be asked to render, so the
    // bytes themselves have to be JPEG — a corrected extension is not enough.
    const detected = await fileTypeFromBuffer(verified!.buffer);
    expect(detected?.mime).toBe("image/jpeg");
  });

  it("still refuses something that is not an image at all", async () => {
    const notAnImage = Buffer.from("#!/bin/sh\nrm -rf /\n");
    expect(await verifyFile(notAnImage, "image")).toBeNull();
  });
});
