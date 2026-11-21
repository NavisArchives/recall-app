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
 * M104 — the ask bar's roots: a read-only search over her archive.
 *
 * A query comes in; matching archive content comes back with its provenance
 * — never a write, never a navigation, never a change to the display.
 * "Recall never changes her screen" is a hard invariant, and here it is
 * proven by mechanism: the recorder sees every query the route issues, so
 * zero write operations is a fact of the transcript, not a promise.
 *
 * Voice notes are a declared gap: no audio media type, no transcripts. The
 * corpus says so, and no result ever claims a voice-note source.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const CH_GARDEN = "aaaaaaaa-0000-0000-0000-00000000ch03";

function cookies() {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, {
    expiresIn: 3600,
  });
  const profile = jwt.sign(
    { personId: ADMIN_A, name: "Claire", role: "admin", archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

function world() {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true }],
    people: [
      {
        id: ADMIN_A,
        name: "Claire",
        relationship: "Daughter",
        description: "Keeps the archive",
        birthday: null,
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: ARCHIVE_A,
        email: "claire@example.invalid",
        contact_number: "+3222222222",
      },
      {
        id: "aaaaaaaa-0000-0000-0000-0000000000g1",
        name: "Hélène Fournier",
        relationship: "Daughter",
        description: "Cooks the Sunday lunches",
        birthday: null,
        archived_at: null,
        archive_id: ARCHIVE_A,
        email: "helene@example.invalid",
        contact_number: "+3233333333",
      },
    ],
    channels: [
      {
        id: CH_GARDEN,
        number: 3,
        title: "The garden",
        description: "Her roses, every June since 1975",
        date: "2020-06-01",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
      // The channel that exposed the fault: it shares only the word "with".
      {
        id: "aaaaaaaa-0000-0000-0000-00000000ch04",
        number: 4,
        title: "Sunday with Family",
        description: "Everyone around the table",
        date: "2019-05-01",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
      /*
       * The owner's second report, kept literally. A family's own words are
       * whatever they are — this archive's description happens to say
       * "petite", and a search for "pet" was answered with this channel.
       * Nothing in the title or on the card showed why, which is what made
       * it read as invention rather than as a bad match.
       */
      {
        id: "aaaaaaaa-0000-0000-0000-00000000ch07",
        number: 7,
        title: "Un message de Odette",
        // Decomposed on purpose: "filme\u0301e" is e + a combining acute,
        // which is what macOS hands over when a carer types or pastes a
        // caption. Folding strips the mark and the string gets *shorter*,
        // so any offset computed against the folded copy lands wrong here.
        description: "Sa petite-fille, filme\u0301e dans la cuisine",
        date: "2021-03-02",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
      /*
       * A word with an ending on it, next door to one that only looks like
       * it has. "Verte" is "vert" inflected; "petite" is not "pet" inflected.
       * The two live in the same fixture so no rule can satisfy one by
       * quietly breaking the other.
       */
      {
        id: "aaaaaaaa-0000-0000-0000-00000000ch01",
        number: 1,
        title: "The house on Rue Verte",
        description: "Where she cooked every Sunday",
        date: "1975-01-01",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
    ],
    media_files: [
      {
        id: "m3",
        channel_id: CH_GARDEN,
        archive_id: ARCHIVE_A,
        file_type: "image",
        caption: "Roses in June, the year the arbour went up",
        taken_on: "1998-06-15",
        archived_at: null,
      },
    ],
  });
}

function search(q: string) {
  return request(app).get("/api/search").query({ q }).set("Cookie", cookies());
}

beforeEach(() => world());

describe("the archive answers a question", () => {
  it("returns a matching caption with its provenance", async () => {
    const res = await search("roses arbour");

    expect(res.status).toBe(200);
    const hit = res.body.results.find((r: { source: string }) => r.source === "photo");
    expect(hit).toBeTruthy();
    expect(hit.text).toContain("arbour");
    expect(hit.provenance).toMatchObject({
      channel_id: CH_GARDEN,
      channel_number: 3,
      channel_title: "The garden",
      media_id: "m3",
    });
  });

  it("returns channel and person snippets with their own provenance", async () => {
    const res = await search("garden");
    const channelHit = res.body.results.find((r: { source: string }) => r.source === "channel");
    expect(channelHit.provenance).toMatchObject({ channel_id: CH_GARDEN, channel_number: 3 });

    const who = await search("daughter archive");
    const personHit = who.body.results.find((r: { source: string }) => r.source === "person");
    expect(personHit.provenance).toMatchObject({ person_id: ADMIN_A, name: "Claire" });
  });

  it("answers nonsense with an honest empty result, not an invention", async () => {
    const res = await search("zeppelin marmalade");

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("refuses a missing or blank query in words", async () => {
    const res = await request(app).get("/api/search").set("Cookie", cookies());
    expect(res.status).toBe(400);
  });
});

describe("the hard invariants", () => {
  it("never writes — her screen is untouched, proven from the transcript", async () => {
    await search("roses");

    const writes = recorder.queries.filter((q) => q.op !== "select");
    expect(writes).toEqual([]);
    // And specifically nothing touched what the display runs on.
    expect(recorder.forTable("screen_state")).toHaveLength(0);
    expect(recorder.forTable("settings")).toHaveLength(0);
    expect(recorder.forTable("channel_visits")).toHaveLength(0);
  });

  it("carries no contact details, though the rows offered them", async () => {
    const res = await search("daughter archive claire");

    const text = JSON.stringify(res.body);
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("+32");
  });

  it("declares the voice-note gap instead of papering over it", async () => {
    const res = await search("roses");

    expect(res.body.corpus.voice_notes).toMatchObject({ available: false });
    for (const r of res.body.results) {
      expect(r.source).not.toBe("voice_note");
    }
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/search").query({ q: "roses" });
    expect(res.status).toBe(401);
  });
});

describe("the archive recognises the people in a question", () => {
  /*
   * The ask bar answered by quoting the question back — "'When Did She Hang
   * Out With Helene' has been found in 3 channels" — which reads as
   * though the archive contained that sentence. It contained one word of
   * it: a person's name.
   *
   * So the search says what it actually recognised, in the archive's own
   * spelling: the family types "helene" and the archive knows Hélène.
   * No model is involved — the people are already a table, and matching a
   * query word against a name is the same substring test as everything
   * else. It is person-*awareness*, not intelligence.
   */
  it("names the person it recognised, accents and all", async () => {
    const res = await search("when did she hang out with helene");

    expect(res.status).toBe(200);
    expect(res.body.subject.people).toEqual([
      expect.objectContaining({ name: "Hélène Fournier", relationship: "Daughter" }),
    ]);
    // What the page should put in quotation marks: the archive's spelling,
    // not the visitor's typing.
    expect(res.body.subject.label).toBe("Hélène Fournier");
  });

  it("falls back to the words that matched when no person is named", async () => {
    const res = await search("roses");

    expect(res.body.subject.people).toEqual([]);
    expect(res.body.subject.label).toBe("roses");
  });

  it("says nothing rather than something when nothing matched", async () => {
    const res = await search("zeppelin marmalade");

    expect(res.body.results).toEqual([]);
    expect(res.body.subject.label).toBe(null);
  });

  /*
   * M157 — a name is not a word with endings on it.
   *
   * The person recogniser was reusing the corpus matcher, so names went
   * through the ending whitelist: "mari" — French for husband — plus the
   * permitted "e" recognised **Marie**, and the headline then announced
   * her by name. That is the owner's original complaint in its purest
   * form: the archive naming, with confidence, somebody it had not found.
   *
   * Endings are the wrong apparatus for names by construction. Names do
   * not inflect: nobody has two Maries in the plural. A person is
   * recognised when the word *is* their name, folded — accents and case
   * normalised, because "helene" must still find Hélène, but nothing
   * added and nothing taken away.
   */
  it("recognises a person only when the word is their name", async () => {
    // "clair" is one letter short of Claire, and the ending rule used to
    // close that gap on her behalf.
    const nearly = await search("clair");
    expect(nearly.body.subject.people).toEqual([]);
    // The headline is the thing that was lying, so this is what must not
    // happen: her name announced as the subject of the question. The word
    // itself may still fall back into the label, which is honest — it says
    // what was typed, not who was found.
    expect(nearly.body.subject.label).not.toBe("Claire");

    const exactly = await search("claire");
    expect(exactly.body.subject.people).toEqual([
      expect.objectContaining({ name: "Claire" }),
    ]);
  });

  it("still forgives an accent, which is spelling and not an ending", async () => {
    const res = await search("helene");
    expect(res.body.subject.label).toBe("Hélène Fournier");

    // ...but not a letter short of it.
    const short = await search("geraldin");
    expect(short.body.subject.people).toEqual([]);
  });
});

describe("it does not claim to have found what it has not", () => {
  /*
   * The reported "hallucination", and it was never a model — it was the
   * matcher taking every word of a sentence seriously. "When did she hang
   * out with Helene" carries eight words, and "with", "she", "out" and
   * "did" appear all over an archive: a channel called "Sunday with Family"
   * matched on the word *with* and was then announced as containing the
   * question. Confident, specific, and false.
   *
   * Two rules fix it without a gram of intelligence: ignore the words that
   * carry no meaning, and match whole words rather than any run of letters
   * ("out" must not find "about", though "photo" should still find
   * "photographs").
   */
  it("ignores the words a question is made of", async () => {
    const res = await search("when did she hang out with helene");

    // Only the name is a real term; the scaffolding of the sentence is not.
    expect(res.body.subject.terms).toEqual(["helene"]);
    // "Sunday with Family" shares only the word "with" — it is not an answer
    // to a question about Hélène, and must not be listed as one.
    const titles = res.body.results.map((r: { text: string }) => r.text).join(" | ");
    expect(titles).not.toContain("Sunday with Family");
  });

  it("matches whole words, not any run of letters", async () => {
    // "rose" is a word in "Roses"; "ose" is not a word at all.
    const real = await search("rose");
    expect(real.body.results.length).toBeGreaterThan(0);

    const spurious = await search("ose");
    expect(spurious.body.results).toEqual([]);
  });

  it("answers a question made only of common words with nothing", async () => {
    const res = await search("when did she");

    expect(res.body.results).toEqual([]);
    expect(res.body.subject.label).toBe(null);
  });

  /*
   * The second report, and the same fault one layer down: "pet" answered
   * with a channel whose description says "petite". Whole-word matching had
   * a prefix rule in it — deliberately, so "photo" could find
   * "photographs" — and a prefix rule cannot tell a plural from a different
   * word. "pet" is not the stem of "petite" in any language.
   *
   * So the rule is now exact, allowing only for a plural. It matches less;
   * everything it matches, the family can see for themselves.
   */
  it("does not treat a short word as the stem of a longer one", async () => {
    const res = await search("pet");

    expect(res.body.results).toEqual([]);
    expect(res.body.subject.label).toBe(null);
  });

  it("still matches across a plural, in either direction", async () => {
    // The channel says "Roses"; the family types either.
    const singular = await search("rose");
    const plural = await search("roses");

    expect(singular.body.results.length).toBeGreaterThan(0);
    expect(plural.body.results.length).toBeGreaterThan(0);
  });

  /*
   * The over-correction, caught by Feedback's walk. Refusing every ending
   * but a plural also refused "vert" → "Verte" and "cook" → "cooked",
   * which are the same word by any reading. Counting letters cannot tell
   * an inflection from a different word either — so the endings are named:
   * a plural, or the handful that mark a tense or a gender. "petite" is
   * still not "pet" with an ending on it.
   */
  it("reaches an inflected form without reaching a different word", async () => {
    const inflected = await search("vert"); // the channel says "Verte"
    expect(inflected.body.results.length).toBeGreaterThan(0);

    const different = await search("pet"); // the channel says "petite"
    expect(different.body.results).toEqual([]);
  });

  /*
   * Found by asking the live archive rather than the fixture: a channel
   * called "Watering the plants" was unreachable by the word "water". The
   * same class Feedback caught, so it is fixed in the same breath rather
   * than left for someone to report.
   */
  it("reaches a verb the archive happened to write as an activity", async () => {
    const res = await search("cook"); // the channel says "cooked"

    const titles = res.body.results.map((r: { text: string }) => r.text).join(" | ");
    expect(titles).toContain("Rue Verte");
  });
});

/**
 * M154 — the highlight is a by-product of the match.
 *
 * The card used to be handed a list of matched *terms* and work out for
 * itself which words to underline, using its own copy of the fold and
 * same-word rules. Two implementations of one rule, agreeing by luck: the
 * day they disagreed, the card would have underlined a word that did not
 * cause the result — the matcher's old lie, moved into the explanation,
 * where nobody would think to look for it.
 *
 * So the matcher returns the ranges it matched. There is no second rule to
 * drift, and these tests are about that property rather than about
 * highlighting: the ranges must come from the *same* decision that produced
 * the result, and must be true offsets into the text the family reads.
 */
describe("the evidence comes from the match itself", () => {
  function span(text: string, r: { start: number; end: number }) {
    return text.slice(r.start, r.end);
  }

  it("locates the matched word in the text it returned", async () => {
    const res = await search("roses");

    const hit = res.body.results.find((r: { text: string }) => r.text.includes("Roses"));
    expect(hit.matches.length).toBeGreaterThan(0);
    // Sliced out of the very string the card renders — the archive's own
    // capitalisation, not the query's.
    expect(span(hit.text, hit.matches[0])).toBe("Roses");
  });

  it("marks the inflected word the matcher accepted, not the word typed", async () => {
    // The rule allows "cook" to reach "cooked"; the evidence must point at
    // "cooked", which is what is actually written in the archive. If this
    // ever points at something else, the ending set and the ranges have
    // come apart — which is the drift this mission exists to make
    // impossible.
    const res = await search("cook");

    const hit = res.body.results.find((r: { text: string }) => r.text.includes("cooked"));
    expect(hit.matched_terms).toEqual(["cook"]);
    expect(hit.matches.map((r: { start: number; end: number }) => span(hit.text, r))).toEqual([
      "cooked",
    ]);
  });

  it("counts positions in the text as written, accents and all", async () => {
    // Folding decomposes and strips accents, so a range computed against the
    // folded copy could land off by one per accent. "filmée" sits after two
    // accented characters in that description.
    const res = await search("filmee");

    const hit = res.body.results.find((r: { text: string }) => r.text.includes("filme\u0301e"));
    expect(span(hit.text, hit.matches[0])).toBe("filme\u0301e");
  });

  it("marks nothing it did not match", async () => {
    const res = await search("roses");

    for (const r of res.body.results) {
      for (const m of r.matches) {
        const word = span(r.text, m).toLowerCase();
        expect(["rose", "roses"]).toContain(word);
      }
    }
  });
});
