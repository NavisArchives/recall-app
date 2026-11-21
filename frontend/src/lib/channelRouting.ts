// Maps a 2-digit channel number to its route. A few numbers are reserved for
// special display pages. 99 opens the profile chooser rather than the
// management UI directly, so a scan or a stray keypress can never land on
// admin without a PIN.
export function resolveChannelPath(rawNumber: string): string | null {
  if (!/^\d{1,2}$/.test(rawNumber)) return null;

  const number = rawNumber.padStart(2, "0");

  switch (number) {
    // 99 always asks who is at the keyboard, whatever the current session.
    case "99":
      return "/profiles";
    case "00":
      return "/overview";
    case "98":
      return "/";
    case "10":
      return "/social";
    default:
      return `/channel/${number}`;
  }
}
