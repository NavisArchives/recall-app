import "dotenv/config";

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const sessionSecret = required("SESSION_SECRET", process.env.SESSION_SECRET);

if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

/**
 * The key that makes an invitation or verification code unguessable *offline*.
 *
 * Lookup hashes have to be deterministic — the row is found by the code — so
 * they cannot be salted per row. Hashed with a bare SHA-256 and a public
 * prefix, a stolen `invitations` table could be matched against a precomputed
 * table of every possible code. With a server-side pepper the stolen table is
 * worth nothing without this value, which never leaves the environment.
 *
 * Required, like SESSION_SECRET: a default would be published in the source
 * and would therefore be no key at all.
 */
const codePepper = required("CODE_PEPPER", process.env.CODE_PEPPER);

if (codePepper.length < 32) {
  throw new Error("CODE_PEPPER must be at least 32 characters");
}

/**
 * What this process is.
 *
 * A `kiosk` is one machine in one family's home. It may hold that family's
 * photographs on its local disk, because that is how the screen keeps working
 * when the internet does not.
 *
 * An `api` serves every family. It must hold none of them speculatively — a
 * shared server that pre-downloads its customers' media is a mirror of the
 * whole product sitting on one disk. This is the default, and prefetch is off
 * unless a machine says, deliberately, that it is a kiosk and whose it is.
 */
const role = process.env.RECALL_ROLE === "kiosk" ? "kiosk" : "api";

const isProduction = process.env.NODE_ENV === "production";

/**
 * How many proxies stand between the internet and this process (app.ts).
 *
 * 0 on a laptop, 1 behind Cloud Run's front end. The rate limiters key on
 * req.ip, and a production api that trusts no proxy sees every visitor as the
 * proxy's address: 300/min, the sign-in limit and the public forms' limit all
 * become one bucket shared by the whole product. The value used to live only
 * in the Cloud Run console, with a code default of 0 — so a revision deployed
 * without it started happily and wrong (29 Sep 2026 review, finding 15).
 *
 * So a production api must SAY how many hops, like SESSION_SECRET: the
 * Dockerfile sets 1, and an unset value refuses to start rather than quietly
 * meaning 0. An explicit "0" is accepted, because it can be right. A kiosk is
 * one machine in one home with nothing in front of it, and a laptop is a
 * laptop, so both keep the old default. A value that is not a whole number
 * refuses everywhere: `Number("one")` is NaN, which Express reads as "trust
 * nothing" — the same silent 0 by another road.
 */
export function resolveTrustProxyHops(
  raw: string | undefined,
  where: { isProduction: boolean; role: "api" | "kiosk" }
): number {
  const value = raw?.trim() ?? "";
  if (value === "") {
    if (where.isProduction && where.role === "api") {
      throw new Error(
        "TRUST_PROXY_HOPS must be set in production (1 behind Cloud Run). " +
          "Without it every visitor shares one rate-limit bucket."
      );
    }
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number of proxies (0, 1, …), not "${raw}".`);
  }
  return Number(value);
}

const trustProxyHops = resolveTrustProxyHops(process.env.TRUST_PROXY_HOPS, { isProduction, role });

export const env = {
  port: Number(process.env.PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  isProduction,
  trustProxyHops,

  role,
  // Which family this kiosk belongs to. Meaningless, and ignored, on an api.
  kioskArchiveId: role === "kiosk" ? (process.env.RECALL_KIOSK_ARCHIVE_ID ?? "") : "",

  supabaseUrl: required("SUPABASE_URL", process.env.SUPABASE_URL),
  supabaseServiceRoleKey: required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ),

  sessionSecret,
  codePepper,

  // Absolute base for media links. They are rendered by a browser served from
  // a different origin, so a relative path would resolve against the frontend.
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,

  // Optional: without these, email is skipped and PINs are shown on screen
  // only. A missing mail account must never stop the app from starting.
  emailUser: process.env.EMAIL_USER ?? "",
  emailPass: process.env.EMAIL_PASS ?? "",
  emailFrom: process.env.EMAIL_FROM ?? process.env.EMAIL_USER ?? "Recall",
};
