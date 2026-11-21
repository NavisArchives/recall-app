/** A member's state as a small colored pill: active, pending, or inactive. */
export function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  /*
    The access axis, in the admin's words (043 / frame 12h).

    `remembered` is a contributor who has died, and the owner chose the warm
    amber treatment for it. It deliberately does NOT reuse the grey of
    `deactivated`: greying somebody out says "switched off, probably by
    mistake, probably fixable". This state is a fact about a person, and it
    should read as the house holding them rather than as a setting.

    The stored value and the word shown differ on purpose — `pending` is
    "invited", `deactivated` is "paused" — because the database keeps its own
    vocabulary and the family reads theirs.
  */
  const styles: Record<string, { background: string; color: string; border?: string }> = {
    active: { background: "var(--live-fill)", color: "var(--on-live)" },
    pending: { background: "var(--accent-tint)", color: "var(--accent-soft)" },
    deactivated: { background: "rgba(var(--ink),.08)", color: "var(--fg-faint)" },
    /*
      Outlined, not filled — the whole of 12h. `invited` above is filled amber,
      and a filled amber `remembered` beside it would be the same pill twice.
      The border carries the colour; the word carries the meaning.
    */
    remembered: {
      background: "transparent",
      color: "var(--accent-soft)",
      border: "1px solid var(--remembered-line)",
    },
  };
  const label: Record<string, string> = {
    active: "active",
    pending: "invited",
    deactivated: "paused",
    remembered: "remembered",
  };
  return (
    <span
      className="inline-block rounded-full px-3 py-1 text-xs"
      // The 1px border would shift a remembered pill against its neighbours,
      // so every pill reserves the same ring whether it draws one or not.
      style={{ border: "1px solid transparent", ...(styles[status] ?? styles.pending) }}
    >
      {label[status] ?? status}
    </span>
  );
}
