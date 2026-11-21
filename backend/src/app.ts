import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";

import { env } from "./config/env.js";
import { UploadBudgetExceededError } from "./middleware/upload.js";
import { peopleRouter } from "./routes/people.js";
import { channelsRouter } from "./routes/channels.js";
import { mediaFilesRouter } from "./routes/mediaFiles.js";
import { authRouter } from "./routes/auth.js";
import { settingsRouter } from "./routes/settings.js";
import { mediaRouter } from "./routes/media.js";
import { nfcRouter } from "./routes/nfc.js";
import { missionsRouter } from "./routes/missions.js";
import { activityRouter } from "./routes/activity.js";
import { screenStateRouter } from "./routes/screenState.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { familyRouter } from "./routes/family.js";
import { ownerRouter } from "./routes/owner.js";
import { sessionsRouter } from "./routes/sessions.js";
import { insightsRouter } from "./routes/insights.js";
import { streamsRouter } from "./routes/streams.js";
import { searchRouter } from "./routes/search.js";
import { placesRouter, tagsRouter } from "./routes/vocabulary.js";

const uploadErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof UploadBudgetExceededError) {
    return res
      .status(413)
      .json({ error: "That upload is too large — send fewer files at once (200 MB per request)." });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "That file is too large (50 MB maximum)."
        : "Upload refused.";
    return res.status(413).json({ error: message });
  }

  if (err) {
    // Body-parser and friends set a status; honour it so a malformed request
    // reports 400 rather than being reported as our failure.
    const status = (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode;

    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).json({ error: "Invalid request." });
    }

    console.error("[error] Unhandled", err);
    return res.status(500).json({ error: "Something went wrong on our side." });
  }

  next();
};

export function createApp() {
  const app = express();

  /*
    How many proxies stand between the internet and this process — 0 on a
    laptop, 1 behind Cloud Run's front end. It matters for exactly one thing
    today: the rate limiter keys on req.ip, and behind a proxy with no trust
    declared every visitor wears the proxy's address, so 300/min stops being
    per-person and becomes one shared bucket for the whole product. A number
    rather than `true`, because `true` trusts whatever X-Forwarded-For any
    client cares to send — which would let a limiter-dodger mint fresh IPs.
    Read and checked in env.ts: a production api refuses to start without it.
  */
  app.set("trust proxy", env.trustProxyHops);

  /*
    same-site: the frontend embeds our media with plain <img>/<video> tags
    from another origin, which helmet's same-origin default forbids. But it
    is never another SITE: recall.family and api.example.com share a
    registrable domain, and localhost:5173 and localhost:4000 differ only by
    port, which CORP ignores. So 'same-site' lets every real embedder in and
    keeps a stranger's page from embedding a response at all — where
    'cross-origin' allowed anyone (29 Sep 2026 review, finding 26). CORS
    still decides who may *fetch* the API; this only affects embedding.
  */
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  // Credentials are required so the browser sends the httpOnly session cookie.
  app.use(cors({ origin: env.frontendOrigin, credentials: true }));

  /*
   * CSRF, the second lock.
   *
   * Every session cookie here is SameSite=Strict, which is the first lock —
   * but CORS is not CSRF protection, and one attribute should not be the only
   * thing between a forged form post and a write. Browsers attach an Origin
   * header to every cross-site state-changing request, so a state change
   * whose Origin names a stranger is refused outright. A request with no
   * Origin at all is not a browser's cross-site attempt (curl, the tests, a
   * native client) and passes through to the auth that every write already
   * requires.
   */
  const allowedOrigins = new Set(
    [env.frontendOrigin, env.publicUrl].map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    })
  );
  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (!origin || allowedOrigins.has(origin)) return next();
    return res.status(403).json({ error: "Cross-origin request refused." });
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/people", peopleRouter);
  app.use("/api/channels", channelsRouter);
  app.use("/api/media-files", mediaFilesRouter);
  app.use("/api/places", placesRouter);
  app.use("/api/tags", tagsRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/nfc-cards", nfcRouter);
  app.use("/api/missions", missionsRouter);
  app.use("/api/activity", activityRouter);
  app.use("/api/screen-state", screenStateRouter);
  app.use("/api/suggestions", suggestionsRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api/streams", streamsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/onboarding", onboardingRouter);
  app.use("/api/family", familyRouter);
  // The platform owner's surface, not a family's. Every refusal inside is
  // 404-shaped, so mounting it here reveals nothing to anyone else (M55).
  app.use("/api/owner", ownerRouter);

  app.use(uploadErrorHandler);

  // An unknown path answers the way every guarded route does: one generic
  // JSON sentence. Express's default HTML "Cannot GET /…" page named the
  // framework and made the API's only non-JSON response an unknown path.
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));

  return app;
}
