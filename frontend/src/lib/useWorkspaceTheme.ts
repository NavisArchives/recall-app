import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  cacheWorkspaceTheme,
  cachedWorkspaceTheme,
  cachedWorkspaceThemeOrNull,
  isWorkspaceTheme,
  workspaceThemeAttr,
  type WorkspaceTheme,
} from "./workspaceTheme";

/**
 * Which colour this workspace paints in (058).
 *
 * The person's own row is the record; the cache decides the FIRST paint only,
 * so a reload does not flash dark before the session answers. Once the
 * profile arrives, it wins and the cache is brought into line — including
 * when another device changed it, which is the case the cache would
 * otherwise get wrong forever.
 *
 * Returns the props a workspace shell spreads onto its root element. For
 * dark that is an empty object: no attribute, no override, the original
 * cascade (see workspaceTheme.ts).
 */
export function useWorkspaceTheme(): {
  theme: WorkspaceTheme;
  attrs: { "data-ws-theme"?: WorkspaceTheme };
} {
  const { profile } = useAuth();
  const [theme, setTheme] = useState<WorkspaceTheme>(cachedWorkspaceTheme);

  const fromProfile = profile?.workspace_theme;

  useEffect(() => {
    if (!isWorkspaceTheme(fromProfile)) return;
    setTheme(fromProfile);
    cacheWorkspaceTheme(fromProfile);
  }, [fromProfile]);

  return { theme, attrs: workspaceThemeAttr(theme) };
}

/**
 * The colour for a door — the screens that come before a profile is unlocked
 * (owner, 17 Sep 2026: "should also respect the colour theme, every page").
 *
 * Same rule as the workspace with one difference at the very start. A browser
 * that has never been told a colour opens PAPER, not dark: paper is exactly
 * the light door drawn this morning — the same #f7f3eb ground and the same
 * vermillion — so a family arriving for the first time still meets it. A
 * browser that HAS been told gets what it was told, including dark.
 *
 * This is why the doors no longer carry their own `.door` palette: paper is
 * that palette, expressed once, in the place every other surface reads.
 */
export function useDoorTheme(): {
  theme: WorkspaceTheme;
  attrs: { "data-ws-theme"?: WorkspaceTheme };
} {
  const { profile } = useAuth();
  const [theme, setTheme] = useState<WorkspaceTheme>(() => cachedWorkspaceThemeOrNull() ?? "paper");

  const fromProfile = profile?.workspace_theme;

  useEffect(() => {
    if (!isWorkspaceTheme(fromProfile)) return;
    setTheme(fromProfile);
    cacheWorkspaceTheme(fromProfile);
  }, [fromProfile]);

  return { theme, attrs: workspaceThemeAttr(theme) };
}
