import { Link } from "react-router-dom";
import {
  Activity,
  Archive,
  BarChart3,
  Monitor,
  Nfc,
  Settings,
  Trash2,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import {
  useActivity,
  useDeviceStream,
  useNfcCards,
  usePeople,
} from "@/hooks/useAdminData";
import { agoLabel } from "@/lib/labels";
import { moreDestinations } from "./MobileShell";

/**
 * The Overview's tile grid (owner, 21 Sep 2026).
 *
 * Everything that sits behind the More tab, laid out as tappable tiles two
 * across — the owner's own reference was the old Windows Phone start screen
 * and iOS: a grid of big, plain squares, one thing each, that you press
 * rather than read. They replace the three stacked sections the Overview
 * used to end on (the archive's readiness, "needs attention", recent
 * activity), which were lists to scan on a screen the family opens to DO
 * something.
 *
 * IT READS THE SAME LIST AS THE MORE SHEET (`moreDestinations`), so a
 * destination cannot be on one and missing from the other, and a co-author
 * simply gets fewer tiles. The icon and the one-line hint are the only
 * things drawn here; the label and the route come from the shared list.
 *
 * A hint is a fact where one is cheap — how many people, how many cards are
 * linked, whether her screen is online, when the family last touched the
 * archive — and a plain description where it is not. Every fact waits for
 * its own load (the M205 rule): a request that has not answered shows the
 * description, never a zero.
 */

const HINT: Record<string, string> = {
  "/admin/contributors": "Who helps",
  "/admin/cards": "The cards she scans",
  "/admin/insights": "How she watches",
  "/admin/my-info": "Your own details",
  "/admin/users": "Whose archive this is",
  "/admin/devices": "Her screen",
  "/admin/settings": "Theme, family, screen",
  "/admin/activity": "What the family did",
  "/admin/channels/deleted": "Bring things back",
};

const ICON: Record<string, LucideIcon> = {
  "/admin/contributors": UsersRound,
  "/admin/cards": Nfc,
  "/admin/insights": BarChart3,
  "/admin/my-info": UserRound,
  "/admin/users": Archive,
  "/admin/devices": Monitor,
  "/admin/settings": Settings,
  "/admin/activity": Activity,
  "/admin/channels/deleted": Trash2,
};

export function OverviewTiles() {
  const { isAdmin } = useAuth();
  const tiles = moreDestinations(isAdmin);

  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const { data: cards, isPending: cardsPending, isError: cardsFailed } = useNfcCards();
  const { data: device, isPending: devicePending, isError: deviceFailed } = useDeviceStream();
  const { data: activity, isPending: activityPending, isError: activityFailed } = useActivity(1);

  /* A live fact per tile, or nothing — the description stands in. */
  const fact = (to: string): string | null => {
    switch (to) {
      case "/admin/contributors": {
        if (peoplePending || peopleFailed) return null;
        const n = (people ?? []).filter((p) => p.role !== "user").length;
        return `${n} ${n === 1 ? "person" : "people"} helping`;
      }
      case "/admin/cards": {
        if (cardsPending || cardsFailed) return null;
        const all = cards ?? [];
        const linked = all.filter((c) => c.channel_id).length;
        return all.length ? `${linked} of ${all.length} linked` : null;
      }
      case "/admin/devices": {
        if (devicePending || deviceFailed || !device) return null;
        if (!device.display.paired) return "No screen paired yet";
        return device.display.online ? "Screen online" : "Screen offline";
      }
      case "/admin/activity": {
        if (activityPending || activityFailed) return null;
        const last = activity?.[0];
        return last ? `Last ${agoLabel(last.created_at)}` : null;
      }
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {tiles.map(({ to, label }) => {
        const Icon = ICON[to];
        return (
          <Link
            key={to}
            to={to}
            className="pressable flex min-h-[124px] flex-col justify-between rounded-[22px] p-4"
            style={{
              background: "var(--card)",
              border: "1px solid rgba(var(--ink),.09)",
            }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[11px]"
              style={{ background: "var(--accent-tint)", color: "var(--accent-on-tint)" }}
            >
              {Icon && <Icon size={18} strokeWidth={1.7} aria-hidden />}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium leading-[1.25] tracking-[-0.01em]">
                {label}
              </span>
              <span className="text-[12px] leading-[1.35] text-fg-faint">
                {fact(to) ?? HINT[to] ?? ""}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
