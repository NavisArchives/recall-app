import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/labels";

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  requires_pin: boolean;
  photo_url: string | null;
}

/**
 * Top-right of every management page: who is signed in, and a way to the
 * chooser (M61).
 *
 * It used to open a dropdown. The owner's words: "it is not part of the app…
 * it feels like a different design, and the top corner is over the actual
 * border." Both true — the panel was anchored into the header's corner and
 * hung over its border, and with a seven-person family it had grown into a
 * tall mini-copy of the chooser rendered in an idiom this app uses nowhere
 * else. Recall has exactly one other dropdown: none.
 *
 * So the chip is a chip. Pressing it goes to `/profiles`, the full page of
 * faces that already exists, is already touch-sized, and is already the one
 * place in the app that asks for a code. The path it came from travels with
 * it so the chooser can offer a way back.
 *
 * M58 tried to make the dropdown open without moving. This deletes the
 * dropdown, which is the better answer to the same complaint and makes M58
 * moot.
 */
export function ProfileSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<ProfileRow[]>("/auth/profiles"),
    retry: false,
  });

  if (!profile) return null;
  const me = profiles?.find((p) => p.id === profile.id);
  const initial = (profile.name || "?").charAt(0).toUpperCase();

  /*
    The 20a header's chip is the face alone (M106).

    The design's right cluster is exactly three things — Settings, the bell,
    the avatar — so the name and role that used to ride alongside are gone
    from it. They are still one click away: the circle opens the chooser,
    which is where a person's own identity belongs. The display's header
    keeps the fuller chip, which is why this is a prop and not a rewrite.
  */
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => navigate("/profiles", { state: { from: location.pathname } })}
        aria-label={`${profile.name} — switch profile`}
        className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full text-[14px] font-medium"
        style={{
          background: "rgba(var(--accent-channels),.2)",
          border: "1px solid rgba(var(--ink),.13)",
          color: "var(--cream)",
        }}
      >
        {me?.photo_url ? (
          <img src={me.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate("/profiles", { state: { from: location.pathname } })}
      className="pressable flex items-center gap-2.5 rounded-[10px] px-2.5 py-2"
    >
      <span className="min-w-0 flex-1 text-left">
        <span className="block max-w-[160px] truncate text-sm font-medium">{profile.name}</span>
        <span
          className="block font-mono text-[9px] tracking-[0.14em]"
          style={{ color: "var(--fg-faint)" }}
        >
          {/* The signed-in profile always carries a role — `Role` is required
              on ActiveProfile — so this is the one call site with nothing to
              decide. The `?? ""` is here to keep it that way if it changes. */}
          {(roleLabel(profile.role) ?? "").toUpperCase()}
        </span>
      </span>

      {me?.photo_url ? (
        <img src={me.photo_url} alt="" className="h-8 w-8 flex-none rounded-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[rgba(var(--ink),0.1)] text-[13px] font-medium"
        >
          {initial}
        </span>
      )}
    </button>
  );
}
