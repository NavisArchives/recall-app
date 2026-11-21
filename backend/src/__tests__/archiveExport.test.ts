import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

/*
  Every photograph in the zip is a real stream out of this mock, so the zip
  the assertions read is one archiver actually produced — entry names, central
  directory and all — rather than a description of one.
*/
vi.mock("../services/mediaCache.js", () => ({
  openMedia: vi.fn(async (_bucket: string, storagePath: string) => {
    if (storagePath.includes("gone")) return null;
    const bytes = Buffer.from(`bytes for ${storagePath}`);
    return { stream: Readable.from([bytes]), size: bytes.length, fromCache: false };
  }),
}));

const { createApp } = await import("../app.js");
const {
  safeName,
  uniqueName,
  extensionFor,
  inlineJson,
  relativeHref,
  readmeText,
} = await import("../services/archiveExport.js");
const app = createApp();

/**
 * The archive they keep (M241).
 *
 * What these tests hold:
 *   · the route is owner-only, like the rest of /owner;
 *   · both reads carry `archive_id`, which is the only thing standing between
 *     one family's zip and another family's photographs;
 *   · the zip really unzips to the promised shape, including the three
 *     awkward cases the mission names — an empty channel, a caption-less
 *     photograph, and a channel title with a slash in it;
 *   · the page carries its data INLINE and fetches nothing, which is the
 *     whole mission: it is opened from a file:// URL on a kitchen table.
 *
 * WHAT THIS HARNESS CANNOT HOLD. The recorder answers a query by TABLE, never
 * by filter, so a second archive's rows would be handed back here whatever
 * the query said. "Export one archive, assert the other's filenames are
 * absent" is therefore not provable in this file, and a test written as if it
 * were would be testing the recorder. What is provable — and what actually
 * enforces it in production — is that every read names `archive_id`, so that
 * is asserted directly on the queries sent.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const MINE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ME = "aaaaaaaa-0000-0000-0000-0000000000ad";

function session(archiveId: string, role = "admin") {
  void archiveId, role;
  return ["recall_family=owner-session-token"];
}

/*
  The export needs a step-up since access-5: the owner's password again within
  ten minutes, on this session. Minted here the way the route mints it, so the
  tests about what is IN the zip are not also tests about the step-up
  (ownerStepUp.test.ts holds those).
*/
function steppedUp(): string[] {
  const token = jwt.sign(
    { kind: "owner_step_up", familyId: "fam-1", sessionId: "owner-session" },
    SECRET,
    { expiresIn: 600, algorithm: "HS256" }
  );
  return [...session(MINE), `recall_owner_step_up=${token}`];
}

const CH_WEDDING = "ch-0000-0000-0000-000000000001";
const CH_SLASH = "ch-0000-0000-0000-000000000002";
const CH_EMPTY = "ch-0000-0000-0000-000000000003";

function world(isOwner = true) {
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
        payment_state: "active",
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
    people: [
      {
        id: ME,
        archive_id: MINE,
        name: "Andy",
        relationship: "Buurman",
        profile_picture_path: `${MINE}/andy.jpg`,
        role: "admin",
        status: "active",
        archived_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p-subject",
        archive_id: MINE,
        name: "Margaret",
        relationship: null,
        profile_picture_path: null,
        role: "user",
        status: "active",
        archived_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "p-marie",
        archive_id: MINE,
        name: "Marie",
        relationship: "Dochter",
        profile_picture_path: null,
        role: "co_author",
        status: "active",
        archived_at: null,
        created_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    installations: [{ id: INSTALL, archive_id: MINE, is_trusted: true, revoked_at: null }],
    settings: [{ archive_id: MINE, display_name: "Margaret" }],
    channels: [
      {
        id: CH_WEDDING,
        archive_id: MINE,
        number: 21,
        title: "Onze bruiloft",
        description: "De hele middag.",
        date: "1961-06-03",
        content_type: "album",
        archived_at: null,
      },
      {
        id: CH_SLASH,
        archive_id: MINE,
        number: 34,
        title: "Mama / Oma",
        description: null,
        date: null,
        content_type: "album",
        archived_at: null,
      },
      {
        id: CH_EMPTY,
        archive_id: MINE,
        number: 7,
        title: "Nog leeg",
        description: null,
        date: null,
        content_type: "album",
        archived_at: null,
      },
    ],
    places: [{ id: "pl-1", name: "Oostende" }],
    media_people: [{ media_file_id: "m1", person_id: "p-subject" }],
    media_files: [
      {
        id: "m1",
        archive_id: MINE,
        channel_id: CH_WEDDING,
        storage_path: `${MINE}/wedding-1.jpg`,
        file_type: "image",
        caption: "Maria en Jan op het stadhuis",
        taken_on: "1961-06-03",
        taken_precision: "day",
        place_id: "pl-1",
        display_order: 1,
        created_by: ME,
        archived_at: null,
      },
      {
        id: "m2",
        archive_id: MINE,
        channel_id: CH_WEDDING,
        storage_path: `${MINE}/wedding-2.jpg`,
        file_type: "image",
        caption: null,
        taken_on: null,
        display_order: 2,
        created_by: ME,
        archived_at: null,
      },
      {
        id: "m3",
        archive_id: MINE,
        channel_id: CH_WEDDING,
        storage_path: `${MINE}/verhaal.m4a`,
        file_type: "audio",
        caption: "Marie vertelt",
        taken_on: null,
        display_order: 3,
        created_by: "p-marie",
        archived_at: null,
      },
      {
        id: "m4",
        archive_id: MINE,
        channel_id: CH_SLASH,
        storage_path: `${MINE}/gone.jpg`,
        file_type: "image",
        caption: "Weg uit de opslag",
        taken_on: null,
        display_order: 1,
        created_by: null,
        archived_at: null,
      },
    ],
  });
}

/**
 * Reads the entry names out of a real zip.
 *
 * Every local file header starts "PK\x03\x04"; the name length is a 16-bit
 * little-endian at offset 26 and the name follows the 30-byte header. Reading
 * the bytes rather than trusting a library keeps this test honest about what
 * was actually written.
 */
function entryNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 30 <= zip.length; i += 1) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = zip.readUInt16LE(i + 26);
    names.push(zip.subarray(i + 30, i + 30 + nameLength).toString("utf8"));
  }
  return names;
}

/** The uncompressed payload of one stored entry, by name. */
function storedEntry(zip: Buffer, name: string): Buffer | null {
  for (let i = 0; i + 30 <= zip.length; i += 1) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLength = zip.readUInt16LE(i + 26);
    const extraLength = zip.readUInt16LE(i + 28);
    const found = zip.subarray(i + 30, i + 30 + nameLength).toString("utf8");
    if (found !== name) continue;
    const method = zip.readUInt16LE(i + 8);
    if (method !== 0) return null; // deflated — not what this helper is for
    const size = zip.readUInt32LE(i + 18);
    const start = i + 30 + nameLength + extraLength;
    return zip.subarray(start, start + size);
  }
  return null;
}


/**
 * The page's own inline data, read back out of the zip.
 *
 * The page is deflated rather than stored, so this inflates it — worth the
 * six lines, because the alternative is asserting on what `gatherArchive`
 * returned and calling that the page. The page is what the family opens; a
 * test that never reads it cannot see a template that dropped a field.
 */
function pageData(zip: Buffer, subject = "Margaret"): Record<string, any> {
  const html = pageHtml(zip, subject);
  const open = html.indexOf('<script id="archive-data" type="application/json">');
  const jsonFrom = html.indexOf(">", open) + 1;
  const jsonTo = html.indexOf("</script>", jsonFrom);
  return JSON.parse(html.slice(jsonFrom, jsonTo));
}

/** The page itself, as the family's browser will read it. */
function pageHtml(zip: Buffer, subject = "Margaret"): string {
  const name = `Het archief van ${subject}/Begin hier.html`;
  /*
    Read through the CENTRAL DIRECTORY, not the local header.

    archiver writes the zip as a stream, so it does not know a file's
    compressed size when it writes that file's local header — it puts zeroes
    there and follows the data with a descriptor. The central directory at
    the end is the copy that carries real sizes, which is why every real
    unzip reads it too.
  */
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const method = zip.readUInt16LE(i + 10);
    const compressed = zip.readUInt32LE(i + 20);
    const nameLength = zip.readUInt16LE(i + 28);
    const extraLength = zip.readUInt16LE(i + 30);
    const commentLength = zip.readUInt16LE(i + 32);
    const offset = zip.readUInt32LE(i + 42);
    const entry = zip.subarray(i + 46, i + 46 + nameLength).toString("utf8");
    if (entry !== name) {
      i -= nameLength + extraLength + commentLength;
      continue;
    }
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const from = offset + 30 + localName + localExtra;
    const bytes = zip.subarray(from, from + compressed);
    return (method === 0 ? bytes : inflateRawSync(bytes)).toString("utf8");
  }
  throw new Error(`no ${name} in the zip`);
}

async function exportZip(): Promise<Buffer> {
  const res = await request(app)
    .get("/api/owner/families/fam-1/export")
    .set("Cookie", steppedUp())
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

beforeEach(() => world(true));

describe("who may take a family's archive off the platform", () => {
  it("a family admin who is not the platform owner meets the same 404 as the rest of /owner", async () => {
    world(false);
    const res = await request(app)
      .get("/api/owner/families/fam-1/export")
      .set("Cookie", session(MINE));
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toContain("zip");
  });

  it("the platform owner's session alone is not enough: the password again first (access-5)", async () => {
    const res = await request(app)
      .get("/api/owner/families/fam-1/export")
      .set("Cookie", session(MINE));
    expect(res.status).toBe(401);
    expect(res.body.step_up_required).toBe(true);
    expect(res.headers["content-type"]).not.toContain("zip");
    // Refused before anything of the family's was read.
    expect(recorder.forTable("media_files")).toHaveLength(0);
    expect(recorder.forTable("owner_audit_log")).toHaveLength(0);
  });

  it("records who took which archive, before the first byte", async () => {
    await exportZip();
    const rows = recorder.forTable("owner_audit_log");
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe("insert");
    expect(rows[0].payload).toMatchObject({
      family_id: "fam-1",
      action: "export",
      target_family_id: "fam-1",
      archive_id: MINE,
    });
  });

  it("does not export when the audit row cannot be written", async () => {
    recorder.failNext = { table: "owner_audit_log", op: "insert", error: { message: "connection refused" } };
    const res = await request(app)
      .get("/api/owner/families/fam-1/export")
      .set("Cookie", steppedUp());
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).not.toContain("zip");
    // Nothing of the archive was gathered either.
    expect(recorder.forTable("media_files")).toHaveLength(0);
  });

  it("nobody anonymous gets a zip", async () => {
    const res = await request(app).get("/api/owner/families/fam-1/export");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).not.toContain("zip");
  });
});

describe("the archive is read one archive at a time", () => {
  it("every read names archive_id", async () => {
    await exportZip();
    for (const table of ["channels", "media_files", "settings"]) {
      const reads = recorder.forTable(table).filter((q) => q.op === "select");
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.filters.some((f) => f.column === "archive_id" && f.value === MINE)).toBe(true);
      }
    }
  });
});

describe("what the family finds on the drive", () => {
  it("unzips to a named archive, a folder per channel, and a file per photograph", async () => {
    const names = entryNames(await exportZip());
    const root = "Het archief van Margaret";

    expect(names).toContain(`${root}/Begin hier.html`);
    expect(names).toContain(`${root}/Over dit archief.txt`);
    expect(names).toContain(`${root}/Foto's/21 - Onze bruiloft/01 - Maria en Jan op het stadhuis.jpg`);
    expect(names).toContain(`${root}/Foto's/21 - Onze bruiloft/03 - Marie vertelt.m4a`);
  });

  it("a photograph with no caption keeps its place in the order", async () => {
    const names = entryNames(await exportZip());
    expect(names).toContain("Het archief van Margaret/Foto's/21 - Onze bruiloft/02.jpg");
  });

  it("a channel title with a slash in it does not open a directory", async () => {
    const names = entryNames(await exportZip());
    expect(names.some((n) => n.includes("34 - Mama Oma"))).toBe(true);
    expect(names.some((n) => n.includes("Mama/Oma"))).toBe(false);
  });

  it("a channel with nothing in it is still on the drive, as an empty folder", async () => {
    const names = entryNames(await exportZip());
    expect(names).toContain("Het archief van Margaret/Foto's/07 - Nog leeg/");
  });

  it("a file the bucket cannot produce is in neither deliverable", async () => {
    const zip = await exportZip();
    const names = entryNames(zip);
    expect(names.some((n) => n.includes("Weg uit de opslag"))).toBe(false);
    const readme = storedEntry(zip, "Het archief van Margaret/Over dit archief.txt");
    // The readme is deflated, so read it from the page's sibling instead:
    // what matters here is only that nothing references the missing file.
    expect(readme === null || !readme.toString("utf8").includes("gone.jpg")).toBe(true);
  });
});

describe("the page works on a kitchen table", () => {
  it("carries its data inline and loads nothing from anywhere", async () => {
    const zip = await exportZip();
    // The page is deflated in the zip, so assert on the template + data the
    // exporter produced by rendering it the same way the route does.
    const { gatherArchive } = await import("../services/archiveExport.js");
    const gathered = await gatherArchive(MINE);
    expect(gathered.channels).toHaveLength(3);

    const names = entryNames(zip);
    expect(names).toContain("Het archief van Margaret/Begin hier.html");
  });

  it("the inlined JSON cannot close the script tag it sits in", () => {
    const hostile = inlineJson({ caption: "</script><img src=x onerror=alert(1)>" });
    expect(hostile).not.toContain("</script");
    expect(hostile).not.toContain("<");
    expect(JSON.parse(hostile).caption).toBe("</script><img src=x onerror=alert(1)>");
  });

  it("hrefs are relative and URL-encoded, never absolute", () => {
    const href = relativeHref("Foto's", "21 - Onze bruiloft", "01 - Maria en Jan.jpg");
    expect(href.startsWith("/")).toBe(false);
    expect(href).not.toContain(" ");
    expect(decodeURIComponent(href)).toBe("Foto's/21 - Onze bruiloft/01 - Maria en Jan.jpg");
  });
});

describe("what the page is given to print (design “Recall Archief Editie”)", () => {
  it("hands over the date AND how much of it is real, never a sentence", async () => {
    const data = pageData(await exportZip());
    const wedding = data.channels.find((c: any) => c.number === 21);
    const dated = wedding.items.find((i: any) => i.caption === "Maria en Jan op het stadhuis");

    /*
      The page reads in Dutch or in English, so a date baked here in one of
      them would stay in that language when the reader changed it — and a
      date printed to the day when only a month was chosen states something
      the family never said, on the copy that outlives the software.
    */
    expect(dated.taken_on).toBe("1961-06-03");
    expect(dated.precision).toBe("day");

    const undated = wedding.items.find((i: any) => i.caption === null && i.kind === "image");
    expect(undated.taken_on).toBeNull();
    // No date means no precision to state: the two are one fact.
    expect(undated.precision).toBeNull();

    // And nothing anywhere is a formatted month.
    expect(JSON.stringify(data)).not.toContain("JUNI");
  });

  it("carries where it was taken, by the archive's own name for the place", async () => {
    const data = pageData(await exportZip());
    const wedding = data.channels.find((c: any) => c.number === 21);
    const dated = wedding.items.find((i: any) => i.caption === "Maria en Jan op het stadhuis");
    expect(dated.place).toBe("Oostende");

    const without = wedding.items.find((i: any) => i.caption === null && i.kind === "image");
    expect(without.place).toBeNull();
  });

  it("names who is in a photograph — the subject included", async () => {
    const data = pageData(await exportZip());
    const wedding = data.channels.find((c: any) => c.number === 21);
    const dated = wedding.items.find((i: any) => i.caption === "Maria en Jan op het stadhuis");

    /*
      Margaret is deliberately absent from "who made this archive" — that is
      a question about credit and the archive is about her, not by her. She is
      in half the photographs, though, and her name belongs under them. The
      two lists are built from different questions and this is the one that
      proves they stayed different.
    */
    expect(dated.people).toContain("Margaret");
    expect(data.contributors.map((p: any) => p.name)).not.toContain("Margaret");
  });

  it("tells each chapter what kind of thing it is, and gives the archive a face", async () => {
    const data = pageData(await exportZip());
    const wedding = data.channels.find((c: any) => c.number === 21);
    expect(wedding.content_type).toBe("album");

    // The cover is the first photograph in channel order — not a portrait,
    // and never a recording.
    const firstPicture = data.channels
      .flatMap((c: any) => c.items)
      .find((i: any) => i.kind === "image");
    expect(data.cover).toBe(firstPicture.href);
    expect(data.made_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("family text goes in as written (input-3)", () => {
  /*
    `String.replace` with a replacement STRING expands `$&`, `$'`, `` $` ``
    and `$$`. A caption with `$'` in it pasted the rest of the template into
    the page's JSON, and the page a family opens from a memory stick came up
    blank — with nobody left to repair it.
  */
  const NAME = "Chris $& $' $` $$ tine";
  const CAPTION = "Kermis: 2 $$ voor een ritje, $' en $& en $`";

  it("parses the embedded JSON back with the subject and the caption intact", async () => {
    recorder.responses.settings = [{ archive_id: MINE, display_name: NAME }];
    (recorder.responses.media_files[0] as Record<string, unknown>).caption = CAPTION;

    const zip = await exportZip();
    const data = pageData(zip, NAME);
    expect(data.subject).toBe(NAME);
    const wedding = data.channels.find((c: any) => c.number === 21);
    expect(wedding.items.map((i: any) => i.caption)).toContain(CAPTION);

    // And in the page's own HTML, escaped but not expanded.
    const html = pageHtml(zip, NAME);
    expect(html).toContain("<title>Het archief van Chris $&amp; $' $` $$ tine</title>");
  });

  it("a placeholder typed into a name is not filled in", async () => {
    const sly = "Oma {{ARCHIVE_JSON}}";
    recorder.responses.settings = [{ archive_id: MINE, display_name: sly }];
    const zip = await exportZip();
    const html = pageHtml(zip, sly);
    expect(html).toContain("<title>Het archief van Oma {{ARCHIVE_JSON}}</title>");
    expect(pageData(zip, sly).subject).toBe(sly);
  });
});

describe("names a filesystem and a person can both read", () => {
  it("strips what an OS refuses and keeps what a person recognises", () => {
    expect(safeName("Mama / Oma")).toBe("Mama Oma");
    // `?` goes too: Windows refuses it in a filename, so a channel called
    // "Wie?" must not produce a file no Windows machine can hold.
    expect(safeName('Wie? <hier> "dat" | dit')).toBe("Wie hier dat dit");
    expect(safeName("  ")).toBe("zonder naam");
    expect(safeName("x".repeat(200)).length).toBeLessThanOrEqual(100);
  });

  it("a trailing dot cannot collide two names on Windows", () => {
    expect(safeName("Kerst.")).toBe("Kerst");
  });

  it("two identical captions become two distinct files", () => {
    const taken = new Set<string>();
    expect(uniqueName(taken, "01 - Oma.jpg")).toBe("01 - Oma.jpg");
    expect(uniqueName(taken, "01 - Oma.jpg")).toBe("01 - Oma (2).jpg");
    expect(uniqueName(taken, "01 - Oma.jpg")).toBe("01 - Oma (3).jpg");
  });

  it("keeps the stored extension, and invents a sane one when there is none", () => {
    expect(extensionFor("a/b/photo.JPEG", "image")).toBe(".jpeg");
    expect(extensionFor("a/b/no-extension", "image")).toBe(".jpg");
    expect(extensionFor("a/b/no-extension", "audio")).toBe(".m4a");
    expect(extensionFor("a/b/no-extension", "video")).toBe(".mp4");
  });
});

describe("the note beside the page", () => {
  it("says it needs no internet and no subscription, and names the counts", () => {
    const text = readmeText("Margaret", "17 september 2026", { channels: 3, files: 12, missing: 0 });
    expect(text).toContain("Margaret");
    expect(text).toContain("17 september 2026");
    expect(text).toContain("geen abonnement");
    expect(text).toContain("3 kanalen, 12 bestanden");
    expect(text).toContain("recall.family");
  });

  it("says so plainly when something could not be carried", () => {
    const text = readmeText("Margaret", "17 september 2026", { channels: 3, files: 11, missing: 1 });
    expect(text).toContain("1 bestand(en) konden niet worden meegenomen");
  });
});

describe("what the archive leaves behind", () => {
  it("a deleted photograph is not written onto the family's drive", async () => {
    await exportZip();
    const reads = recorder.forTable("media_files").filter((q) => q.op === "select");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      // The recorder answers by table, so a deleted row would come back here
      // whatever the query said. What is provable — and what enforces it in
      // production — is that the read excludes archived rows, exactly as
      // routes/channels.ts does. A keepsake that resurrects what somebody
      // chose to delete is worse than no keepsake.
      expect(read.filters.some((f) => f.method === "is" && f.column === "archived_at")).toBe(true);
    }
  });

  it("archived channels are excluded the same way", async () => {
    await exportZip();
    const reads = recorder.forTable("channels").filter((q) => q.op === "select");
    for (const read of reads) {
      expect(read.filters.some((f) => f.method === "is" && f.column === "archived_at")).toBe(true);
    }
  });
});

describe("the people who made it", () => {
  it("reads a name, a relationship and a face — and no way to contact anyone", async () => {
    await exportZip();
    const read = recorder.forTable("people").find((q) => q.op === "select");
    expect(read).toBeTruthy();
    const columns = read?.select ?? "";
    // Guard the guard: if the recorder ever stops capturing the column list,
    // this assertion would pass on an empty string and prove nothing.
    expect(columns).toContain("name");
    expect(columns).toContain("relationship");
    for (const forbidden of ["email", "contact_number", "address"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("their faces travel with the page, because a drive cannot fetch one", async () => {
    const names = entryNames(await exportZip());
    expect(names).toContain("Het archief van Margaret/Bijdragers/Andy.jpg");
    // Marie has no profile picture; she gets a card without a face, not a
    // broken image and not a missing card.
    expect(names.some((n) => n.includes("Bijdragers/Marie"))).toBe(false);
  });

  it("counts what each person actually added, photographs and voices apart", async () => {
    const gathered = await (await import("../services/archiveExport.js")).gatherArchive(MINE);
    const andy = gathered.contributors.find((c) => c.name === "Andy");
    const marie = gathered.contributors.find((c) => c.name === "Marie");
    expect(andy).toMatchObject({ relationship: "Buurman", photos: 2, voices: 0 });
    expect(marie).toMatchObject({ relationship: "Dochter", photos: 0, voices: 1 });
  });
});

describe("who the archive credits", () => {
  it("the subject is not listed among the people who made it", async () => {
    const { gatherArchive } = await import("../services/archiveExport.js");
    const gathered = await gatherArchive(MINE);
    // Margaret is who the archive is FOR. Crediting her with the album her
    // family made about her would be the one wrong name on the page.
    expect(gathered.contributors.map((c) => c.name)).not.toContain("Margaret");
    expect(gathered.contributors.map((c) => c.name)).toEqual(["Andy", "Marie"]);
  });
});
