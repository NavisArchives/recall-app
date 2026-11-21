/**
 * The number of the last channel Margaret opened.
 *
 * Home uses it to show that memory glowing behind the welcome, so the first
 * screen feels like somewhere she has been rather than an empty one.
 */
export const LAST_CHANNEL_KEY = "recall:last-channel";

export function rememberChannel(number: string | number): void {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, String(number).padStart(2, "0"));
  } catch {
    // Private browsing or a full disk; the glow is a nicety, not a feature.
  }
}
