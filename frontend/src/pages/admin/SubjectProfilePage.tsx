import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageFrame, PageHeader } from "@/components/admin/kit";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import type { SubjectProfile } from "@/types";
import { listState } from "@/lib/listState";

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="label-caps">{label}</p>
      <p className="mt-1" style={{ color: value ? "var(--fg)" : "var(--fg-faint)" }}>
        {value || "—"}
      </p>
    </div>
  );
}

/** The person the whole archive is for. */
export function SubjectProfilePage() {
  const { isAdmin } = useAuth();
  const { setStatus } = useDisplay();

  useEffect(() => {
    setStatus({ hint: "PROFILE" });
    return () => setStatus(null);
  }, [setStatus]);

  const { data: subject, isPending, isError } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });

  /*
    "No profile yet." is the most dangerous of these sentences (M181, F70).

    A null subject is a real state — nobody has filled her profile in — and
    the page's answer to it is to invite someone to create one. But an
    undefined subject is a *failed load*, and this code could not tell them
    apart, so a dropped connection invited an admin to create a second
    profile for a woman who already has one. The identity model has exactly
    one subject per archive.

    `listState` counts the subject as one row, so absence and failure stop
    sharing an answer.
  */
  const state = listState({ isPending, isError, count: subject ? 1 : 0 });

  if (state !== "ready" || !subject) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-fg-muted">
          {state === "loading"
            ? "Loading…"
            : state === "error"
              ? "Her profile could not be loaded, so we cannot say whether one exists."
              : "No profile yet."}
        </p>
      </div>
    );
  }

  const name = subject.full_name || subject.display_name;

  return (
    /*
      On the shared frame, with her name as the page title (Q10, owner —
      same decision as the contributor page). The subtitle keeps the one
      thing the old caption said that the title does not: whose archive
      this is.
    */
    <PageFrame
      header={<PageHeader title={name} subtitle={`${subject.display_name}’s archive`} />}
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 md:grid-cols-[minmax(260px,1fr)_2fr] md:grid-rows-[minmax(0,1fr)] md:gap-[4vw]">
        <div className="flex flex-col items-center gap-4 text-center">
          {subject.photo_url ? (
            <img src={subject.photo_url} alt="" className="h-40 w-40 rounded-full object-cover" />
          ) : (
            <InitialsAvatar name={name} size={160} />
          )}
          <span
            className="rounded-full px-3 py-1 text-xs"
            style={{ background: "var(--accent-tint)", color: "var(--accent-soft)" }}
          >
            Private archive
          </span>

          {isAdmin && (
            <Link
              to="/admin/settings"
              className="mt-2 rounded-md border border-line px-6 py-2.5 transition-colors hover:border-accent"
            >
              Edit profile
            </Link>
          )}
        </div>

        <div className="scroll-thin min-h-0 md:overflow-y-auto pr-2">
          <div className="grid max-w-2xl grid-cols-2 gap-x-8 gap-y-5">
            <Detail
              label="Born"
              value={
                subject.birth_date
                  ? new Date(subject.birth_date).toLocaleDateString("en-GB", {
                      dateStyle: "long",
                    })
                  : null
              }
            />
            <Detail label="Living place" value={subject.residence} />
          </div>


          {subject.note && (
            <div className="mt-6 max-w-2xl">
              <p className="label-caps">Notes for contributors</p>
              <p className="mt-1 max-w-prose text-fg-muted">{subject.note}</p>
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
