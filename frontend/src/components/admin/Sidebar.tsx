import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { ArchiveProgress } from "@/components/admin/ArchiveProgress";
import {
  useActivity,
  useChannels,
  useNfcCards,
  usePeople,
  useSuggestions,
} from "@/hooks/useAdminData";
import type { SubjectProfile } from "@/types";
import { listState } from "@/lib/listState";

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";

function Divider() {
  return <div className="my-4 h-px" style={{ background: "rgba(var(--ink),.1)" }} />;
}

function Stat({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="block transition-[filter] hover:brightness-125">
      <p className={LABEL}>{label}</p>
      <p className="mt-2 text-[29px] font-bold leading-none">{value}</p>
    </Link>
  );
}

/**
 * The fixed left-hand column: whose archive this is, how much of it there
 * is, what it is missing, and what happened here lately. It never changes
 * with the tab — the identity of the archive is not a view.
 */
export function Sidebar() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const { data: subject } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });
  const { data: channels } = useChannels();
  const { data: people } = usePeople();
  const { data: cards } = useNfcCards();
  const {
    data: suggestions,
    isPending: suggestionsPending,
    isError: suggestionsFailed,
  } = useSuggestions();
  const { data: activity, isPending: activityLoading, isError: activityFailed } = useActivity(3);

  const contributors = (people ?? []).filter((p) => p.role !== "user");
  const name = subject?.full_name || subject?.display_name || "—";
  // A summary, deliberately: "4 channels without an NFC card", never the
  // individual items — those live as missions on the board, where each
  // finding is one card. Four lines, no scrolling.
  /*
    "Everything looks good ✓" is a reassurance, which makes it the worst
    thing to invent (M205). It rendered whenever `groups` was empty — and
    `suggestions?.groups ?? []` is empty when the request failed, so the
    sidebar cheerfully told an administrator the archive was in good shape
    on a load it had never completed.
  */
  const suggestionsUnread = suggestionsPending || suggestionsFailed;
  const groups = suggestions?.groups ?? [];

  const born = subject?.birth_date
    ? new Date(subject.birth_date).toLocaleDateString("en-GB", { dateStyle: "long" })
    : null;
  const identity = [born, subject?.residence]
    .filter(Boolean)
    .join(" · ");

  return (
    <aside
      className="flex w-[300px] flex-none flex-col overflow-y-auto px-8 py-8"
      style={{ borderRight: "1px solid rgba(var(--ink),.1)" }}
    >
      <button
        type="button"
        onClick={() => navigate("/admin/profile")}
        className="flex flex-col items-center gap-3.5 text-center"
      >
        {subject?.photo_url ? (
          <img src={subject.photo_url} alt="" className="h-[104px] w-[104px] rounded-full object-cover" />
        ) : (
          <InitialsAvatar name={name} size={104} />
        )}
        <span>
          <span className="block text-2xl font-bold tracking-[-0.01em]">{name}</span>
          <span className="mt-1.5 block text-[13px] leading-[1.5] text-fg-muted">{identity}</span>
        </span>
      </button>

      <Divider />

      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Stat label="CHANNELS" value={channels?.length ?? 0} to="/admin/shelf" />
        {isAdmin && (
          <Stat label="CONTRIBUTORS" value={contributors.length} to="/admin/contributors" />
        )}
        <Stat label="CARDS" value={cards?.length ?? 0} to={isAdmin ? "/admin/cards" : "/admin/shelf"} />
      </div>

      <Divider />

      {/* The number is back, turned around — progress, not a verdict (M97). */}
      {typeof suggestions?.health === "number" && (
        <ArchiveProgress health={suggestions.health} className="mb-5" />
      )}

      <div>
        <p className={LABEL}>NEEDS ATTENTION</p>
        {suggestionsUnread ? (
          <p className="mt-2 text-xs leading-[1.7] text-fg-muted">
            This could not be loaded, so we cannot say.
          </p>
        ) : groups.length === 0 ? (
          <p className="mt-2 text-xs leading-[1.7] text-fg-muted">Everything looks good ✓</p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {groups.slice(0, 4).map((group) => (
              <li key={group.rule_key}>
                <Link
                  to="/admin/missions"
                  className="text-xs leading-[1.7] text-fg-muted hover:text-fg"
                >
                  • {group.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto">
        <Divider />
        <p className={LABEL}>RECENT ACTIVITY</p>
        <ul className="mt-2 space-y-0.5">
          {(activity ?? []).slice(0, 3).map((row) => (
            <li key={row.id} className="truncate text-xs leading-[1.7] text-fg-muted">
              {row.description}
            </li>
          ))}
          {/* M182: "Nothing yet." was also what a failed load looked like. */}
          {listState({
            isPending: activityLoading,
            isError: activityFailed,
            count: (activity ?? []).length,
          }) === "error" && (
            <li className="text-xs leading-[1.7] text-fg-faint">Could not be loaded.</li>
          )}
          {listState({
            isPending: activityLoading,
            isError: activityFailed,
            count: (activity ?? []).length,
          }) === "empty" && (
            <li className="text-xs leading-[1.7] text-fg-faint">Nothing yet.</li>
          )}
        </ul>
        <Link to="/admin/activity" className="mt-2 block text-xs text-fg-faint hover:text-accent">
          View all →
        </Link>
      </div>
    </aside>
  );
}
