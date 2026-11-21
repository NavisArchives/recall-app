import { useCallback, useState, type CSSProperties } from "react";
import { THEME_SWATCH, type WorkspaceTheme } from "@/lib/workspaceTheme";

/**
 * The platform console's own colour (owner, 21 Sep 2026: "currently it has
 * the green theme. I want to be able to have my own theme picked").
 *
 * WHY IT WAS GREEN. The console used to call `useWorkspaceTheme()`, which
 * reads the colour off the signed-in *profile* — and falls back to whatever
 * this browser last cached for a family workspace. The platform owner has no
 * profile: his row is not a household and has no `people` entry to carry a
 * choice (M55). So the console wore whichever family workspace this laptop
 * had last painted, which happened to be green. Not a choice; a leftover.
 *
 * WHERE THE CHOICE LIVES. There is no server row to keep it on, so it is
 * kept on the device, in localStorage — and unlike the workspace's cache,
 * here that IS the record. Said plainly because it has a consequence: the
 * colour is per machine. Pick Ink on the laptop and the phone still opens
 * in the default until it is told too.
 *
 * THE DEFAULT IS THE DOOR'S. `ink` is the palette of the sign-in card the
 * owner asked for and liked — near-black ground, vermillion, two slow lights
 * and the workspace's graph paper — so the console opens as the same room
 * the door led into. `dark` is the family workspace's original amber dark,
 * and the three light palettes are the ones Settings offers a family.
 *
 * HOW INK IS PAINTED. The four workspace palettes are expressed by the
 * `data-ws-theme` attribute and styles/workspace-themes.css. Ink is not
 * added there: that file is shared with the family workspace and belongs to
 * the light-mode work; the console can repaint itself without touching it
 * by declaring the same tokens inline on its own root. A custom property
 * resolves where it is declared, so everything beneath — the payment cell,
 * the print sheet, the queue buttons — follows without being told.
 */

export const OWNER_THEMES = ["ink", "dark", "paper", "blue", "green"] as const;
export type OwnerTheme = (typeof OWNER_THEMES)[number];

const KEY = "recall_owner_theme";
export const DEFAULT_OWNER_THEME: OwnerTheme = "ink";

export function isOwnerTheme(value: unknown): value is OwnerTheme {
  return typeof value === "string" && (OWNER_THEMES as readonly string[]).includes(value);
}

function stored(): OwnerTheme {
  try {
    const value = localStorage.getItem(KEY);
    return isOwnerTheme(value) ? value : DEFAULT_OWNER_THEME;
  } catch {
    return DEFAULT_OWNER_THEME;
  }
}

/** The console's colour on this device, and the way to change it. */
export function useOwnerTheme(): [OwnerTheme, (next: OwnerTheme) => void] {
  const [theme, setTheme] = useState<OwnerTheme>(stored);
  const choose = useCallback((next: OwnerTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode or a full store: the choice lasts for this visit */
    }
  }, []);
  return [theme, choose];
}

/** The two-tone swatch each option shows: the ground it paints, and its accent. */
export const OWNER_SWATCH: Record<OwnerTheme, { ground: string; accent: string; label: string }> = {
  ink: { ground: "#0d0c0b", accent: "#c13b22", label: "Ink" },
  dark: THEME_SWATCH.dark,
  paper: THEME_SWATCH.paper,
  blue: THEME_SWATCH.blue,
  green: THEME_SWATCH.green,
};

export function ownerThemeIsLight(theme: OwnerTheme): boolean {
  return theme === "paper" || theme === "blue" || theme === "green";
}

/**
 * What to spread onto the console's root: the workspace attribute for the
 * three light palettes (so workspace-themes.css does its work), nothing for
 * the two dark ones.
 */
export function ownerThemeAttrs(theme: OwnerTheme): { "data-ws-theme"?: WorkspaceTheme } {
  return ownerThemeIsLight(theme) ? { "data-ws-theme": theme as WorkspaceTheme } : {};
}

/*
  The console's own surface tokens, on top of the workspace's.

  `--owner-card` is the glass a section sits in, `--owner-line` its edge,
  `--owner-thead` the one opaque surface (a sticky table header cannot be
  glass — what scrolls under it would show through). The two glows and the
  grid are the door's, at a strength that reads as light rather than as a
  picture when there is a whole console on top of them.
*/
const DARK_TEXT: CSSProperties = {
  /*
    The device may be in the per-device light mode (index.css's
    `:root[data-theme="light"]`), which flips the ink channels and the text
    colour at the root. The two dark consoles restate the dark set here so
    they are dark on every device, the way the front door forces its own
    ground. Values are index.css's own.
  */
  ["--ink" as string]: "255, 255, 255",
  ["--ink-cream" as string]: "242, 241, 238",
  ["--fg" as string]: "#ffffff",
  ["--fg-muted" as string]: "rgba(255,255,255,.66)",
  ["--fg-faint" as string]: "rgba(255,255,255,.5)",
  ["--fg-hint" as string]: "rgba(242,241,238,.58)",
  ["--fg-quiet" as string]: "rgba(242,241,238,.55)",
  ["--fg-soft" as string]: "rgba(242,241,238,.66)",
  ["--fg-dim" as string]: "rgba(242,241,238,.5)",
  ["--line" as string]: "rgba(255,255,255,.22)",
  ["--line-soft" as string]: "rgba(255,255,255,.12)",
  ["--cream" as string]: "#f2f1ee",
  ["--on-cream" as string]: "#141311",
  ["--chip-on" as string]: "#f2f1ee",
  ["--on-chip-on" as string]: "#141311",
  color: "#f2f1ee",
};

export function ownerThemeStyle(theme: OwnerTheme): CSSProperties {
  switch (theme) {
    case "ink":
      return {
        ...DARK_TEXT,
        ["--ground" as string]: "#0d0c0b",
        ["--accent" as string]: "#c13b22",
        ["--accent-soft" as string]: "#e8735c",
        ["--accent-tint" as string]: "rgba(193,59,34,.18)",
        ["--accent-channels" as string]: "193, 59, 34",
        ["--accent-on-tint" as string]: "#e8735c",
        ["--panel-menu" as string]: "#151312",
        ["--panel-dialog" as string]: "#151312",
        ["--panel-field" as string]: "#141212",
        ["--owner-card" as string]: "rgba(255,255,255,.055)",
        ["--owner-card-strong" as string]: "rgba(255,255,255,.085)",
        ["--owner-line" as string]: "rgba(255,255,255,.11)",
        ["--owner-thead" as string]: "#151312",
        ["--owner-glow-a" as string]: "rgba(193,59,34,.34)",
        ["--owner-glow-b" as string]: "rgba(226,154,104,.22)",
        ["--owner-grid" as string]: "rgba(242,241,238,.05)",
        ["--owner-vignette" as string]: "rgba(0,0,0,.55)",
        background: "#0d0c0b",
      };
    case "dark":
      return {
        ...DARK_TEXT,
        ["--owner-card" as string]: "rgba(255,255,255,.045)",
        ["--owner-card-strong" as string]: "rgba(255,255,255,.075)",
        ["--owner-line" as string]: "rgba(255,255,255,.10)",
        ["--owner-thead" as string]: "#161311",
        ["--owner-glow-a" as string]: "rgba(200,121,65,.20)",
        ["--owner-glow-b" as string]: "rgba(200,121,65,.10)",
        ["--owner-grid" as string]: "rgba(242,241,238,.04)",
        ["--owner-vignette" as string]: "rgba(0,0,0,.45)",
        background: "var(--ground)",
      };
    default:
      /* The light three: workspace-themes.css sets the ground, ink and
         accent; the console adds only its own surfaces and a faint light. */
      return {
        ["--owner-card" as string]: "#ffffff",
        ["--owner-card-strong" as string]: "#fbfaf7",
        ["--owner-line" as string]: "rgba(20,19,15,.10)",
        ["--owner-thead" as string]: "#ffffff",
        ["--owner-glow-a" as string]: "rgba(var(--accent-channels),.14)",
        ["--owner-glow-b" as string]: "rgba(var(--accent-channels),.08)",
        ["--owner-grid" as string]: "rgba(20,19,15,.055)",
        ["--owner-vignette" as string]: "transparent",
        background: "var(--ground)",
      };
  }
}
