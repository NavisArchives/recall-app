import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import archiver from "archiver";
import { supabase } from "../config/supabase.js";
import { openMedia } from "./mediaCache.js";
import { CHANNEL_MEDIA_BUCKET, PROFILE_PICTURES_BUCKET } from "./media.js";
import { PLACE_COLUMNS } from "./dto.js";
import { peopleInMedia } from "./vocabulary.js";

/**
 * The archive they keep (M241).
 *
 * The Recall Archive home service promises the family leaves the day holding
 * everything on a drive, "working without me and without any subscription".
 * This builds that drive: one zip, streamed, containing the family's whole
 * archive as ordinary files plus a page that reads them.
 *
 * TWO DELIVERABLES IN ONE ZIP, and the second is not a fallback nobody
 * thought about:
 *
 *   1. `Begin hier.html` — the experience. One file, everything inline.
 *   2. The folder tree — `Foto's/21 - Onze bruiloft/01 - <caption>.jpg`.
 *      If the page is never opened, or opens on some browser in 2034 that
 *      refuses it, the family still finds a labelled archive in Finder. That
 *      is why the files are not a media/ dump of opaque ids: the filenames
 *      ARE the archive when the software is gone.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING: the page is opened by
 * double-clicking it, so it runs on a `file://` origin, and browsers block
 * `fetch()` there. A separate data.json would render a blank page on the
 * family's kitchen table and pass every test run over http://localhost. So
 * the archive's data is written INTO the HTML in a script tag, and the page
 * loads nothing at all — no CDN, no font host, no remote image.
 *
 * ORDER OF ASSEMBLY. Media is streamed into the zip first and the manifest is
 * built from what actually arrived; the page and the readme are appended
 * afterwards from strings. A photograph the storage bucket cannot produce is
 * then simply absent from both the page and the tree, rather than being a
 * broken image in a family's only copy. Zip readers do not care about order.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Names the family will read in Finder. The service is sold in Dutch. */
export const ROOT_PREFIX = "Het archief van";
export const MEDIA_DIR = "Foto's";
export const PAGE_NAME = "Begin hier.html";
export const README_NAME = "Over dit archief.txt";
export const FACES_DIR = "Bijdragers";

export interface ExportMedia {
  id: string;
  storage_path: string;
  file_type: string;
  caption: string | null;
  taken_on: string | null;
  /*
    How much of `taken_on` the family actually told us (059). The page prints
    the month when that is all it was given, and never invents a day — the
    stick is the copy that outlives the software, so a date it states wrongly
    is wrong for good.
  */
  taken_precision: "year" | "month" | "day" | null;
  /** Where it was taken, as the archive's own name for the place (059). */
  place: string | null;
  /*
    Who is in it, by name (059). Names rather than ids because the stick has
    no database to look them up in — and the subject herself belongs in this
    list. She is left out of "who made this", which is a different question;
    she is very often in the photograph.
  */
  people: string[];
  display_order: number;
  created_by: string | null;
}

export interface ExportChannel {
  id: string;
  number: number;
  title: string;
  description: string | null;
  date: string | null;
  content_type: string;
  media: ExportMedia[];
}

/**
 * Makes one path segment safe for a filesystem while keeping it readable.
 *
 * The characters stripped are the union of what Windows, macOS and Linux
 * refuse; a channel called "Mama / Oma" must not open a directory. Names are
 * capped so a long caption cannot overflow a path limit, and a name that
 * sanitises down to nothing still gets something to be called.
 */
export function safeName(raw: string, fallback = "zonder naam"): string {
  const cleaned = raw
    .replace(/[/\\:*?"<>|]/g, " ")
    // Control characters would be legal in some filesystems and a nightmare
    // in all of them.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot or space is silently dropped by Windows, which turns
    // two distinct names into one collision.
    .replace(/[. ]+$/, "");
  const capped = cleaned.slice(0, 100).trim().replace(/[. ]+$/, "");
  return capped || fallback;
}

/** Keeps every name in one directory distinct, without hiding what it is. */
export function uniqueName(taken: Set<string>, name: string): string {
  const key = name.toLowerCase();
  if (!taken.has(key)) {
    taken.add(key);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
  taken.add(key);
  return name;
}

const FALLBACK_EXT: Record<string, string> = { image: ".jpg", video: ".mp4", audio: ".m4a" };

/** The stored file's own extension, or one that matches what it is. */
export function extensionFor(storagePath: string, fileType: string): string {
  const base = storagePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext;
  return FALLBACK_EXT[fileType] ?? "";
}

export interface ExportContributor {
  id: string;
  name: string;
  relationship: string | null;
  photoPath: string | null;
  photos: number;
  voices: number;
}

/**
 * Everything in one archive, in the order the family reads it.
 *
 * Every query filters on `archive_id` (CLAUDE.md's invariant): a second
 * family's photographs can never reach this zip, and the media query is
 * scoped by archive as well as by channel so it cannot be widened by a bad
 * channel id.
 *
 * ARCHIVED ROWS ARE NOT IN THE ARCHIVE. Channels and media both carry
 * `archived_at`, and a family's deleted photographs must not be the thing we
 * hand them on a drive — a keepsake that resurrects what somebody chose to
 * remove is worse than no keepsake. Both are filtered, like every read in
 * routes/channels.ts.
 */
export async function gatherArchive(archiveId: string): Promise<{
  subjectName: string;
  contributors: ExportContributor[];
  channels: ExportChannel[];
}> {
  const [{ data: settings }, { data: channelRows, error: channelError }, { data: peopleRows }] =
    await Promise.all([
      supabase.from("settings").select("display_name").eq("archive_id", archiveId).maybeSingle(),
      supabase
        .from("channels")
        .select("id, number, title, description, date, content_type")
        .eq("archive_id", archiveId)
        .is("archived_at", null)
        .order("number", { ascending: true }),
      /*
       * The people who fed the archive. Name, how they are related and their
       * face — the three things the page prints beside a count, and nothing
       * more. No email, no telephone, no address: the contact columns are for
       * an authenticated admin (CLAUDE.md), and this file leaves the platform
       * on a stick that will sit in a drawer.
       */
      supabase
        .from("people")
        .select("id, name, relationship, profile_picture_path, role")
        .eq("archive_id", archiveId)
        .is("archived_at", null)
        .order("created_at", { ascending: true }),
    ]);
  if (channelError) throw channelError;

  const subjectName = (settings as { display_name?: string } | null)?.display_name ?? "de familie";
  /*
   * "Wie heeft dit gemaakt" is the people who BUILT the archive, so the
   * subject is not in it. Margaret is who it is for; listing her among the
   * contributors would credit her with the album her family made about her.
   * Her role is `user` — the same test ProfilesPage uses to find her.
   */
  const people = ((peopleRows ?? []) as {
    id: string;
    name: string;
    relationship: string | null;
    profile_picture_path: string | null;
    role: string | null;
  }[]).filter((person) => person.role !== "user");
  const channels = (channelRows ?? []) as Omit<ExportChannel, "media">[];

  if (channels.length === 0) {
    return { subjectName, contributors: [], channels: [] };
  }

  const channelIds = channels.map((c) => c.id);
  /*
   * No card lookup here, deliberately (owner, 17 Sep 2026). Whether an NFC
   * card in the house opens a channel is a fact about the house, not about
   * the archive on the stick — and the stick outlives the cards.
   */
  const { data: mediaRows, error: mediaError } = await supabase
    .from("media_files")
    .select(
      "id, channel_id, storage_path, file_type, caption, taken_on, taken_precision, place_id, display_order, created_by"
    )
    .eq("archive_id", archiveId)
    .in("channel_id", channelIds)
    .is("archived_at", null)
    .order("display_order", { ascending: true });
  if (mediaError) throw mediaError;

  /*
    The places, by name (059).

    One read for the whole archive rather than one per photograph, and
    archive-scoped like everything else. A photograph whose place row has
    since been deleted simply has no place — the same as one that never had
    one, which is the state most of them are in.
  */
  const placeIds = [
    ...new Set(
      ((mediaRows ?? []) as { place_id: string | null }[])
        .map((row) => row.place_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const places = new Map<string, string>();
  if (placeIds.length) {
    const { data: placeRows, error: placeError } = await supabase
      .from("places")
      .select(PLACE_COLUMNS)
      .eq("archive_id", archiveId)
      .in("id", placeIds);
    if (placeError) throw placeError;
    for (const row of (placeRows ?? []) as unknown as { id: string; name: string }[]) {
      places.set(row.id, row.name);
    }
  }

  /*
    Who is in each photograph (059), resolved to names here.

    The name map is built from the UNFILTERED people rows — the subject is
    excluded from "who made this archive", which is a question about credit,
    but she is in half the photographs and her name belongs under them.
  */
  const nameOf = new Map(
    ((peopleRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  let facesIn = new Map<string, string[]>();
  try {
    facesIn = await peopleInMedia(
      archiveId,
      ((mediaRows ?? []) as { id: string }[]).map((row) => row.id)
    );
  } catch (err) {
    /* A name that cannot be read costs a line under a photograph; the
       photographs themselves are the deliverable and still go out. */
    console.error("[export] the people on the photographs could not be read", err);
  }

  const byChannel = new Map<string, ExportMedia[]>();
  const tally = new Map<string, { photos: number; voices: number }>();
  for (const row of (mediaRows ?? []) as (ExportMedia & { channel_id: string; place_id: string | null })[]) {
    const list = byChannel.get(row.channel_id) ?? [];
    list.push({
      ...row,
      place: row.place_id ? places.get(row.place_id) ?? null : null,
      people: (facesIn.get(row.id) ?? [])
        .map((id) => nameOf.get(id))
        .filter((name): name is string => !!name),
    });
    byChannel.set(row.channel_id, list);
    if (row.created_by) {
      const count = tally.get(row.created_by) ?? { photos: 0, voices: 0 };
      if (row.file_type === "audio") count.voices += 1;
      else count.photos += 1;
      tally.set(row.created_by, count);
    }
  }

  return {
    subjectName,
    contributors: people.map((person) => ({
      id: person.id,
      name: person.name,
      relationship: person.relationship,
      photoPath: person.profile_picture_path,
      photos: tally.get(person.id)?.photos ?? 0,
      voices: tally.get(person.id)?.voices ?? 0,
    })),
    channels: channels.map((c) => ({ ...c, media: byChannel.get(c.id) ?? [] })),
  };
}

/**
 * Embeds JSON in a script tag without letting it end the tag early.
 *
 * `</script>` inside a string literal closes the element no matter where it
 * appears, and `<!--` opens a comment; a caption containing either would
 * otherwise break the page a family cannot repair.
 */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A relative href the page can follow from beside it, on any OS. */
export function relativeHref(...segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

/** "AUGUSTUS 1978" — the archive card beside a plate, in the design's voice. */
export function dutchStamp(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  return at
    .toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

interface PageChannel {
  number: number;
  title: string;
  description: string | null;
  date: string | null;
  /** album / video / instruction / stories — the word the chapter head prints. */
  content_type: string;
  items: {
    kind: string;
    href: string;
    caption: string | null;
    /*
      The raw date and its precision, NOT a formatted string.

      The page can be read in Dutch or in English, and a date baked here in
      one of them would stay in that language when the reader changed it. The
      page formats with Intl, which every browser that can open the file has
      built in, and prints only as much of the date as `precision` says was
      actually chosen.
    */
    taken_on: string | null;
    precision: string | null;
    place: string | null;
    people: string[];
  }[];
}

export function readmeText(subjectName: string, madeOn: string, counts: { channels: number; files: number; missing: number }): string {
  const lines = [
    `Het archief van ${subjectName}`,
    "",
    `Gemaakt op ${madeOn}.`,
    `${counts.channels} kanalen, ${counts.files} bestanden.`,
    "",
    "Wat is dit?",
    "Dit is de volledige inhoud van het Recall-archief: elke foto, elke",
    "opname en elke beschrijving, als gewone bestanden.",
    "",
    "Hoe open ik het?",
    `Dubbelklik op "${PAGE_NAME}". Die opent in elke browser.`,
    "Er is geen internet nodig en geen abonnement. Niets in dit archief",
    "haalt iets op van een website — alles staat op deze schijf.",
    "",
    `U kunt de foto's ook gewoon in de map "${MEDIA_DIR}" bekijken.`,
    "Elke map is een kanaal, met het nummer dat op de kaartjes staat.",
    "De bestandsnamen zijn de onderschriften.",
    "",
    "Maak een kopie.",
    "Een USB-stick is één kopie. Zet deze map ook op een computer of",
    "een tweede schijf, zodat één kapotte stick niet het archief is.",
    "",
    "Recall — recall.family",
  ];
  if (counts.missing > 0) {
    lines.splice(
      5,
      0,
      `Let op: ${counts.missing} bestand(en) konden niet worden meegenomen.`,
      "Neem contact op met Recall als u die mist.",
      ""
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Appends one entry and waits for the archive to finish writing it.
 *
 * Without this the loop opens every photograph's storage response before
 * archiver has drained any of them: `append` queues and returns at once, so
 * three hundred files meant three hundred open HTTP bodies, each holding its
 * own read buffer. Waiting for the entry keeps exactly one file in flight,
 * which is what "stream it, do not build it in memory" actually costs.
 */
function appendAndWait(
  archive: archiver.Archiver,
  source: Parameters<archiver.Archiver["append"]>[0],
  options: archiver.EntryData & { store?: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
      err ? reject(err) : resolve();
    };
    const onEntry = (entry: { name?: string }) => {
      if (entry?.name === options.name) done();
    };
    const onError = (err: Error) => done(err);
    archive.on("entry", onEntry);
    archive.on("error", onError);
    archive.append(source, options);
  });
}

/**
 * Streams the whole archive to `res` as a zip.
 *
 * Streamed rather than assembled: three hundred photographs is 200–400MB, and
 * an owner exporting two families at once must not be two of those in this
 * process's heap. Each media file is piped from storage straight into the
 * archive, one at a time, and `store: true` skips deflate on bytes that are
 * already compressed.
 */
export async function streamArchiveExport(
  res: Response,
  archiveId: string,
  now: Date
): Promise<void> {
  const { subjectName, contributors, channels } = await gatherArchive(archiveId);
  const root = safeName(`${ROOT_PREFIX} ${subjectName}`, ROOT_PREFIX);

  const archive = archiver("zip", { zlib: { level: 6 } });
  let failed = false;
  archive.on("error", (err: Error) => {
    failed = true;
    console.error("[export] archive error", err);
    res.destroy(err);
  });
  archive.on("warning", (err: Error) => console.warn("[export] warning", err));
  archive.pipe(res);

  const pageChannels: PageChannel[] = [];
  let fileCount = 0;
  let missing = 0;
  const usedFolders = new Set<string>();

  for (const channel of channels) {
    const folder = uniqueName(
      usedFolders,
      safeName(`${String(channel.number).padStart(2, "0")} - ${channel.title}`, `${channel.number}`)
    );
    const items: PageChannel["items"] = [];
    const usedFiles = new Set<string>();
    let index = 0;

    for (const item of channel.media) {
      index += 1;
      const opened = await openMedia(CHANNEL_MEDIA_BUCKET, item.storage_path);
      if (!opened) {
        // A file the bucket cannot produce is left out of BOTH deliverables,
        // so the page never shows a broken image in a family's only copy.
        missing += 1;
        continue;
      }
      const stem = `${String(index).padStart(2, "0")}${item.caption ? ` - ${item.caption}` : ""}`;
      const name = uniqueName(
        usedFiles,
        `${safeName(stem, String(index).padStart(2, "0"))}${extensionFor(item.storage_path, item.file_type)}`
      );
      await appendAndWait(archive, opened.stream, {
        name: `${root}/${MEDIA_DIR}/${folder}/${name}`,
        store: true,
      });
      items.push({
        kind: item.file_type,
        href: relativeHref(MEDIA_DIR, folder, name),
        caption: item.caption,
        taken_on: item.taken_on,
        precision: item.taken_on ? item.taken_precision ?? "month" : null,
        place: item.place,
        people: item.people,
      });
      fileCount += 1;
    }

    // A channel with nothing in it is still part of the archive: the number
    // is on a card in the house, and a family looking for it should find the
    // empty shelf rather than wonder whether the export dropped it.
    archive.append("", { name: `${root}/${MEDIA_DIR}/${folder}/` });
    pageChannels.push({
      number: channel.number,
      title: channel.title,
      description: channel.description,
      date: channel.date,
      content_type: channel.content_type,
      items,
    });
  }

  /*
   * The faces, into their own folder.
   *
   * "Wie heeft dit gemaakt" shows each contributor's photograph, and a page
   * that cannot reach the internet cannot reach a profile picture either — so
   * the avatars travel with it. They are ordinary files under a folder a
   * person can read, like everything else here. A face the bucket cannot
   * produce simply leaves that card without one.
   */
  const usedFaces = new Set<string>();
  const pageContributors: {
    name: string;
    relationship: string | null;
    photos: number;
    voices: number;
    href: string | null;
  }[] = [];
  for (const person of contributors) {
    let href: string | null = null;
    if (person.photoPath) {
      const opened = await openMedia(PROFILE_PICTURES_BUCKET, person.photoPath);
      if (opened) {
        const name = uniqueName(
          usedFaces,
          `${safeName(person.name, "bijdrager")}${extensionFor(person.photoPath, "image")}`
        );
        await appendAndWait(archive, opened.stream, {
          name: `${root}/${FACES_DIR}/${name}`,
          store: true,
        });
        href = relativeHref(FACES_DIR, name);
      } else {
        missing += 1;
      }
    }
    pageContributors.push({
      name: person.name,
      relationship: person.relationship,
      photos: person.photos,
      voices: person.voices,
      href,
    });
  }

  const madeOn = now.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const monthYear = now
    .toLocaleDateString("nl-NL", { month: "long", year: "numeric" })
    .toUpperCase();
  const madeIn = `GEMAAKT IN ${monthYear}`;
  const template = await readFile(path.join(here, "..", "templates", "export", "begin-hier.html"), "utf8");
  /*
    One pass, and the values go in through a function (security review 29 Sep,
    input-3).

    A replacement STRING is not literal: `String.replace` expands `$&`, `$'`,
    `` $` `` and `$$` inside it. The values here are words a family typed — her
    name, a caption, a channel title — so a caption reading "cost $'s" pasted
    the rest of the template into the page's JSON and the archive page opened
    blank. A function's return value is inserted as it is.

    One pass rather than three chained ones for the same reason: the second
    pass used to run over the first one's output, so a name containing
    "{{ARCHIVE_JSON}}" would have been filled in too.
  */
  const fills: Record<string, string> = {
    SUBJECT: escapeHtml(subjectName),
    MADE_ON: escapeHtml(madeOn),
    ARCHIVE_JSON: inlineJson({
        subject: subjectName,
        made_on: madeOn,
        made_in: madeIn,
        made_in_short: monthYear,
        /*
          The stamp as a date, not as a sentence. The page can be read in
          Dutch or English and formats this itself; `made_in` above stays for
          the README and for anything that wants the Dutch wording as written.
        */
        made_iso: now.toISOString().slice(0, 10),
        /*
          The face of the whole thing: the first photograph in the archive,
          in channel order. Not the subject's own portrait — this is the
          archive's cover, and the first thing her family chose to put in it
          says more about it than a profile picture does. Null when there are
          no photographs at all, and the cover then stands on its own.
        */
        cover:
          pageChannels
            .flatMap((c) => c.items)
            .find((i) => i.kind === "image")?.href ?? null,
        photo_count: pageChannels.reduce(
          (n, c) => n + c.items.filter((i) => i.kind !== "audio").length,
          0
        ),
        voice_count: pageChannels.reduce(
          (n, c) => n + c.items.filter((i) => i.kind === "audio").length,
          0
        ),
        contributor_count: pageContributors.length,
        contributors: pageContributors,
        channels: pageChannels,
      }),
  };
  const page = template.replace(/\{\{(SUBJECT|MADE_ON|ARCHIVE_JSON)\}\}/g, (_match, key: string) => fills[key]);

  archive.append(page, { name: `${root}/${PAGE_NAME}` });
  archive.append(
    readmeText(subjectName, madeOn, { channels: pageChannels.length, files: fileCount, missing }),
    { name: `${root}/${README_NAME}` }
  );

  if (!failed) await archive.finalize();
}
