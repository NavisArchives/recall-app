import { describe, expect, it } from "vitest";
import { RESERVED_CHANNEL_NUMBERS } from "../lib/channelNumbers.js";
import { PERSON_COLUMNS, PERSON_ADMIN_COLUMNS } from "../services/dto.js";
import { verifyFile } from "../services/media.js";

describe("reserved channel numbers", () => {
  it("reserves the display's own pages", () => {
    for (const n of [0, 10, 98, 99]) {
      expect(RESERVED_CHANNEL_NUMBERS.has(n)).toBe(true);
    }
  });

  it("leaves ordinary channel numbers available", () => {
    for (const n of [1, 5, 42, 97]) {
      expect(RESERVED_CHANNEL_NUMBERS.has(n)).toBe(false);
    }
  });

  /*
    11 is the one that changed (045). It used to be reserved for a screen
    that listed every instruction channel — but an instruction IS a channel
    and already has a number of its own, so the menu duplicated the things it
    listed. Asserted separately from the loop above rather than quietly moved
    into it, because a family can now assign 11 to real content and this is
    the line that says so.
  */
  it("frees 11 — an instruction is a channel, not a menu", () => {
    expect(RESERVED_CHANNEL_NUMBERS.has(11)).toBe(false);
  });
});

describe("response columns", () => {
  it("never selects the private storage path or a wildcard", () => {
    for (const columns of [PERSON_COLUMNS, PERSON_ADMIN_COLUMNS]) {
      expect(columns).not.toContain("*");
      expect(columns).not.toContain("verification_code");
    }
  });

  it("keeps contact details out of the public column list", () => {
    expect(PERSON_COLUMNS).not.toContain("email");
    expect(PERSON_COLUMNS).not.toContain("contact_number");
    expect(PERSON_ADMIN_COLUMNS).toContain("email");
  });
});

describe("upload type verification", () => {
  // A real 1x1 PNG; a truncated header is not enough to satisfy detection.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );

  it("accepts a real PNG by its signature", async () => {
    const result = await verifyFile(PNG, "image");
    expect(result?.kind).toBe("image");
    expect(result?.mime).toBe("image/png");
  });

  it("rejects a script disguised with an image name", async () => {
    const html = Buffer.from('<svg onload="alert(1)"></svg>');
    expect(await verifyFile(html, "media")).toBeNull();
  });

  it("rejects arbitrary text content", async () => {
    expect(await verifyFile(Buffer.from("just text"), "media")).toBeNull();
  });
});

describe("voice mode (051, spec 24b) — what a stories channel accepts", () => {
  /*
    Real headers, minimal bodies. `file-type` reads magic bytes, so a correct
    header is enough to get a verdict — and a verdict is all these assert.
  */
  /*
    Verified against the detector before being written down: a bare magic
    prefix is NOT enough for `file-type` — the mp3 needs a real MPEG frame
    sync after its ID3 tag, and EBML needs a DocType element actually saying
    "webm" (four magic bytes alone could be Matroska). Fixtures that the
    detector rejects would make every assertion below pass vacuously
    against `null`.
  */
  const MP3 = Buffer.concat([
    Buffer.from("ID3"),
    Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0xff, 0xfb, 0x90, 0x00]),
    Buffer.alloc(64),
  ]);
  // A WebM container: EBML header with DocType "webm". The same container
  // whether it holds a voice or a film — that ambiguity is the reason voice
  // mode exists.
  const WEBM = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]),
    Buffer.from([0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01]),
    Buffer.from([0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08]),
    Buffer.from([0x42, 0x82, 0x84]),
    Buffer.from("webm"),
    Buffer.from([0x42, 0x87, 0x81, 0x02, 0x42, 0x85, 0x81, 0x02]),
    Buffer.alloc(32),
  ]);

  it("audio is refused outside voice mode — an album cannot grow a soundtrack", async () => {
    expect(await verifyFile(MP3, "media")).toBeNull();
    expect(await verifyFile(MP3, "image")).toBeNull();
  });

  it("audio is accepted in voice mode, as audio", async () => {
    const result = await verifyFile(MP3, "voice");
    expect(result?.kind).toBe("audio");
  });

  it("a recorder's WebM container is audio in voice mode, video in media mode", async () => {
    /*
      Chrome's MediaRecorder writes voice recordings into WebM, whose magic
      bytes cannot say whether a video track exists. The channel's own type
      decides the reading: the same bytes are a film on an album channel and
      a voice on a stories channel. Both classifications must hold — if the
      media-mode half ever changes, every existing video upload changes
      meaning with it.
    */
    expect((await verifyFile(WEBM, "voice"))?.kind).toBe("audio");
    expect((await verifyFile(WEBM, "media"))?.kind).toBe("video");
  });

  it("garbage is refused in voice mode exactly as everywhere else", async () => {
    expect(await verifyFile(Buffer.from("just text"), "voice")).toBeNull();
  });
});
