import { useCallback, useSyncExternalStore } from "react";

/**
 * The public pages' three languages: French, Dutch and English (owner,
 * 17 Sep 2026).
 *
 * Deliberately NOT an i18n framework: each public page keeps its own copy
 * table next to its own layout, so the words and the thing they sit in are
 * read together. A keyed catalogue with interpolation would be machinery for
 * a surface this size — the workspace is the one that will eventually need
 * it, and that is a separate piece of work.
 *
 * The choice is per-browser and remembered. An unset browser is guessed at
 * once, from its own language, and only for the two languages Belgium
 * actually speaks; everyone else opens in English.
 */
export const LANGS = ["fr", "nl", "en"] as const;
export type Lang = (typeof LANGS)[number];

const KEY = "recall-lang";
const listeners = new Set<() => void>();

function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

function read(): Lang {
  try {
    const stored = localStorage.getItem(KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* storage can be unavailable; the default below covers it */
  }
  const browser = navigator.language?.toLowerCase() ?? "";
  if (browser.startsWith("nl")) return "nl";
  if (browser.startsWith("fr")) return "fr";
  return "en";
}

/**
 * Tell the DOCUMENT which language it is in.
 *
 * index.html ships `<html lang="en">` and nothing ever changed it, so a
 * screen reader read the French and Dutch copy aloud in an English voice —
 * the one promise this control exists to keep, unkept. It is set here rather
 * than in the switch because the language can also come from storage or the
 * browser on first paint, with no switch involved.
 */
function applyLang(next: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("lang", next);
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* nothing to do — the subscribers still re-render with the new value */
  }
  applyLang(next);
  listeners.forEach((fn) => fn());
}

export function useLang(): [Lang, (next: Lang) => void] {
  const lang = useSyncExternalStore(
    useCallback((onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    }, []),
    read,
    () => "en" as Lang
  );
  return [lang, setLang];
}

/** The FR·NL·EN switch every public page wears in its nav. */
export function langLabel(l: Lang): string {
  return l.toUpperCase();
}

/** The next language in the ring, for a switch that is one control. */
export function nextLang(l: Lang): Lang {
  return LANGS[(LANGS.indexOf(l) + 1) % LANGS.length];
}

/* The first paint is a language too: whatever storage or the browser decided,
   the document says so before anybody presses anything. */
applyLang(read());
