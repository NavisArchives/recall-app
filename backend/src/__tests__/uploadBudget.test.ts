import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { readFile, unlink } from "node:fs/promises";
import type { Request } from "express";
import {
  boundedDiskStorage,
  MAX_REQUEST_BYTES,
  UploadBudgetExceededError,
} from "../middleware/upload.js";

/**
 * The meter that Content-Length cannot replace.
 *
 * A chunked request declares no length, so the only honest bound is counted
 * during parsing. These tests drive the storage engine directly with fake
 * file streams — the same interface multer hands it — because sending 200 MB
 * through supertest would make the suite pay for what the engine refuses.
 * One 32 MB buffer is pushed repeatedly: the meter counts lengths, not
 * identities, so memory stays flat while the counted total climbs.
 */

const CHUNK = Buffer.alloc(32 * 1024 * 1024);

function fileFrom(stream: Readable) {
  return { stream } as unknown as Express.Multer.File;
}

function handle(req: Request, stream: Readable) {
  return new Promise<{ error?: unknown; info?: { path?: string; size?: number } }>((resolve) => {
    boundedDiskStorage._handleFile(req, fileFrom(stream), (error, info) =>
      resolve({ error: error ?? undefined, info })
    );
  });
}

describe("the upload budget is counted while parsing", () => {
  it("streams a file under the budget to disk untouched", async () => {
    const req = {} as Request;
    const body = Buffer.from("a small photograph");

    const { error, info } = await handle(req, Readable.from([body]));

    expect(error).toBeUndefined();
    expect(info?.size).toBe(body.length);
    // The bytes on disk are the bytes that arrived.
    expect((await readFile(info!.path!)).equals(body)).toBe(true);
    await unlink(info!.path!);
  });

  it("aborts the moment the counted total passes the budget", async () => {
    const req = {} as Request;
    const chunks = Math.ceil(MAX_REQUEST_BYTES / CHUNK.length) + 1;

    const { error, info } = await handle(
      req,
      Readable.from(Array.from({ length: chunks }, () => CHUNK))
    );

    expect(error).toBeInstanceOf(UploadBudgetExceededError);
    // The refused file's temp bytes do not linger.
    expect(info).toBeUndefined();
  });

  it("shares one budget across every file in a request", async () => {
    // Two files still meet one meter: the request's. The second file
    // inherits what the first spent, so it is refused where the same bytes
    // alone would have passed.
    const req = {} as Request;
    const first = await handle(req, Readable.from([CHUNK]));

    const remaining = Math.ceil((MAX_REQUEST_BYTES - CHUNK.length) / CHUNK.length) + 1;
    const second = await handle(
      req,
      Readable.from(Array.from({ length: remaining }, () => CHUNK))
    );

    expect(first.error).toBeUndefined();
    expect(second.error).toBeInstanceOf(UploadBudgetExceededError);
    if (first.info?.path) await unlink(first.info.path);
  });
});
