import type { Mission } from "@/hooks/useAdminData";

const STATUS_LABEL: Record<Mission["status"], string> = {
  in_progress: "IN PROGRESS",
  suggested: "SUGGESTED",
  completed: "DONE",
};

/**
 * A task somebody took on. Missions are always human: the archive's own
 * gaps are handled elsewhere and never land in anyone's list of work.
 */
export function MissionCard({
  mission,
  onClick,
  children,
}: {
  mission: Mission;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const active = mission.status === "in_progress";
  const done = mission.status === "completed";

  const who = mission.assignee?.name
    ? active
      ? `Assigned to ${mission.assignee.name}`
      : `Suggested for ${mission.assignee.name}`
    : null;

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => onClick && e.key === "Enter" && onClick()}
      className={`flex h-full flex-col rounded-xl px-5 py-4 ${onClick ? "pressable" : ""}`}
      style={{
        border: active
          ? "1px solid var(--accent)"
          : `1px solid rgba(var(--ink),${done ? ".1" : ".16"})`,
        opacity: done ? 0.55 : 1,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <p
        className="font-mono text-[9px] tracking-[0.14em]"
        style={{ color: active ? "var(--accent)" : "var(--fg-faint)" }}
      >
        {STATUS_LABEL[mission.status]}
      </p>

      <p className="mt-1.5 text-[15px] font-medium leading-[1.35]">
        {done && "✓ "}
        {mission.title}
      </p>

      {/* Two lines, always: a one-line reason and a two-line one should not
          make two cards different shapes. */}
      <p
        className="mt-1.5 overflow-hidden text-[13px] leading-[1.5] text-fg-muted"
        style={{ height: "calc(1.5em * 2)" }}
      >
        {(!done && mission.detail) || " "}
      </p>

      {/* Pinned to the bottom, so it sits on the same line on every card. */}
      <p className="mt-auto pt-2.5 font-mono text-[11px] text-fg-faint">
        {done && mission.completed_at
          ? `COMPLETED ${new Date(mission.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" }).toUpperCase()}`
          : (who ?? "Unassigned")}
      </p>

      {children}
    </div>
  );
}
