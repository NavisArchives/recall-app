import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/*
 * A small, load-bearing rule set.
 *
 * `tsc` already owns types, so lint here is for the things a type-checker
 * cannot see. The set is deliberately short: a gate that reports two hundred
 * stylistic opinions is a gate people learn to skip, and a skipped gate
 * catches nothing. Every rule below has either bitten this codebase or would
 * ship a visible defect to a family.
 *
 * The rules-of-hooks rule earns its place on its own — this app decides what
 * a person may see from `useAuth()`, and a conditionally-called hook there
 * fails as a wrong screen rather than as an error.
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        queueMicrotask: "readonly",
        FormData: "readonly",
        XMLHttpRequest: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        Image: "readonly",
        AbortController: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLImageElement: "readonly",
        HTMLFormElement: "readonly",
        HTMLSelectElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        PointerEvent: "readonly",
        TouchEvent: "readonly",
        Event: "readonly",
        EventSource: "readonly",
        MediaRecorder: "readonly",
        IntersectionObserver: "readonly",
        ResizeObserver: "readonly",
        performance: "readonly",
        __APP_VERSION__: "readonly",
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /*
       * Two tiers among the hooks rules, on purpose.
       *
       * `rules-of-hooks` stays an error: it catches a component whose hook
       * count changes between renders, which React refuses outright. It found
       * exactly that in the kiosk chooser the day this config landed — a
       * `useState` below an `isLoading` early return, i.e. the `99` screen
       * throwing instead of drawing once the profiles arrived.
       *
       * The React-Compiler-era rules below (set-state-in-effect, refs, purity,
       * memoization) are worth having and currently report ~34 findings spread
       * across pages several builders own. They are a real backlog, not a
       * false alarm — but each is a behavioural refactor, and a gate that
       * blocks every release on somebody else's in-flight page is a gate that
       * gets bypassed. They warn, so they stay visible and countable, and get
       * paid down per corridor rather than in one risky sweep.
       */
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/use-memo": "warn",
      // An unused import is usually a half-finished edit; an unused argument
      // often is not, so the underscore convention opts out.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is where the type system stops helping. Warn rather than error:
      // it is worth seeing, and not worth blocking a release over.
      "@typescript-eslint/no-explicit-any": "warn",
      // Both of these have shipped real bugs in JavaScript codebases: a
      // forgotten `await` that silently swallows a failed save, and `==`
      // against null.
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      /*
       * The browser never holds Supabase credentials and never calls Supabase
       * (CLAUDE.md, invariants): everything goes through the backend. The
       * dependency is gone from package.json, but a later `npm install` puts
       * it back in one line, so the import itself is refused here. The socket
       * client goes with it: nothing in the product changes the display
       * remotely, and a socket is how that would quietly start again.
       */
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*"],
              message:
                "The browser never talks to Supabase. Add a backend route and call it through lib/api.",
            },
            {
              group: ["socket.io-client", "socket.io-client/*"],
              message: "Nothing changes the display remotely; there is no socket server to talk to.",
            },
          ],
        },
      ],
    },
  }
);
