import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePeople } from "@/hooks/useAdminData";
import { useDisplay } from "@/lib/DisplayContext";
import { useAuth } from "@/context/AuthContext";
import { PageFrame, PageHeader } from "@/components/admin/kit";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { listState } from "@/lib/listState";
import type { Screen } from "@/components/admin/ScreensBlock";

/**
 * Users — whose archive this is, and who is in it (owner-directed).
 *
 * The masthead's "Margaret's archive ⌄" used to dump whoever pressed it
 * back at the profile selector, which answers "who am I" when the question
 * being asked was "whose archive is this". This page answers that question:
 * the archive as a thing — its subject, its people, its screens — with the
 * profile switch demoted to one explicit action rather than being the whole
 * destination.
 *
 * It is deliberately one archive today. The layout is a list of archive
 * cards with one entry, because the owner's plan is granddad's archive
 * sitting beside grandma's on this same page — different channels, different
 * subject, one family key. Building the list now means that day adds a row,
 * not a redesign.
 */

export function UsersPage() {
  const navigate = useNavigate();
  const { subjectName } = useDisplay();
  const { profile } = useAuth();

  const { data: people, isPending, isError } = usePeople();
  const peopleState = listState({ isPending, isError, count: people?.length ?? 0 });

  const { data: screens } = useQuery({
    queryKey: ["settings-screens"],
    queryFn: () => api.get<Screen[]>("/settings/screens"),
  });

  const subject = (people ?? []).find((p) => p.role === "user") ?? null;
  const members = (people ?? []).filter((p) => p.role !== "user");
  const who = subjectName?.trim() || subject?.name?.trim() || "This";

  return (
    <PageFrame
      type="roster"
      scroll
      /* The header rides IN the band. An empty band above an in-body header
         was 116px of nothing — the "page starts very low" the owner saw. */
      header={
        <PageHeader
          title="Users"
          subtitle="The archives this family keeps, and the people in them."
        />
      }
    >
      <div className="max-w-[980px]">

        {/* ── The archive ─────────────────────────────────────────────── */}
        <section
          className="mt-2 rounded-[18px] p-6"
          style={{ border: "1px solid var(--line-soft)", background: "rgba(var(--ink),.03)" }}
        >
          <div className="flex flex-wrap items-center gap-5">
            {subject && <InitialsAvatar name={subject.name} size={56} />}
            <div className="min-w-0 flex-1">
              <h2 className="text-[19px] font-medium leading-[1.3]">
                {who === "This" ? "This archive" : `${who}'s archive`}
              </h2>
              <p className="mt-1 text-[13px] text-fg-faint">
                {/* Counts only from successful reads — a failed one says nothing. */}
                {peopleState === "ready"
                  ? `${members.length} ${members.length === 1 ? "person" : "people"} contributing` +
                    (screens ? ` · ${screens.length} ${screens.length === 1 ? "screen" : "screens"}` : "")
                  : peopleState === "error"
                    ? "The people could not be loaded."
                    : "Loading…"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/admin/settings")}
              className="min-h-[44px] rounded-full border border-line px-4 py-2 text-[13px] sm:min-h-0"
            >
              Archive settings
            </button>
          </div>

          {/* The people, as faces — the contributors page holds the detail. */}
          {peopleState === "ready" && (
            <div className="mt-5 flex flex-wrap gap-2.5 border-t border-line-soft pt-5">
              {members.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => navigate(`/admin/contributors/${person.id}`)}
                  className="pressable flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4"
                  style={{ border: "1px solid var(--line-soft)" }}
                >
                  <InitialsAvatar name={person.name} size={30} />
                  <span className="text-[13px]">{person.name}</span>
                  {person.relationship && (
                    <span className="text-[11px] text-fg-faint">{person.relationship}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── The one that is not here yet ────────────────────────────── */}
        <section
          className="mt-4 rounded-[18px] p-6"
          style={{ border: "1px dashed rgba(var(--ink),.2)" }}
        >
          <h2 className="text-[15px] text-fg-muted">A second archive</h2>
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.6] text-fg-faint">
            One family key will hold more than one archive — granddad&apos;s channels beside
            grandma&apos;s, each with their own screen and their own cards. It is on its way;
            when it arrives, it appears here.
          </p>
        </section>

        {/* ── You ─────────────────────────────────────────────────────── */}
        <section className="mt-8 flex flex-wrap items-center gap-4 border-t border-line-soft pt-6">
          <p className="text-[13px] text-fg-faint">
            Signed in as <span style={{ color: "var(--fg)" }}>{profile?.name}</span>.
          </p>
          <button
            type="button"
            onClick={() => navigate("/profiles", { state: { from: "/admin/users" } })}
            className="min-h-[44px] rounded-full border border-line px-4 py-2 text-[13px] sm:min-h-0"
          >
            Switch profile
          </button>
        </section>
      </div>
    </PageFrame>
  );
}
