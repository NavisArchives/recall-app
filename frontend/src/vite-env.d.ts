/// <reference types="vite/client" />

/*
 * The only build-time variable the browser bundle reads. There is no
 * VITE_SUPABASE_* here on purpose: the browser never talks to Supabase, and
 * a typed key is an invitation to start (eslint.config.js forbids the import).
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The build this bundle is, from package.json — reported on check-in (041). */
declare const __APP_VERSION__: string;
