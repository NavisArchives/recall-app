import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSuggestions } from "@/hooks/useAdminData";

/**
 * The header's bell, and the dot only when there is something behind it.
 *
 * The frame draws the dot lit. Painting it on unconditionally would be a
 * decoration claiming to be a state — the same fault as a hardcoded "1h 24"
 * — so it follows what the archive is actually asking for: the open
 * observations the rest of the product calls Needs Attention. Nothing
 * waiting, no dot.
 *
 * Pressing it goes to Missions, which is where those observations become
 * something a person can do. A control that opens nothing would be worse
 * than no control.
 */
export function HeaderBell() {
  const navigate = useNavigate();
  const { data: suggestions, isPending, isError } = useSuggestions();

  /*
    The dot is fail-safe by omission — nothing renders when `waiting` is 0,
    so a failed load draws no false badge. The **label** was not (M205): it
    told a screen-reader user "Nothing needs attention" on a request that
    never answered, which is the same invented claim as any of the visible
    ones, made only to the people who cannot see that the bell is plain.
  */
  const unread = isPending || isError;
  const waiting = (suggestions?.groups ?? []).reduce((n, g) => n + g.count, 0);

  return (
    <button
      type="button"
      onClick={() => navigate("/admin/missions")}
      aria-label={
        unread
          ? "Open Missions"
          : waiting
            ? `${waiting} things need attention — open Missions`
            : "Nothing needs attention"
      }
      className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full"
      style={{ border: "1px solid rgba(var(--ink),.13)" }}
    >
      <Bell size={15} strokeWidth={1.7} style={{ color: "rgba(var(--ink-cream),.75)" }} aria-hidden />
      {waiting > 0 && (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            top: 9,
            right: 10,
            width: 7,
            height: 7,
            background: "var(--accent-soft)",
            // The ring is the ground colour, so the dot reads as sitting on
            // the header rather than as a hole punched in the bell.
            border: "2px solid var(--ground)",
          }}
        />
      )}
    </button>
  );
}
