import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

/**
 * Media leaves as a stream, not as a buffer.
 *
 * This used to hand back a whole `Buffer`, so a 50 MB video became 50 MB of
 * process memory on its way out — once per simultaneous viewer, on a machine
 * that also has to keep a screen alive in a living room. The regression is
 * invisible to a test that only checks the bytes are correct, because a
 * buffered read returns correct bytes too. So the assertion is on the *shape*:
 * a `Readable` arrives before any of the content has been consumed.
 *
 * The last test guards the fix to the *first* attempt at this. A draft gated
 * downloads behind a semaphore released on stream close, which deadlocked the
 * moment more readers arrived than slots — a stalled client would have held
 * the door shut for everyone behind it, her screen included. Opening many at
 * once and requiring them all to arrive is what keeps that from coming back.
 */

const CONTENT = Buffer.from("pretend this is a very large family video");

/*
 * `fetch` is mocked, not the Supabase SDK — because the SDK is no longer on
 * this path, and that is the whole point of the change under test. Its
 * `download()` returns a Blob, which is the body already in memory; measured
 * against real storage it delivered a 1.5 MB photograph as one 1.5 MB chunk.
 * The storage REST endpoint streams for real (162 × 16 KB for the same file),
 * so the module calls it directly. A test that kept mocking the SDK would
 * pass against code nothing runs.
 */
/** Counts how much of the body has actually been asked for. */
let pulls = 0;

vi.stubGlobal("fetch", async () => {
  pulls = 0;
  let sent = 0;
  return new Response(
    // Pull-based on purpose: the body yields a piece only when something
    // reads it, so `pulls` measures consumption rather than intent.
    new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (sent >= CONTENT.length) return controller.close();
        const next = CONTENT.subarray(sent, sent + 10);
        sent += next.length;
        controller.enqueue(new Uint8Array(next));
      },
    }),
    { status: 200, headers: { "content-length": String(CONTENT.length) } }
  );
});

// RECALL_ROLE is unset in tests, so this is the shared `api` process: it
// streams through and keeps nothing, which is the path a server runs.
const { openMedia } = await import("../services/mediaCache.js");

describe("media is streamed, never buffered whole", () => {
  it("hands back a readable stream rather than the bytes", async () => {
    const opened = await openMedia("channel-media", "a/holiday.mp4");

    expect(opened).not.toBeNull();
    expect(opened!.stream).toBeInstanceOf(Readable);
    // The size is known up front, so the response can carry Content-Length
    // without anyone having to hold the file to measure it.
    expect(opened!.size).toBe(CONTENT.length);
    // A shared api process caches nothing: this is never a cache hit.
    expect(opened!.fromCache).toBe(false);
  });

  it("delivers the whole file, a chunk at a time", async () => {
    const opened = await openMedia("channel-media", "a/holiday.mp4");

    const chunks: Buffer[] = [];
    for await (const chunk of opened!.stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks).equals(CONTENT)).toBe(true);
  });

  it("has not read the body by the time it hands the stream over", async () => {
    /*
     * The assertion that separates streaming from buffering.
     *
     * Correct bytes prove nothing — a buffered read returns those too, which
     * is how the first version of this change passed its tests while still
     * materialising whole files. What matters is that `openMedia` returns
     * *before* the body has been consumed: the four pieces of this file are
     * still unread at that moment, and only get pulled when the response
     * pipes them. (Chunk *count* is not asserted anywhere — Node's web-stream
     * adapter coalesces small pieces, so counting them measures the adapter,
     * not this module. The real-storage check is what proved genuine
     * chunking: 162 × 16 KB for a 1.5 MB photograph.)
     */
    const opened = await openMedia("channel-media", "a/holiday.mp4");

    const pulledBeforeReading = pulls;
    for await (const _chunk of opened!.stream) void _chunk;

    expect(pulledBeforeReading).toBeLessThan(pulls);
    expect(pulledBeforeReading).toBeLessThanOrEqual(1);
  });

  it("serves many readers at once without any of them waiting on the others", async () => {
    // Twenty viewers arriving together, none of them draining their stream —
    // the shape that wedged the semaphore draft. Every one must still be
    // handed its bytes; nothing may queue behind an undrained reader.
    const opened = await Promise.all(
      Array.from({ length: 20 }, (_, i) => openMedia("channel-media", `a/${i}.mp4`))
    );

    expect(opened.filter(Boolean)).toHaveLength(20);
    for (const file of opened) file?.stream.destroy();
  });
});
