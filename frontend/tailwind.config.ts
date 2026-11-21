import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Roboto", "Helvetica", "Arial", "sans-serif"],
        mono: ['"Roboto Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        // Display palette
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-faint": "var(--fg-faint)",
        "accent-soft": "var(--accent-soft)",
        "accent-tint": "var(--accent-tint)",
        "remembered-fill": "var(--remembered-fill)",
        "remembered-line": "var(--remembered-line)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",

        // Tokens used by the shared UI primitives on the management screens.
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          soft: "var(--destructive-soft)",
          foreground: "var(--destructive-foreground)",
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
      },
      height: {
        header: "var(--header-h)",
      },
      minHeight: {
        content: "calc(100vh - var(--header-h))",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    /*
      A screen defined by height, not width (M131).

      The owner works on an 11-inch MacBook: 1366×768 as a panel, and once
      the browser's own chrome is taken out, roughly 680–700px of viewport.
      The Overview is a no-scroll board, so on that machine its cards had a
      height budget they could not cover and quietly ate their own last
      lines. `short:` is where a card says what it gives up when the screen
      is not tall — it changes nothing at 900px and above.

      A variant rather than a `screens` entry, deliberately: a raw media
      query in `screens` cannot be sorted against the width breakpoints, so
      Tailwind disables the `min-*`/`max-*` arbitrary variants for the whole
      project and warns on every build. Same selector, same behaviour, no
      cost to the rest of the system.
    */
    plugin(({ addVariant }) => addVariant("short", "@media (max-height: 820px)")),
  ],
} satisfies Config;
