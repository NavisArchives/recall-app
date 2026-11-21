import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";

/*
  The display reports which build it is running (041), and this is where the
  build learns its own name. Taken from package.json at build time rather
  than typed anywhere: a version a human maintains in two places is a version
  that will eventually be wrong in one of them.
*/
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

export default defineConfig(({ command, mode }) => {
  /*
    A production build MUST be told where the API lives.

    `api.ts` falls back to http://localhost:4000 when VITE_BACKEND_URL is
    unset, which is right for a laptop and catastrophic for a deploy: the
    build succeeds, the site loads, and every visitor's browser asks *their
    own machine* for the API. It shipped exactly once, on 20 Aug 2026 — the
    live bundle pointed at localhost and the only symptom a family would see
    was an error telling them to run `npm run dev`.

    A silent default that is wrong in production is not a default, it is a
    trap. So the build fails loudly instead, here, where the person who can
    fix it is still watching. Dev keeps the fallback; nothing changes there.
  */
  if (command === "build") {
    const url = loadEnv(mode, process.cwd(), "VITE_").VITE_BACKEND_URL;
    if (!url) {
      throw new Error(
        "VITE_BACKEND_URL is not set. A production build without it would " +
          "point at http://localhost:4000. Build with:\n" +
          "  VITE_BACKEND_URL=https://REPLACE_ME_API_ORIGIN npm run build"
      );
    }
    if (url.includes("localhost") || url.includes("127.0.0.1")) {
      throw new Error(`VITE_BACKEND_URL is ${url} — that is a local address in a production build.`);
    }
  }

  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        output: {
        // Dependencies change on install, app code changes on deploy — split
        // so a deploy doesn't re-download React, and the kiosk's own eager
        // bundle stays small beside it.
          manualChunks(id) {
            if (id.includes("node_modules")) return "vendor";
          },
        },
      },
    },
  };
});
