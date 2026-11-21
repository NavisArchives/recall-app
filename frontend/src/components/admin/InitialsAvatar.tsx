/**
 * A filled circle of initials when there is no photograph — a person, not a
 * placeholder asking for one.
 */
export function InitialsAvatar({
  name,
  size,
  ring = false,
}: {
  name: string;
  size: number;
  /**
   * The admin's mark: 4px of accent at low alpha (M53). Thicker than the old
   * full-strength ring and much quieter — present when you look for it,
   * silent when you do not. Uses the token so it follows the theme rather
   * than pinning an orange of its own.
   */
  ring?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter((part) => part && part.toLowerCase() !== "de")
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size / 2.8,
        ...(ring ? { boxShadow: "0 0 0 4px var(--accent-tint)" } : {}),
      }}
      className="flex flex-none items-center justify-center rounded-full bg-[rgba(var(--ink),0.1)] font-medium"
    >
      {initials || "?"}
    </span>
  );
}
