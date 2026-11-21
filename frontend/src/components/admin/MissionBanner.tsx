import { useEffect, useState } from "react";
import type { Mission } from "@/hooks/useAdminData";

/**
 * Mission direction — the one place that knows, for every kind of mission,
 * where it happens and what to say while it is happening.
 *
 * The guidance is a banner that floats over the top of the workspace,
 * position fixed, so nothing on the page moves to make room for it: the
 * rule that every element keeps its place survives even being guided.
 */

/** Where pressing a mission takes you. */
export function missionDestination(mission: Mission): { path: string; state: object } | null {
  if (mission.task_kind === "link_nfc") {
    return { path: "/admin/cards", state: { missionId: mission.id } };
  }
  if (mission.channel_id) {
    return { path: `/admin/edit-channel/${mission.channel_id}`, state: { missionId: mission.id } };
  }
  if (
    mission.task_kind === "record" ||
    mission.task_kind === "add_photos" ||
    mission.task_kind === "create_channel"
  ) {
    // No channel yet: the mission is to make one.
    return {
      path: "/admin/create-channel",
      state: {
        missionId: mission.id,
        ...(mission.task_kind !== "create_channel" && {
          presetType: mission.task_kind === "record" ? "video" : "album",
        }),
      },
    };
  }
  return null;
}

const BUBBLE_EDGE = "1px solid rgba(var(--accent-channels),.55)";

/**
 * Guidance that stands next to the work: a small bubble anchored to the
 * element carrying `data-mission-anchor={anchorId}`, tail pointing at it,
 * floating above the veil. Position is measured, never part of the layout,
 * so nothing on the page moves to make room — and when the row scrolls,
 * the bubble follows.
 */
export function MissionBubble({
  anchorId,
  label,
  title,
  body,
  onExit,
}: {
  anchorId: string;
  label: string;
  title: string;
  body: string;
  /** Pressable exit — the phone has no Escape key. */
  onExit?: () => void;
}) {
  const [box, setBox] = useState<{ top: number; left: number; below: boolean } | null>(null);

  // On a phone there is no room to stand beside the work: a floating bubble
  // lands on top of the very field it describes. It becomes a slim banner
  // pinned under the top edge instead — guidance above the page, never over
  // its subject.
  const phone =
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  useEffect(() => {
    if (phone) return;
    const place = () => {
      const el = document.querySelector(`[data-mission-anchor="${anchorId}"]`);
      if (!el) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const below = r.top < 250; // no room above: speak from underneath
      setBox({
        top: below ? r.bottom + 14 : r.top - 14,
        left: Math.max(16, Math.min(r.right - 320, window.innerWidth - 336)),
        below,
      });
    };
    place();
    // The anchor can appear a frame later than the bubble, and it moves
    // when its list scrolls — keep following it.
    const tick = setInterval(place, 300);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(tick);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorId, phone]);

  if (phone) {
    return (
      <div
        className="fixed left-4 right-4 z-[80] rounded-[14px] p-3.5"
        style={{
          top: "calc(10px + env(safe-area-inset-top))",
          background: "var(--panel-mission)",
          border: BUBBLE_EDGE,
          boxShadow: "var(--shadow-pop)",
        }}
        role="status"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: "var(--accent)" }}>
            {label}
          </span>
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className="-m-2 p-2 font-mono text-[10px] tracking-[0.1em] text-fg-muted"
            >
              EXIT ✕
            </button>
          ) : (
            <span className="font-mono text-[9px] tracking-[0.1em] text-fg-faint">EXIT · ESC</span>
          )}
        </div>
        <p className="mt-1 text-[14px] font-semibold leading-[1.3]">{title}</p>
        <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">{body}</p>
      </div>
    );
  }

  if (!box) return null;
  return (
    <div
      className="fixed z-[80] w-[320px] rounded-[14px] p-4"
      style={{
        top: box.top,
        left: box.left,
        transform: box.below ? undefined : "translateY(-100%)",
        background: "var(--panel-mission)",
        border: BUBBLE_EDGE,
        boxShadow: "var(--shadow-pop)",
      }}
      role="status"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: "var(--accent)" }}>
          {label}
        </span>
        <span className="font-mono text-[9px] tracking-[0.1em] text-fg-faint">EXIT · ESC</span>
      </div>
      <p className="mt-1.5 text-[15px] font-semibold leading-[1.3]">{title}</p>
      <p className="mt-1 text-[13px] leading-[1.55] text-fg-muted">{body}</p>
      <span
        aria-hidden
        className="absolute h-3 w-3"
        style={{
          right: 36,
          background: "var(--panel-mission)",
          transform: "rotate(45deg)",
          ...(box.below
            ? { top: -7, borderTop: BUBBLE_EDGE, borderLeft: BUBBLE_EDGE }
            : { bottom: -7, borderBottom: BUBBLE_EDGE, borderRight: BUBBLE_EDGE }),
        }}
      />
    </div>
  );
}

export function MissionBanner({
  title,
  instruction,
  onExit,
}: {
  title: string;
  instruction: string;
  onExit: () => void;
}) {
  return (
    <div
      className="mission-target fixed left-1/2 top-3 z-[90] flex w-[640px] max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-[14px] px-5 py-3.5"
      style={{ boxShadow: "var(--shadow-pop-deep)", backdropFilter: "blur(6px)" }}
      role="status"
    >
      <span
        className="flex-none font-mono text-[10px] tracking-[0.16em]"
        style={{ color: "var(--accent)" }}
      >
        MISSION
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs leading-[1.5] text-fg-muted">{instruction}</span>
      </span>
      <button
        type="button"
        onClick={onExit}
        className="flex-none font-mono text-[10px] tracking-[0.1em] text-fg-faint"
      >
        EXIT · ESC
      </button>
    </div>
  );
}
