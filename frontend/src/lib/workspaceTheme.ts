/**
 * The workspace's colour, per person (058, owner 17 Sep 2026).
 *
 * Four values. `dark` is the original and the default, and it is expressed as
 * the ABSENCE of a `data-ws-theme` attribute — so a workspace nobody has
 * repainted renders through exactly the cascade it always did, and switching
 * back to dark cannot leave a trace behind. The three light palettes live in
 * styles/workspace-themes.css.
 *
 * Where it applies: the workspace shells only (AdminLayout, MobileShell, the
 * owner dashboard). Never <html>, never <body> — those are shared with
 * Margaret's display, which is dark unconditionally.
 *
 * Where it lives: on the person's own row, so it follows them from laptop to
 * phone and one admin's choice never repaints a colleague's workspace. The
 * localStorage copy below is a CACHE, not the record: it exists only so the
 * first paint after a reload is the colour they chose rather than a flash of
 * dark while the profile loads.
 */

export const WORKSPACE_THEMES = ["dark", "paper", "blue", "green"] as const;
export type WorkspaceTheme = (typeof WORKSPACE_THEMES)[number];

const CACHE_KEY = "recall_ws_theme";

export function isWorkspaceTheme(value: unknown): value is WorkspaceTheme {
  return typeof value === "string" && (WORKSPACE_THEMES as readonly string[]).includes(value);
}

/**
 * The cached colour, or null when this browser has never been told one.
 *
 * The difference matters on the doors that come BEFORE a profile is unlocked.
 * "Nothing stored" and "dark was chosen" are two different answers there:
 * the first should open the light door the owner drew, the second should
 * honour the choice. `cachedWorkspaceTheme` cannot tell them apart because it
 * folds both into "dark".
 */
export function cachedWorkspaceThemeOrNull(): WorkspaceTheme | null {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return isWorkspaceTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** The cached colour for the first paint, or dark when there is nothing to go on. */
export function cachedWorkspaceTheme(): WorkspaceTheme {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return isWorkspaceTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

/** Remember the colour for the next first paint. Never the source of truth. */
export function cacheWorkspaceTheme(theme: WorkspaceTheme): void {
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    /* private mode, full storage: the profile still carries the real answer */
  }
}

/**
 * What to spread onto a workspace shell's root element.
 *
 * Dark returns nothing at all, which is the point: no attribute, no override,
 * the original cascade.
 */
export function workspaceThemeAttr(theme: WorkspaceTheme): { "data-ws-theme"?: WorkspaceTheme } {
  return theme === "dark" ? {} : { "data-ws-theme": theme };
}

/** The two-tone swatch each option shows in Settings: the ground and its accent. */
export const THEME_SWATCH: Record<WorkspaceTheme, { ground: string; accent: string; label: string }> = {
  dark: { ground: "#0b0b0c", accent: "#c87941", label: "Dark" },
  paper: { ground: "#f7f3eb", accent: "#c13b22", label: "Paper" },
  blue: { ground: "#ecf1f7", accent: "#2e5fc0", label: "Blue" },
  green: { ground: "#edf2ec", accent: "#3d7a54", label: "Green" },
};
