import { useNavigate } from "react-router-dom";
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
 * The phone's profile control — a chip, not a dropdown.
 *
 * Pressing it goes to the profile chooser (`/profiles`), the way Netflix opens
 * a full page of faces rather than a little menu. A menu that drops from the
 * top-right of a phone is a menu a thumb cannot reach; the full-screen chooser
 * is already built, already touch-sized, and already the one place a PIN is
 * asked. There is no "back to her screen" here either — that belongs to the
 * household display, not to a family member on their own phone.
 */
export function MobileProfileChip() {
  const navigate = useNavigate();
  const { profile, hasDevice } = useAuth();

  /*
   * The photograph is a nicety, and it is fetched like one.
   *
   * `/auth/profiles` needs a trusted device; somebody signed in from their own
   * phone has a family session and no device, so this 401s for exactly the
   * people this component is for. It stays because a paired tablet does have
   * one — but nothing here waits on it, and the chip draws a name and an
   * initial without it. A control that renders as a blank circle whenever the
   * optional half is unavailable is a broken-looking control.
   */
  const { data: profiles } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<ProfileRow[]>("/auth/profiles"),
    enabled: hasDevice,
    retry: false,
  });

  if (!profile) return null;
  const me = profiles?.find((p) => p.id === profile.id);
  const initial = (profile.name || "?").charAt(0).toUpperCase();

  return (
    // First name only, sans, and a face that fills its pill — the compact
    // weight of a shipped product's account chip. The touch target stays
    // 44px through padding; the visible pill is smaller than it feels.
    <button
      type="button"
      onClick={() => navigate("/profiles")}
      aria-label="Switch profile"
      className="-mr-1.5 flex min-h-[44px] items-center gap-2 rounded-full py-1 pl-3 pr-1"
      style={{ border: "1px solid rgba(var(--ink),.14)" }}
    >
      <span className="max-w-[110px] truncate text-[13px] font-medium">
        {(profile.name || "Signed in").split(/\s+/)[0]}
      </span>
      {me?.photo_url ? (
        <img src={me.photo_url} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
      ) : (
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[rgba(var(--ink),0.1)] text-[12px] font-medium"
          style={{ boxShadow: "0 0 0 1px rgba(var(--ink),.1)" }}
        >
          {initial}
        </span>
      )}
      <span className="sr-only">{roleLabel(profile.role)}</span>
    </button>
  );
}
