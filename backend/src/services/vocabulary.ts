import { supabase } from "../config/supabase.js";
import { PLACE_COLUMNS, TAG_COLUMNS } from "./dto.js";

/**
 * The words a family invents for itself (059) — places, and the tags that say
 * what a channel is about.
 *
 * Two rules hold this together, and both come from what the owner asked for:
 * "the user can create its own tag", and all of it optional.
 *
 * ONE SPELLING PER ARCHIVE. A free-text field typed by five people becomes
 * "Ostend", "ostend" and "Ostend " inside a month, and then the list of
 * places is useless as a list. The database has a unique index on
 * (archive_id, lower(btrim(name))); this module matches the same way before
 * inserting, so the normal path is a read rather than a caught violation. The
 * violation is still caught, because two people can press Create in the same
 * second.
 *
 * EVERY VOCABULARY IS ONE FAMILY'S. `places` and `tags` are archive-scoped
 * tables, and every function here takes the archive as its first argument for
 * the same reason every other query does: a route that cannot say whose words
 * these are has no business reading them.
 */

/** The comparison the unique index makes, made here too. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

interface Named {
  id: string;
  name: string;
}

async function listNamed(table: "places" | "tags", archiveId: string): Promise<Named[]> {
  const { data, error } = await supabase
    .from(table)
    .select(table === "places" ? PLACE_COLUMNS : TAG_COLUMNS)
    .eq("archive_id", archiveId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Named[];
}

/**
 * Turn the names a form sent into ids, inventing the ones that are new.
 *
 * Answers as a map from comparison key to id, not as a list. A list would
 * have to line up with the input, and it cannot: blanks, duplicates and
 * over-long names are all dropped, so position i of the answer is not
 * position i of the question. Callers that need alignment look each name up.
 *
 * A name longer than the column allows is dropped rather than truncated: a
 * silently shortened place name is a wrong answer that looks like a right one.
 */
async function resolveToMap(
  table: "places" | "tags",
  archiveId: string,
  names: string[],
  createdBy: string | null
): Promise<Map<string, string>> {
  const limit = table === "places" ? 80 : 40;
  const wanted: string[] = [];
  const seen = new Set<string>();

  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || name.length > limit) continue;
    if (seen.has(key(name))) continue;
    seen.add(key(name));
    wanted.push(name);
  }
  if (!wanted.length) return new Map();

  const existing = await listNamed(table, archiveId);
  const byKey = new Map(existing.map((row) => [key(row.name), row.id]));

  const fresh = wanted.filter((name) => !byKey.has(key(name)));
  if (fresh.length) {
    const { data, error } = await supabase
      .from(table)
      .insert(fresh.map((name) => ({ archive_id: archiveId, name, created_by: createdBy })))
      .select(table === "places" ? PLACE_COLUMNS : TAG_COLUMNS);

    if (error) {
      /*
        23505 is the unique index doing its job — someone else created the
        same word between the read and the write. That is not a failure of
        this call; the word exists, which is all the caller wanted. Re-read
        and carry on. Anything else is a real error and travels up.
      */
      if ((error as { code?: string }).code !== "23505") throw error;
      const after = await listNamed(table, archiveId);
      after.forEach((row) => byKey.set(key(row.name), row.id));
    } else {
      (data ?? []).forEach((row) => {
        const named = row as unknown as Named;
        byKey.set(key(named.name), named.id);
      });
    }
  }

  return byKey;
}

/** The ids for these names, in the caller's order, blanks and unknowns removed. */
async function resolveNames(
  table: "places" | "tags",
  archiveId: string,
  names: string[],
  createdBy: string | null
): Promise<string[]> {
  const byKey = await resolveToMap(table, archiveId, names, createdBy);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const id = typeof name === "string" ? byKey.get(key(name)) : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function listPlaces(archiveId: string): Promise<Named[]> {
  return listNamed("places", archiveId);
}

export function listTags(archiveId: string): Promise<Named[]> {
  return listNamed("tags", archiveId);
}

/** One place, by name. Null for a blank — "no place" is the common answer. */
export async function resolvePlace(
  archiveId: string,
  name: unknown,
  createdBy: string | null
): Promise<string | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const [id] = await resolveNames("places", archiveId, [name], createdBy);
  return id ?? null;
}

export function resolveTags(
  archiveId: string,
  names: string[],
  createdBy: string | null
): Promise<string[]> {
  return resolveNames("tags", archiveId, names, createdBy);
}

/**
 * Places for a whole upload at once, aligned with the files that named them.
 *
 * One read and at most one insert for the batch, rather than a round trip per
 * photograph: twenty photographs from one afternoon usually name the same
 * place twenty times. Blanks stay blank — "no place" is the common answer and
 * must not become an invented row.
 */
export async function resolvePlacesAligned(
  archiveId: string,
  names: (string | null)[],
  createdBy: string | null
): Promise<(string | null)[]> {
  const distinct = [...new Set(names.filter((n): n is string => !!n && !!n.trim()).map((n) => n.trim()))];
  if (!distinct.length) return names.map(() => null);

  const byKey = await resolveToMap("places", archiveId, distinct, createdBy);
  return names.map((n) => (n && n.trim() ? byKey.get(key(n)) ?? null : null));
}

/**
 * Replace a channel's tags with exactly this set.
 *
 * Delete-then-insert rather than a diff: the set is at most a handful of rows
 * and the intent — "these are the tags now" — survives being read months from
 * now. The delete is archive-scoped as well as channel-scoped, so a channel id
 * from another family removes nothing.
 */
export async function setChannelTags(
  archiveId: string,
  channelId: string,
  tagIds: string[]
): Promise<void> {
  const { error: cleared } = await supabase
    .from("channel_tags")
    .delete()
    .eq("channel_id", channelId)
    .eq("archive_id", archiveId);
  if (cleared) throw cleared;

  if (!tagIds.length) return;

  const { error } = await supabase.from("channel_tags").insert(
    tagIds.map((tag_id) => ({ channel_id: channelId, tag_id, archive_id: archiveId }))
  );
  if (error) throw error;
}

/**
 * Which people are in a photograph.
 *
 * The ids are checked against this archive's own people before they are
 * written. The composite foreign key would refuse a stranger anyway — that is
 * what (person_id, archive_id) is for — but a refusal at that depth arrives as
 * a constraint name in a 500, and the honest answer to "this id is not one of
 * yours" is to leave it out, not to sink the upload it rode in on.
 */
export async function setMediaPeople(
  archiveId: string,
  mediaFileId: string,
  personIds: string[],
  createdBy: string | null
): Promise<void> {
  const { error: cleared } = await supabase
    .from("media_people")
    .delete()
    .eq("media_file_id", mediaFileId)
    .eq("archive_id", archiveId);
  if (cleared) throw cleared;

  const wanted = [...new Set(personIds.filter((id) => typeof id === "string" && id))];
  if (!wanted.length) return;

  const { data: theirs, error: lookup } = await supabase
    .from("people")
    .select("id")
    .eq("archive_id", archiveId)
    .in("id", wanted);
  if (lookup) throw lookup;

  const allowed = (theirs ?? []).map((row) => row.id as string);
  if (!allowed.length) return;

  const { error } = await supabase.from("media_people").insert(
    allowed.map((person_id) => ({
      media_file_id: mediaFileId,
      person_id,
      archive_id: archiveId,
      created_by: createdBy,
    }))
  );
  if (error) throw error;
}

/** Place names for a set of media rows, as a map from place id to name. */
export async function placeNames(
  archiveId: string,
  placeIds: string[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(placeIds.filter(Boolean))];
  if (!wanted.length) return new Map();

  const { data, error } = await supabase
    .from("places")
    .select(PLACE_COLUMNS)
    .eq("archive_id", archiveId)
    .in("id", wanted);
  if (error) throw error;

  return new Map((data ?? []).map((row) => [(row as unknown as Named).id, (row as unknown as Named).name]));
}

/** Who is in each of these photographs, as a map from media id to person ids. */
export async function peopleInMedia(
  archiveId: string,
  mediaIds: string[]
): Promise<Map<string, string[]>> {
  const wanted = [...new Set(mediaIds.filter(Boolean))];
  if (!wanted.length) return new Map();

  const { data, error } = await supabase
    .from("media_people")
    .select("media_file_id, person_id")
    .eq("archive_id", archiveId)
    .in("media_file_id", wanted);
  if (error) throw error;

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const id = row.media_file_id as string;
    out.set(id, [...(out.get(id) ?? []), row.person_id as string]);
  }
  return out;
}

/** The tag names on each of these channels, as a map from channel id. */
export async function tagsOnChannels(
  archiveId: string,
  channelIds: string[]
): Promise<Map<string, string[]>> {
  const wanted = [...new Set(channelIds.filter(Boolean))];
  if (!wanted.length) return new Map();

  const { data, error } = await supabase
    .from("channel_tags")
    .select("channel_id, tags (name)")
    .eq("archive_id", archiveId)
    .in("channel_id", wanted);
  if (error) throw error;

  const out = new Map<string, string[]>();
  for (const row of data ?? []) {
    const id = (row as { channel_id: string }).channel_id;
    const tag = (row as { tags?: { name?: string } | { name?: string }[] }).tags;
    const name = Array.isArray(tag) ? tag[0]?.name : tag?.name;
    if (name) out.set(id, [...(out.get(id) ?? []), name]);
  }
  for (const [id, names] of out) out.set(id, names.sort((a, b) => a.localeCompare(b)));
  return out;
}
