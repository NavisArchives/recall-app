import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../app.js";
import { env, resolveTrustProxyHops } from "../config/env.js";

/**
 * The edges of the product: what the API tells a browser about embedding,
 * how many proxies it believes stand in front of it, what leaves the laptop
 * on a deploy, and what the website lets a page load (29 Sep 2026 review,
 * findings 10, 15, 17, 18, 25 and 26).
 *
 * Several of these are files rather than code — the Dockerfile, the ignore
 * lists, _headers — and a file nobody runs in a test is a file that drifts.
 * So they are read and held to what they claim here.
 */

const repo = (path: string) => new URL(`../../../${path}`, import.meta.url).pathname;
const read = (path: string) => readFileSync(repo(path), "utf8");

describe("the proxy hop count (finding 15)", () => {
  const api = { isProduction: true, role: "api" as const };

  it("refuses to start a production api that does not say", () => {
    for (const raw of [undefined, "", "  "]) {
      expect(() => resolveTrustProxyHops(raw, api), String(raw)).toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it("accepts an explicit number in production, 0 included", () => {
    expect(resolveTrustProxyHops("1", api)).toBe(1);
    expect(resolveTrustProxyHops("0", api)).toBe(0);
    expect(resolveTrustProxyHops(" 2 ", api)).toBe(2);
  });

  /*
    NaN is what the old `Number(process.env.TRUST_PROXY_HOPS ?? 0)` produced
    from a typo, and Express reads it as "trust nothing" — the silent 0 by
    another road. It refuses everywhere, not only in production.
  */
  it("refuses a value that is not a whole number, anywhere", () => {
    for (const raw of ["one", "-1", "1.5", "true", "1,"]) {
      expect(() => resolveTrustProxyHops(raw, api), raw).toThrow(/whole number/);
      expect(() => resolveTrustProxyHops(raw, { isProduction: false, role: "api" }), raw).toThrow(/whole number/);
    }
  });

  it("keeps the old default of 0 on a laptop and on a kiosk", () => {
    expect(resolveTrustProxyHops(undefined, { isProduction: false, role: "api" })).toBe(0);
    // A kiosk is one machine in one home with nothing in front of it; a
    // restart there must never be refused over a proxy that does not exist.
    expect(resolveTrustProxyHops(undefined, { isProduction: true, role: "kiosk" })).toBe(0);
  });

  it("is what the app actually trusts", () => {
    expect(createApp().get("trust proxy")).toBe(env.trustProxyHops);
  });

  it("travels with the production image", () => {
    const dockerfile = read("backend/Dockerfile");
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
    expect(runtimeStage).toMatch(/^ENV TRUST_PROXY_HOPS=1$/m);
  });
});

describe("embedding the API's responses (finding 26)", () => {
  /*
    recall.family and api.example.com are one site, and so are two ports on
    localhost, so 'same-site' admits every real embedder. 'cross-origin'
    admitted anybody's page.
  */
  it("sends Cross-Origin-Resource-Policy: same-site", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
  });
});

/**
 * What a source deploy uploads (finding 17).
 *
 * The ignore files are allowlists now. Each is checked against the
 * Dockerfile's own COPY lines, so the two cannot drift apart silently in
 * either direction: a COPY with no allow line, or an allow line with no COPY.
 */
describe("the deploy upload is an allowlist", () => {
  const dockerfile = read("backend/Dockerfile");
  const copied = [...dockerfile.matchAll(/^COPY (?!--from)(.+)$/gm)]
    .flatMap((m) => m[1].trim().split(/\s+/).slice(0, -1))
    .map((p) => p.replace(/\/$/, ""));

  it("reads the Dockerfile's COPY sources", () => {
    // Guards the guard: an empty list would make every check below vacuous.
    expect(copied).toEqual(
      expect.arrayContaining(["package.json", "package-lock.json", "tsconfig.json", "src", "build"])
    );
  });

  it(".gcloudignore excludes everything, then lets in exactly what is copied", () => {
    const lines = read("backend/.gcloudignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(lines[0]).toBe("/*");
    for (const path of copied) {
      expect(lines.some((l) => l === `!/${path}` || l === `!/${path}/`), path).toBe(true);
    }
    expect(lines).toContain("/src/__tests__/");
    // The fixture credential and the environment are never let back in.
    expect(lines.filter((l) => l.startsWith("!")).join(" ")).not.toMatch(/scratch|\.env|scripts|node_modules/);
  });

  it(".dockerignore says the same thing", () => {
    const lines = read("backend/.dockerignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(lines[0]).toBe("*");
    for (const path of copied) expect(lines, path).toContain(`!${path}`);
    expect(lines).toContain("src/__tests__");
    expect(lines.filter((l) => l.startsWith("!")).join(" ")).not.toMatch(/scratch|\.env|scripts|node_modules/);
  });
});

describe("what the website lets a page load (finding 10)", () => {
  const headers = read("frontend/public/_headers");
  const csp = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1] ?? "";
  const directive = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .find(([n]) => n === name)
      ?.slice(1) ?? null;

  it("is a real policy, not frame-ancestors alone", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("script-src")).toEqual(["'self'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'none'"]);
    expect(directive("form-action")).toEqual(["'self'"]);
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
  });

  it("talks to the API and nowhere else", () => {
    expect(directive("connect-src")).toEqual(["'self'", "https://REPLACE_ME_API_ORIGIN"]);
    for (const name of ["img-src", "media-src"]) {
      const sources = directive(name) ?? [];
      expect(sources, name).toContain("https://REPLACE_ME_API_ORIGIN");
      expect(sources.filter((s) => /^https?:/.test(s)), name).toEqual(["https://REPLACE_ME_API_ORIGIN"]);
    }
  });

  it("never allows script from a string", () => {
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  });

  it("isolates the window from anything it opens", () => {
    expect(headers).toMatch(/^\s+Cross-Origin-Opener-Policy: same-origin$/m);
  });

  it("ships no inline script for the policy to refuse", () => {
    const html = read("frontend/index.html").replace(/<!--[\s\S]*?-->/g, "");
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const attrs of scripts) expect(attrs).toMatch(/\bsrc=/);
  });
});

describe("the browser has no way to reach Supabase (finding 18)", () => {
  const pkg = JSON.parse(read("frontend/package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };

  it("does not install a Supabase client or a socket client", () => {
    const names = Object.keys(all);
    expect(names.filter((n) => n.startsWith("@supabase/"))).toEqual([]);
    expect(names).not.toContain("socket.io-client");
  });

  it("types no Supabase key", () => {
    expect(read("frontend/src/vite-env.d.ts")).not.toMatch(/readonly VITE_SUPABASE/);
  });

  it("refuses the import in lint", () => {
    const config = read("frontend/eslint.config.js");
    expect(config).toMatch(/"no-restricted-imports"/);
    expect(config).toContain('"@supabase/*"');
    expect(config).toContain('"socket.io-client"');
  });
});

describe("the backend image carries no type packages (finding 25)", () => {
  it("keeps @types/* in devDependencies", () => {
    const pkg = JSON.parse(read("backend/package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((n) => n.startsWith("@types/"))).toEqual([]);
  });
});
