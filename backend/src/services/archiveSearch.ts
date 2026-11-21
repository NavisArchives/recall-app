import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import type { ProfileSession } from "../middleware/auth.js";
import { readableChannelIds } from "./channelVisibility.js";

/**
 * M104 — the ask bar's roots: read-only retrieval over one archive.
 *
 * One function assembles the searchable text of an archive — channel titles
 * and descriptions, photo captions, the family circle — each snippet
 * carrying its provenance, so a future answer can cite "from her photos and
 * descriptions". Factual questions (counts, dates, usage) are not answered
 * here: they belong to M103's structured streams, one source per fact.
 *
 * Hard rules, by construction:
 *
 * - **Read-only.** Nothing in this file writes. The ask path must never
 *   change her screen — no `screen_state`, no visits, no navigation.
 * - **Archive-scoped.** Every query names the family it means.
 * - **No contact details.** `email` and `contact_number` are never selected
 *   and never built into a snippet.
 * - **Voice notes are a declared gap.** The design promises answers "from
 *   voice notes", but there is no audio media type and no transcripts —
 *   `media_files.file_type` allows only image and video. The corpus says so
 *   rather than pretending; when transcription exists, transcripts join as
 *   one more snippet source below.
 */

/**
 * Where in `text` the match actually happened — character offsets, half-open.
 *
 * M154. The card used to re-derive this in the browser from `matched_terms`,
 * which meant the evidence a family reads was computed by a *different
 * implementation* than the claim it justifies: a second opinion that happened
 * to agree. When the two drifted, the card would underline a word that did
 * not cause the result — the same lie the matcher itself once told, moved
 * into the explanation, where it is far harder to notice.
 *
 * So the ranges come from the match itself. They are produced by the one
 * traversal that decides whether a snippet matches at all, which means the
 * highlight cannot disagree with the matcher: there is nothing to disagree
 * with.
 */
export interface MatchRange {
  start: number;
  end: number;
}

export interface SearchSnippet {
  source: "channel" | "photo" | "person";
  text: string;
  matched_terms: string[];
  /** The words that caused this result, located in `text`. */
  matches: MatchRange[];
  provenance:
    | {
        channel_id: string;
        channel_number: number;
        channel_title: string;
        media_id?: string;
        /*
          The matched photograph itself, as the stable backend media URL the
          channel routes already hand out (8b draws up to three matched
          thumbnails per channel). Same authenticated door as everywhere
          else — never a storage path.
        */
        media_url?: string;
      }
    | { person_id: string; name: string };
}

/**
 * What the archive recognised in the question (M104 follow-through).
 *
 * The page used to quote the whole question back — "'When did she hang out
 * with Helene' has been found in 3 channels" — which reads as though the
 * archive held that sentence. It held one word of it: a name. So the search
 * says what it actually recognised, in the archive's own spelling, and the
 * page has something true to put in quotation marks.
 *
 * No model is involved. The people are already a table and matching a word
 * against a name is the same substring test as everything else — this is
 * person-*awareness*, not intelligence, and it is worth being precise about
 * the difference.
 */
export interface SearchSubject {
  /** The best single thing to name: a recognised person, else the words. */
  label: string | null;
  /** People the question named, in the archive's spelling. Never contact
   *  details — the same rule as every other person-facing payload. */
  people: { id: string; name: string; relationship: string | null }[];
  /** The query's own words that matched something, as typed. */
  terms: string[];
}

export interface SearchResult {
  query: string;
  subject: SearchSubject;
  results: SearchSnippet[];
  corpus: {
    channels: number;
    captioned_photos: number;
    people: number;
    voice_notes: { available: false; reason: string };
  };
}

/** Lowercased, accent-folded, so "église" answers "eglise". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * The words a question is *made of*, which are not what it is *about*.
 *
 * "When did she hang out with Helene" carries eight words; seven of them
 * appear all over any archive. Taking them seriously is what made a channel
 * called "Sunday with Family" an answer to a question about Hélène — it
 * shared the word *with*. A stop list is the whole cure, and it is the
 * oldest trick in search rather than a clever one.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "hers", "him", "his", "how", "i", "in",
  "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "out", "over", "she", "so",
  "that", "the", "their", "them", "then", "there", "these", "they", "this", "to", "up", "us",
  "was", "we", "were", "what", "when", "where", "which", "who", "whom", "why", "will", "with",
  "you", "your",
]);

function terms(query: string): string[] {
  return [
    ...new Set(
      fold(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    ),
  ];
}

/**
 * Whether two words are the same word, allowing for an ending.
 *
 * Two wrong answers came before this one, and both are worth keeping in
 * view because they fail in opposite directions.
 *
 * A plain prefix rule ("anything starting with the term") was too
 * generous: it let "photo" find "photographs", which is pleasant, and it
 * let **"pet" find "petite"**, which had the archive answer a question
 * about a pet with a video of somebody's granddaughter.
 *
 * Allowing only a plural was then too mean: it also refused "vert" →
 * "Verte" and "cook" → "cooked", which are the same word by any reading,
 * in an archive whose families write in more than one language.
 *
 * Neither can be fixed by counting letters — "petite" is exactly as far
 * from "pet" as "cooked" is from "cook". So the endings are *named*: a
 * plural, or the few that mark a tense or a gender. "ite" is not among
 * them and never will be. A whitelist is honest about being a judgement:
 * to widen the reach, add an ending deliberately and say why.
 *
 * The `>= 4` guard keeps the softer endings off very short words, so
 * "pet" cannot reach a person called Pete.
 */
const ENDINGS = ["s", "es"] as const;
const ENDINGS_FOR_LONGER_WORDS = ["e", "d", "ed", "ing"] as const;

function isSameWord(word: string, term: string): boolean {
  if (word === term) return true;
  const [longer, shorter] = word.length > term.length ? [word, term] : [term, word];
  if (!longer.startsWith(shorter)) return false;
  const ending = longer.slice(shorter.length);
  if ((ENDINGS as readonly string[]).includes(ending)) return true;
  return shorter.length >= 4 && (ENDINGS_FOR_LONGER_WORDS as readonly string[]).includes(ending);
}

/**
 * The one traversal: which terms a text matched, and exactly where (M154).
 *
 * Both answers come out of the same walk, deliberately. The alternative —
 * decide the match here, describe it as a list of terms, and let the card
 * work out the positions — is what put a second implementation of this rule
 * in the browser. Anything that has to be re-derived downstream will
 * eventually be re-derived *differently*.
 *
 * Positions are counted in the original text, not the folded one: folding
 * decomposes and strips accents, and there is no promise that it preserves
 * length. So each word is located as written and folded only to compare —
 * the offsets stay true to the string the family actually reads.
 */
function matchWords(text: string, wanted: string[]): { terms: string[]; matches: MatchRange[] } {
  const terms = new Set<string>();
  const matches: MatchRange[] = [];

  /*
    `\p{M}` earns its place: a combining accent is a mark, not a letter, so
    without it "filmée" typed on a Mac — where the accent arrives as a
    separate character — tokenises as "filme" + "e" and matches nothing at
    all. The old matcher folded the whole string before splitting and so
    never met this; folding word by word does, and a search that quietly
    failed on half of one family's captions would have been a far worse bug
    than the one this mission is fixing.
  */
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const word = fold(m[0]);
    const hit = wanted.filter((t) => isSameWord(word, t));
    if (hit.length === 0) continue;
    for (const t of hit) terms.add(t);
    matches.push({ start: m.index, end: m.index + m[0].length });
  }

  return { terms: [...terms], matches };
}

/*
  A candidate is just its snippet now. It used to carry a pre-folded copy of
  its own text for the matcher to scan; the matcher folds word by word
  instead, so the second copy — and the chance of it going stale — is gone.
*/
type Candidate = Omit<SearchSnippet, "matched_terms" | "matches">;

const MAX_RESULTS = 20;

export async function searchArchive(
  archiveId: string,
  query: string,
  profile: ProfileSession
): Promise<SearchResult> {
  const wanted = terms(query);

  const [channelsRes, mediaRes, peopleRes] = await Promise.all([
    supabase
      .from("channels")
      .select("id, number, title, description, date, created_by, privacy_level")
      .eq("archive_id", archiveId)
      .is("archived_at", null),
    supabase
      .from("media_files")
      .select("id, channel_id, caption, taken_on")
      .eq("archive_id", archiveId)
      .is("archived_at", null)
      .not("caption", "is", null),
    supabase
      .from("people")
      .select("id, name, relationship, description, birthday")
      .eq("archive_id", archiveId)
      .is("archived_at", null),
  ]);

  for (const [res, what] of [
    [channelsRes, "channels"],
    [mediaRes, "media"],
    [peopleRes, "people"],
  ] as const) {
    if (res.error) throw new Error(`search: ${what}: ${res.error.message}`);
  }

  const channels = (channelsRes.data ?? []) as {
    id: string;
    number: number;
    title: string;
    description: string | null;
    date: string | null;
    created_by: string | null;
    privacy_level: number;
  }[];
  const media = (mediaRes.data ?? []) as {
    id: string;
    channel_id: string;
    caption: string | null;
    taken_on: string | null;
  }[];
  const people = (peopleRes.data ?? []) as {
    id: string;
    name: string;
    relationship: string | null;
    description: string | null;
    birthday: string | null;
  }[];

  const readable = await readableChannelIds(archiveId, channels, profile, false);
  const visibleChannels = channels.filter((channel) => readable.has(channel.id));
  const channelById = new Map(visibleChannels.map((c) => [c.id, c]));

  // The corpus: every snippet built from named text fields and nothing else.
  const candidates: Candidate[] = [];

  for (const c of visibleChannels) {
    const text = [c.title, c.description, c.date].filter(Boolean).join(" — ");
    candidates.push({
      source: "channel",
      text,
      provenance: { channel_id: c.id, channel_number: c.number, channel_title: c.title },
    });
  }

  for (const m of media) {
    if (!m.caption?.trim()) continue;
    const channel = channelById.get(m.channel_id);
    if (!channel) continue; // an orphaned caption names nothing she can see
    const text = [m.caption, m.taken_on].filter(Boolean).join(" — ");
    candidates.push({
      source: "photo",
      text,
      provenance: {
        channel_id: channel.id,
        channel_number: channel.number,
        channel_title: channel.title,
        media_id: m.id,
        media_url: `${env.publicUrl}/api/media/${m.id}/file`,
      },
    });
  }

  for (const p of people) {
    const text = [p.name, p.relationship, p.description, p.birthday].filter(Boolean).join(" — ");
    candidates.push({
      source: "person",
      text,
      provenance: { person_id: p.id, name: p.name },
    });
  }

  // Rank: how many of the asked-for terms a snippet carries; everything with
  // at least one. Deterministic, explainable, and honest about "no match".
  const results = candidates
    .map((c) => {
      // One walk decides the match and locates it. The card marks what
      // came back; it never works out for itself what should be marked.
      const { terms: matched, matches } = matchWords(c.text, wanted);
      return { ...c, matched_terms: matched, matches };
    })
    .filter((s) => s.matched_terms.length > 0)
    .sort((a, b) => b.matched_terms.length - a.matched_terms.length)
    .slice(0, MAX_RESULTS);

  /*
   * Who the question named — by their name exactly, and nothing near it
   * (M157).
   *
   * This used to share the corpus matcher, which meant names were run
   * through the ending whitelist. "mari" — French for husband — plus the
   * permitted "e" recognised **Marie**, and the headline then announced
   * her by name: the archive naming, with confidence, a person it had not
   * been asked about. The owner's original complaint, in its purest form.
   *
   * Endings are simply the wrong apparatus here. A name does not inflect —
   * there is no plural of Marie, no past tense of Sophie — so every ending
   * the whitelist allows is, for a name, a different name or no name at
   * all. Folding stays, because that is spelling rather than grammar:
   * "helene" must still find Hélène. Nothing added, nothing removed.
   */
  const named = people
    .filter((p) => {
      const parts = fold(p.name).split(/\s+/).filter(Boolean);
      return wanted.some((t) => parts.includes(t));
    })
    .map((p) => ({ id: p.id, name: p.name, relationship: p.relationship ?? null }));

  const matchedTerms = [...new Set(results.flatMap((r) => r.matched_terms))];

  return {
    query,
    subject: {
      // One recognised person is the clearest thing to name; several are
      // listed; otherwise the words themselves, and null when the archive
      // recognised nothing at all rather than a confident-sounding echo.
      label: named.length
        ? named.map((p) => p.name).join(" and ")
        : matchedTerms.length
          ? matchedTerms.join(" ")
          : null,
      people: named,
      terms: matchedTerms,
    },
    results,
    corpus: {
      channels: visibleChannels.length,
      captioned_photos: media.filter((m) => !!m.caption?.trim() && channelById.has(m.channel_id)).length,
      people: people.length,
      voice_notes: {
        available: false,
        reason:
          "Voice notes are not captured yet: media_files allows only image and video, and no transcripts exist. Transcripts join the corpus as a snippet source when that decision is made.",
      },
    },
  };
}
