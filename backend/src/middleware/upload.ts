import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";

/**
 * Refused because the request as a whole grew past the budget — a different
 * fact than one file being too large, and reported as its own error so the
 * handler in app.ts can say so.
 */
export class UploadBudgetExceededError extends Error {
  readonly status = 413;
  constructor() {
    super("Upload budget exceeded.");
  }
}

/**
 * Uploads land on disk, not in process memory.
 *
 * The memory engine held every file of every concurrent request in RAM, which
 * made the upload form a denial-of-service tool: a handful of full requests
 * was gigabytes. Bytes now stream to a temp file as they are parsed, and the
 * routes load **one file at a time** when they need its content — peak memory
 * is one file (plus its HEIC decode), not a request, not a fleet of requests.
 *
 * Three bounds while parsing:
 *
 * A **counted total per request**: every byte is metered as it streams and
 * the request aborts the moment the running total passes the budget. Counting
 * during parsing is the load-bearing part — a chunked request declares no
 * Content-Length, so a declared-size check alone is a gate an attacker
 * simply walks around.
 *
 * A **declared-size early refusal**: when Content-Length *is* present and
 * already over budget, the request is refused before any byte is read.
 *
 * A **concurrency ceiling**: only a few multipart requests parse at once —
 * now a disk bound rather than a memory one. Per process; replicas each
 * carry their own, and the deployment must size disk accordingly.
 *
 * Cleanup is owned by `uploadGate`: whenever the response finishes or the
 * connection dies, every temp file the request left is removed. Multer also
 * removes already-stored files when a request fails mid-parse; the two
 * overlap on purpose — a leftover customer photograph in a temp directory is
 * the failure mode neither is allowed to have alone.
 */
export const MAX_REQUEST_BYTES = 200 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;
// The richest current form sends five bounded metadata fields per file plus
// the channel id. Keep this tied to the advertised file limit.
export const MAX_UPLOAD_FIELDS = MAX_UPLOAD_FILES * 5 + 1;
const MAX_CONCURRENT_UPLOADS = 4;

const UPLOAD_DIR = path.resolve(process.cwd(), ".cache/uploads");

/** Bytes parsed so far, per request — all of a request's files share one budget. */
const parsedBytes = new WeakMap<Request, number>();

export const boundedDiskStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    void (async () => {
      await mkdir(UPLOAD_DIR, { recursive: true });
      const destination = path.join(UPLOAD_DIR, randomUUID());
      const sink = createWriteStream(destination, { flags: "wx" });
      let size = 0;
      let failed = false;

      const abort = (error: unknown) => {
        if (failed) return;
        failed = true;
        sink.destroy();
        void unlink(destination).catch(() => {});
        cb(error as Error);
      };

      file.stream.on("data", (chunk: Buffer) => {
        if (failed) return;
        const total = (parsedBytes.get(req) ?? 0) + chunk.length;
        parsedBytes.set(req, total);
        if (total > MAX_REQUEST_BYTES) return abort(new UploadBudgetExceededError());
        size += chunk.length;
        if (!sink.write(chunk)) {
          file.stream.pause();
          sink.once("drain", () => file.stream.resume());
        }
      });
      file.stream.on("error", abort);
      sink.on("error", abort);
      file.stream.on("end", () => {
        if (failed) return;
        sink.end(() => {
          if (!failed) cb(null, { path: destination, size });
        });
      });
    })().catch((err) => cb(err as Error));
  },

  _removeFile(_req, file, cb) {
    void unlink(file.path).then(
      () => cb(null),
      () => cb(null)
    );
  },
};

export const upload = multer({
  storage: boundedDiskStorage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: MAX_UPLOAD_FILES,
    fields: MAX_UPLOAD_FIELDS,
  },
});

/**
 * The file's bytes, loaded when the route actually needs them. Call per file,
 * let the buffer go out of scope before the next — that sequencing is what
 * keeps peak memory at one file.
 */
export function readUpload(file: Express.Multer.File): Promise<Buffer> {
  if (file.buffer) return Promise.resolve(file.buffer);
  return readFile(file.path);
}

let activeUploads = 0;

export function uploadGate(req: Request, res: Response, next: NextFunction) {
  const declared = Number(req.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return res
      .status(413)
      .json({ error: "That upload is too large — send fewer files at once (200 MB per request)." });
  }

  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    return res
      .status(429)
      .json({ error: "The server is busy saving other uploads. Try again in a moment." });
  }

  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads -= 1;

    // Customer photographs must not outlive the request that carried them.
    const carried = [
      ...(req.file ? [req.file] : []),
      ...(Array.isArray(req.files) ? req.files : []),
    ];
    for (const file of carried) {
      if (file.path) void unlink(file.path).catch(() => {});
    }
  };
  res.on("finish", release);
  res.on("close", release);
  next();
}
