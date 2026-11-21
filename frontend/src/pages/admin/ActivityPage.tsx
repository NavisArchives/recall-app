import { Link } from "react-router-dom";
import { useActivity, type ActivityRow } from "@/hooks/useAdminData";
import { listState } from "@/lib/listState";

const LABEL = "font-mono text-[11px] tracking-[0.16em] text-fg-muted";

/** "Today", "Yesterday", then the date — how people actually recall days. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { dateStyle: "long" });
}

export function ActivityPage() {
  const { data, isPending, isError } = useActivity(200);

  const groups: { day: string; rows: ActivityRow[] }[] = [];
  for (const row of data ?? []) {
    const day = dayLabel(row.created_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }

  const feedState = listState({ isPending, isError, count: groups.length });

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      {/*
        Desktop-only (M82). On a phone this page is a bottom-nav destination,
        so a link back to Overview — another nav destination — is noise next
        to the tab bar that already goes there. The desktop has no bottom nav,
        so the link is its contextual way back and stays.
      */}
      <Link to="/admin" className="hidden font-mono text-xs text-fg-faint hover:text-fg md:inline">
        ← Overview
      </Link>
      <h1 className="mt-2 text-[26px] font-bold tracking-[-0.01em]">Activity</h1>
      <p className="mt-1 text-sm text-fg-muted">Everything that has happened in this archive.</p>

      {feedState === "loading" && <p className="mt-8 text-fg-muted">Loading…</p>}

      {/* Found by M182's backstop, and the same fault as M180: a failed
          load rendered "Nothing has happened yet." — a statement about the
          archive's whole history, made without having read any of it. */}
      {feedState === "error" && (
        <p className="mt-10 text-center text-fg-muted">
          The activity could not be loaded, so we cannot say what has happened.
        </p>
      )}

      {feedState === "empty" && (
        <p className="mt-10 text-center text-fg-muted">Nothing has happened yet.</p>
      )}

      <div className="scroll-thin mt-7 flex min-h-0 max-w-2xl flex-1 flex-col gap-7 md:overflow-y-auto pb-8 pr-2">
        {groups.map((group) => (
          <section key={group.day}>
            <p className={LABEL}>{group.day.toUpperCase()}</p>
            <ul className="mt-2.5">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-6 py-2.5"
                  style={{ borderBottom: "1px solid rgba(var(--ink),.08)" }}
                >
                  <span className="text-[15px]">{row.description}</span>
                  <span className="flex-none font-mono text-xs text-fg-faint">
                    {new Date(row.created_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
