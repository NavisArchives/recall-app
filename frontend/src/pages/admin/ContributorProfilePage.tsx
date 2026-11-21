import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isGenuinelyMissing } from "@/lib/missingOrUnreachable";
import { BackArrow, PageFrame } from "@/components/admin/kit";
import { useAuth } from "@/context/AuthContext";
import { PinRevealDialog } from "@/components/admin/PinRevealDialog";
import { useDisplay } from "@/lib/DisplayContext";
import { roleLabel, subjectPossessive } from "@/lib/labels";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { StatusPill } from "@/components/admin/StatusPill";
import { ago } from "@/components/admin/AccessBlock";
import { ContributionBlock } from "@/components/admin/ContributionBlock";
import { useActivity, usePeopleStream } from "@/hooks/useAdminData";
import type { Author, Channel } from "@/types";

/**
 * A failure, where the action was (12o).
 *
 * "Every failure says what did not happen, so an admin never has to guess
 * whether it half-worked." The page used to put one reserved line at the top
 * of the block saying "The action failed." — which is true, unhelpful, and
 * some distance from the button that failed. An admin reading it cannot tell
 * whether the PIN was reissued, whether the email went, or whether they are
 * now looking at a person whose access is half-changed.
 *
 * So each row carries its own: what did not happen, and what is therefore
 * still true. `Try again` retries the same action; `Dismiss` clears it
 * without doing anything, because an admin who has read it may simply want
 * the row back.
 */
function FailureRow({
  what,
  stillTrue,
  onDismiss,
  onRetry,
}: {
  what: string;
  stillTrue: string;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      className="rounded-md px-5 py-3"
      style={{ border: "1px solid var(--destructive-soft)" }}
    >
      <p className="text-sm" style={{ color: "var(--fg)" }}>
        {what}
      </p>
      <p className="mt-1 text-[13px]" style={{ color: "var(--fg-muted)" }}>
        {stillTrue}
      </p>
      <div className="mt-2.5 flex items-center gap-4">
        <button type="button" onClick={onDismiss} className="font-mono text-xs text-fg-faint">
          Dismiss
        </button>
        <button type="button" onClick={onRetry} className="text-sm" style={{ color: "var(--accent)" }}>
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * One fact about a person — or nothing at all, when the fact was never sent.
 *
 * `withheld` is not the same as empty, and the em-dash used to merge them
 * (M222). A co-author is served `PERSON_MEMBER_COLUMNS`, which carries no
 * email, phone, address or created_by — so this page told them a colleague
 * with all four had none of them. The same page shows that co-author their
 * OWN real details, because `isSelf` is served `PERSON_SELF_COLUMNS`: the
 * payload was role-aware and the rows were not.
 *
 * The wireframes already answer it for the dashboard — "the people section is
 * removed outright, because it holds others' contact details" — and the same
 * word applies here: removed, not shown empty. A row that is not ours to see
 * is absent, so nothing is claimed about it either way.
 *
 * Withheld is decided by whether the field ARRIVED, never by whether it is
 * truthy. That keeps the state this row exists for: an admin looking at a
 * person who genuinely has no email still sees "Email —" and knows to ask
 * for one. Hiding on falsiness would have taken that away — the same trap as
 * hiding an empty-state card because it looked empty.
 */
function Detail({
  label,
  value,
  withheld = false,
}: {
  label: string;
  value: string | null | undefined;
  withheld?: boolean;
}) {
  if (withheld) return null;
  return (
    <div>
      <p className="label-caps">{label}</p>
      <p className="mt-1" style={{ color: value ? "var(--fg)" : "var(--fg-faint)" }}>
        {value || "—"}
      </p>
    </div>
  );
}

/**
 * One contributor, and everything an admin can do about their membership:
 * edit the profile, hand out a fresh PIN, change their level, or block
 * sign-in without touching a single memory they added.
 */
export function ContributorProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { setStatus, subjectName } = useDisplay();

  const [busy, setBusy] = useState<string | null>(null);
  /*
    Which action failed, not merely that one did (12o). The row that failed
    is the row that says so.
  */
  const [failed, setFailed] = useState<{ action: string; message: string } | null>(null);
  // A reset PIN is shown exactly once, in a reserved slot so nothing moves.
  const [newPin, setNewPin] = useState<{ pin: string; emailSent: boolean } | null>(null);
  const [confirming, setConfirming] = useState<"pin" | "role" | "status" | "remembered" | null>(null);

  useEffect(() => {
    setStatus({ hint: "CONTRIBUTOR" });
    return () => setStatus(null);
  }, [setStatus]);

  /*
    `isPending`, not `isLoading` (M191, still open on this page).

    Found in the states harness: at `paused` this page said "could not be
    loaded — nothing has changed about them" while the request was simply
    parked between retries. Not a false claim about the person, but a false
    claim about us, and it sends an admin away from a page that was about to
    work. `isLoading` is `isPending && isFetching`, so a paused query reports
    false on it with no data to show.
  */
  const {
    data: person,
    isPending: isLoading,
    error: personError,
  } = useQuery({
    queryKey: ["person", id],
    queryFn: () => api.get<Author>(`/people/${id}`),
    enabled: !!id,
  });

  /*
    The last-admin guard (12n) needs to know how many admins are left. The
    backend refuses the change regardless — that is where the guarantee lives
    — but a control that fires and then apologises is worse than one that
    says up front why it cannot.
  */
  const {
    data: people,
    isPending: peoplePending,
    isError: peopleFailed,
  } = useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Author[]>("/people"),
  });
  const peopleUnread = peoplePending || peopleFailed;

  const {
    data: channels,
    isPending: channelsLoading,
    isError: channelsFailed,
  } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<Channel[]>("/channels"),
  });

  /*
    The two feeds frame 12a's CONTRIBUTION block reads. Both are already
    cached by other pages, so this costs no extra round trip in practice —
    and both hand their own load state down, because a figure about what
    somebody gave the archive is the last place to print a zero we do not
    have (M202).
  */
  const {
    data: peopleStream,
    isPending: streamPending,
    isError: streamFailed,
  } = usePeopleStream();
  const {
    data: activity,
    isPending: activityPending,
    isError: activityFailed,
  } = useActivity(100);

    /*
    The right column, divided (owner-directed): one unbroken scroll ran
    Details → About → Activity → Access → Actions, and finding the third
    group meant travelling through the first two every time. Three tabs, cut
    where the READER's question changes — "who is this" (info), "what have
    they done" (activity), "what can I change" (access & actions).

    `hidden` rather than unmount, so the activity queries keep their state
    and switching tabs is instant with nothing refetched.
  */
  const [section, setSection] = useState<"info" | "activity" | "actions">("info");

  const isSelf = person?.id === profile?.id;
  // Paused and remembered admins cannot sign in, so they are not cover.
  const ableAdmins = (people ?? []).filter((p) => p.role === "admin" && p.status === "active");
  /*
    Only when we have actually counted the admins (M213's census).

    `(people ?? [])` is empty on a failed read, so `ableAdmins.length <= 1`
    was true for every active admin and the page told them "This is the only
    admin — make someone else an admin first". It fails safe, in that it
    refuses rather than permits — but it is still a false statement about
    the shape of somebody's family, offered as the reason they cannot act.
  */
  const isLastAdmin =
    !peopleUnread &&
    person?.role === "admin" &&
    person.status === "active" &&
    ableAdmins.length <= 1;
  const theirChannels = (channels ?? []).filter(
    (c) => c.author_id === person?.id || c.created_by === person?.id
  );
  const channelCount = theirChannels.length;
  /*
    The "Nothing added yet." decision moved into `ContributionBlock` with the
    rest of the figures (12a) — it now needs BOTH the people stream and the
    activity log, not just the channel list, so it belongs where those live.
    `channelsLoading`/`channelsFailed` still gate the identity line above.
  */

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setFailed(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["person", id] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      setConfirming(null);
    } catch (err) {
      /*
        The confirm row is NOT dismissed on failure (12o): the failure takes
        its place, so the thing that went wrong is reported where it was
        attempted rather than after the page has snapped back to a state that
        looks like nothing was tried.
      */
      setFailed({
        action,
        message: err instanceof Error ? err.message : "The action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const resetPin = () =>
    run("pin", async () => {
      const result = await api.post<{ pin: string; emailed: { success: boolean } }>(
        `/people/${id}/reset-pin`
      );
      /*
        The outcome, not a sentence about it (12c/12d). The dialog decides how
        to say "sent" or "we couldn't", and offers Try again on the failure —
        which is the live case for most families, since a contributor with no
        address never gets one.
      */
      setNewPin({ pin: result.pin, emailSent: result.emailed.success });
    });

  /*
    12j. A `user` has never signed in, and the way in is a PIN and the
    co-author level — not the top of the building. Sending them straight to
    `admin` was what this did, which is a strange thing to happen to a
    grandchild whose profile exists so her face is on the screen.
  */
  const nextRole = (role?: string) => (role === "co_author" ? "admin" : "co_author");

  /*
    Promoting somebody who has no code yet gives them one (access-3): the
    backend mints a PIN and returns it this once, so it goes straight into
    the same one-time dialog Reset PIN uses. Without it, "Give them a PIN and
    let them sign in" promised a code nobody could ever see.
  */
  const toggleRole = () =>
    run("role", async () => {
      const result = await api.patch<{ pin?: string; emailed?: { success: boolean } }>(
        `/people/${id}/role`,
        { role: nextRole(person?.role) }
      );
      if (result?.pin) {
        setNewPin({ pin: result.pin, emailSent: result.emailed?.success === true });
      }
    });

  /*
    Any closed door reopens to `active` (12l's Restore, 12g/12h's Undo).

    This read `deactivated ? active : deactivated`, which is correct for a
    paused person and wrong for a remembered one: undoing "remembered" sent
    `deactivated`, quietly converting the most sensitive state on the page
    into a different one instead of clearing it. Found while wiring 12g's
    Undo, which is the first control that ever took that branch.
  */
  const closed = person?.status === "deactivated" || person?.status === "remembered";
  const toggleStatus = () =>
    run("status", async () => {
      await api.patch(`/people/${id}/status`, {
        status: closed ? "active" : "deactivated",
      });
    });

  /*
    The VISIBILITY axis (043, frame 12a's switch panel).

    Its own call to its own route, deliberately. Until now the only way to
    take a face off her screen was to pause the person, which also took away
    their sign-in — one control doing two unrelated jobs. Pressing this must
    never change anybody's access, and the backend refuses to let it: the
    visibility route writes `show_on_display` and nothing else.
  */
  /*
    A lockout is a fact with a clock, not a status (12m). The pill stays green
    and "active" beside it; this only says the door is jammed and when it
    unjams. Recomputed on render rather than held in state — a stale "locked"
    that has actually expired would send an admin chasing a problem that
    solved itself.
  */
  const lockedUntil = person?.locked_until ? new Date(person.locked_until) : null;
  const locked = !!lockedUntil && lockedUntil.getTime() > Date.now();
  const lockMinutes = locked
    ? Math.max(1, Math.round((lockedUntil!.getTime() - Date.now()) / 60000))
    : 0;


  const clearLockout = () =>
    run("lockout", async () => {
      await api.post(`/people/${id}/clear-lockout`);
    });

  const visible = person?.show_on_display !== false;
  const toggleVisibility = () =>
    run("visibility", async () => {
      await api.patch(`/people/${id}/visibility`, { show_on_display: !visible });
    });

  /*
    Marking somebody remembered is the heaviest action on this page, so it
    goes through the same confirm step as the destructive ones — and it is
    never offered for yourself, which the backend also refuses (the misclick
    that locks an admin out of their own family's archive). `isSelf` is
    already computed below for the other self-guards; this reuses it.
  */
  const setRemembered = () =>
    run("remembered", async () => {
      await api.patch(`/people/${id}/status`, { status: "remembered" });
    });

  if (isLoading || !person) {
    /*
      "This person was not found." on any failure at all (M201).

      Of the three pages that did this, it is the one that reads worst: a
      family member opens a contributor's page and is told the person is not
      there. It sounds like somebody removed them. Only a 404 says that;
      a 503 says we could not ask.
    */
    const missing = isGenuinelyMissing(personError);
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-6 text-center">
        <p className="text-fg-muted">
          {isLoading
            ? "Loading…"
            : missing
              ? "This person was not found."
              : "This person's page could not be loaded — nothing has changed about them."}
        </p>
      </div>
    );
  }

  /* min-h-[48px] is 12p's rule, and it is the phone that needs it: these rows
     are ~44px from their padding alone, which is under every touch guideline
     and this page is mostly used one-handed. */
  const ACTION =
    "min-h-[48px] rounded-md border border-line px-5 py-2.5 text-left transition-colors hover:border-accent disabled:opacity-40";

  return (
    /*
      On the shared frame, with the person's name as the page title (Q10,
      owner). The name used to be a text-3xl caption under the portrait —
      this page and Margaret's were the last two whose <h1> was not on the
      shared line, and the owner chose joining the frame over keeping the
      portrait-first layout.
    */
    <PageFrame
      type="roster"
      header={<BackArrow to="/admin/contributors" label="All contributors" />}
    >

      {/*
        The row has to be bounded, or the scroll never engages (M76).

        The workspace box is fixed-height and `overflow-hidden`, and the
        details column below already asks to scroll — but a grid's implicit
        row sizes to its *content*, so the column was handed an unbounded
        height, never became scrollable, and simply grew past the box. The
        casualty was the bottom of the list: "Deactivate profile" sat 91px
        below the container's edge, unreachable by any means.

        `grid-rows-[minmax(0,1fr)]` bounds the row to the box, which is what
        lets the child's `overflow-y-auto` do its job. `min-h-0` on the child
        alone is not enough when the parent is a grid.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-12">
        {/* Who they are */}
        <div className="flex flex-col items-center gap-4 text-center">
          {person.profile_picture_url ? (
            <img
              src={person.profile_picture_url}
              alt=""
              className="h-28 w-28 rounded-full object-cover md:h-40 md:w-40"
            />
          ) : (
            /* Same two sizes as the photo above it. */
            <>
              <span className="md:hidden">
                <InitialsAvatar name={person.name} size={112} />
              </span>
              <span className="hidden md:block">
                <InitialsAvatar name={person.name} size={160} />
              </span>
            </>
          )}
          {/*
            The name belongs under the portrait, not in the sub-nav (owner,
            21 Aug, looking at 12a beside the built page). It briefly lived
            up there as a shared page title (Q10); seen next to the frame it
            left the identity column headless and the title stranded above a
            band of empty space.
          */}
          <div>
            <h1 className="text-[30px] font-bold leading-[1.1]" style={{ color: "var(--fg-cream, var(--fg))" }}>
              {person.name}
            </h1>
            <p className="mt-1 text-fg-muted">
              {[person.relationship, roleLabel(person.role)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className="inline-flex items-center gap-2">
            <StatusPill status={person.status} />
            {/*
              Beside the pill, never instead of it (12m). A locked person is
              still active — the door is jammed, not closed — and colouring
              the pill would say the opposite.
            */}
            {locked && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.12em]"
                style={{ background: "rgba(var(--ink),.08)", color: "var(--accent-soft)" }}
              >
                <Lock size={10} strokeWidth={2} aria-hidden />
                LOCKED · {lockMinutes} MIN
              </span>
            )}
          </span>
          {/*
            12i. A person who has not added anything yet gets nothing here,
            not "0 channels in the archive" — printing the zero makes an
            ordinary new contributor look like a failure to load. What they
            have not done belongs in the Contribution block below, where it
            can be said in a sentence.
          */}
          {/*
            The identity line (12a): what they have given, and when they were
            last here — the two things an admin scans for before reading
            anything else.

            Each half appears only when its own load answered. A person with
            nothing yet gets no line at all rather than "0 memories": 12i is
            explicit that printing the zero makes an ordinary new contributor
            look like a failure to load, and the Contribution block says it
            properly in a sentence.
          */}
          {(() => {
            const mine = peopleStream?.circle.find((c) => c.id === person.id);
            const streamKnown = !streamPending && !streamFailed && !!mine;
            const parts: string[] = [];
            if (streamKnown && mine.media_added > 0) {
              parts.push(`${mine.media_added} memor${mine.media_added === 1 ? "y" : "ies"}`);
            }
            if (!channelsLoading && !channelsFailed && channelCount > 0) {
              parts.push(`${channelCount} channel${channelCount === 1 ? "" : "s"}`);
            }
            const last = ago(person.last_seen_at);
            if (last) parts.push(`last here ${last}`);
            return parts.length > 0 ? (
              <p className="text-sm text-fg-faint">{parts.join(" · ")}</p>
            ) : null;
          })()}

          {/*
            One sentence about the state, where the state is (12g/12h, 12l,
            12n). The pill is a word; this is what the word means for the
            person reading it.
          */}
          {person.status === "remembered" && (
            <p className="max-w-[260px] text-[13px] leading-[1.6] text-fg-muted">
              Their sign-in is closed. {subjectName?.trim() || "She"} still sees them.
            </p>
          )}
          {person.status === "deactivated" && (
            <p className="max-w-[260px] text-[13px] leading-[1.6] text-fg-muted">
              Paused. They cannot sign in; everything they added stays.
            </p>
          )}
          {isSelf && (
            <p className="text-[13px]" style={{ color: "var(--accent-soft)" }}>
              This is you.
            </p>
          )}
        </div>

        {/* Details and the admin's levers */}
        <div className="scroll-thin min-h-0 md:overflow-y-auto pr-2">
          <div
            className="mb-6 inline-flex gap-0.5 rounded-full p-[3px]"
            style={{ background: "rgba(var(--ink),.05)", border: "1px solid var(--line-soft)" }}
            role="tablist"
            aria-label="Profile sections"
          >
            {([
              ["info", "Info"],
              ["activity", "Activity"],
              ["actions", "Settings"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={section === value}
                onClick={() => setSection(value)}
                className="min-h-[44px] rounded-full px-4 py-2 text-[12.5px] leading-none sm:min-h-0"
                style={
                  section === value
                    ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                    : { color: "var(--fg-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div hidden={section !== "info"}>
          {/* 12a heads every block on this column; DETAILS was the one left
              unlabelled, so the page opened on bare field names. */}
          <p className="label-caps">Details</p>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <Detail label="Email" value={person.email} withheld={!("email" in person)} />
            <Detail
              label="Phone"
              value={person.contact_number}
              withheld={!("contact_number" in person)}
            />
            <Detail
              label="Birthday"
              value={
                person.birthday
                  ? new Date(person.birthday).toLocaleDateString("en-GB", { dateStyle: "long" })
                  : null
              }
            />
            <Detail label="Address" value={person.address} withheld={!("address" in person)} />
            <Detail
              label="Added"
              value={new Date(person.created_at).toLocaleDateString("en-GB", {
                dateStyle: "long",
              })}
            />
            {/*
              ADDED BY, resolved against the people list this page already
              holds (12a). The column carries an id, not a name — so when the
              list has not arrived, or the person who added them has since
              been removed, this is a dash rather than a guess.
            */}
            <Detail
              label="Added by"
              value={(people ?? []).find((p) => p.id === person.created_by)?.name}
              withheld={!("created_by" in person)}
            />
          </div>

          {/*
            12i. Both blocks are always drawn, empty or not. A missing block
            reads as a page that failed to finish; a block that says "No
            description yet" reads as a person who has not written one, which
            is the true and much less alarming thing.
          */}
          <div className="mt-8 border-t border-line-soft pt-6">
            <p className="label-caps">About</p>
            <p
              className="mt-1 max-w-prose"
              style={{ color: person.description ? "var(--fg-muted)" : "var(--fg-faint)" }}
            >
              {person.description || "No description yet."}
            </p>
          </div>

          </div>

          <div hidden={section !== "info"}>
            {/* Editing belongs beside what it edits (owner-directed): the
                fields above are what this button changes. */}
            <button
              type="button"
              onClick={() => navigate(`/admin/contributors/${person.id}/edit`)}
              className="mt-6 min-h-[44px] rounded-full border border-line px-5 py-2.5 text-[14px] sm:min-h-0"
            >
              Edit profile
            </button>
          </div>

          <div hidden={section !== "activity"}>
          <ContributionBlock
            personId={person.id}
            stream={peopleStream}
            streamPending={streamPending}
            streamFailed={streamFailed}
            activity={activity}
            activityPending={activityPending}
            activityFailed={activityFailed}
            lastSeenAt={person.last_seen_at}
          />

          </div>

          <div hidden={section !== "actions"}>
          {/*
            ACCESS — 12b's "half the admin came for", and absent for a `user`
            (12j) because there is no sign-in to describe. The block below
            already says that in a sentence rather than drawing three grey
            rows over nothing.
          */}
          {/*
            ACCESS is admin-only data, so it is drawn only for an admin.

            `/people/:id` narrows its columns by the reader's role, so a
            co-author receives a person with no `last_seen_at` and no
            `locked_until`. Rendering this block for them printed "Last
            signed in: Never" and "PIN: Never set" for somebody who signs in
            daily — the field was never sent, and `undefined` read as `null`.
            That is the same fabrication the rest of this cycle removed,
            introduced by me while building the block that removes it
            elsewhere.

            Absent rather than disabled, for 12j's reason: a co-author has no
            PIN controls to grey out, and the actions here are all refused
            server-side anyway.
          */}
          {/*
            No ACCESS status block any more (owner-directed). Its three rows
            were each a second copy of something: "Last signed in" lives on
            the Activity tab, the PIN's state is implied by the Reset PIN
            control below, and the invitation row duplicated "Invite them by
            email". A status block that repeats its own controls reads as
            twice the page for the same facts.
          */}

          <div className="mt-8 border-t border-line-soft pt-6">
            {/*
              12j. A `user` is a face on the display who never signs in — the
              subject herself, or a grandchild whose name goes on a memory.
              The block does not go grey and it does not apologise: it says
              the true thing, then says why the profile exists at all, so an
              admin looking for the missing PIN row stops looking.
            */}
            {person.role === "user" && (
              <div className="mb-6">
                <p className="label-caps">Access</p>
                <p className="mt-1.5 text-[15px]" style={{ color: "var(--fg)" }}>
                  This profile opens without a PIN.
                </p>
                <p className="mt-1.5 max-w-prose text-[13px] leading-[1.6] text-fg-faint">
                  {person.name.split(" ")[0]} never signs in. The profile exists so{" "}
                  {subjectName?.trim() || "she"} sees their face on her screen, and so their
                  name can be attached to a memory.
                </p>
              </div>
            )}

            {/* 12n. Said once, plainly, rather than repeated on every guard. */}
            {isSelf && (
              <p className="mb-4 text-[13px]" style={{ color: "var(--accent-soft)" }}>
                This is you.
              </p>
            )}

            {/* 12a calls this block ACTIONS — what an admin can do, as
                distinct from ACCESS above, which is what is true. */}
            <p className="label-caps">Actions</p>

            {/*
              No page-level error line any more (12o). A single reserved row
              at the top of the block said "The action failed." some distance
              from whichever control failed, and left an admin guessing
              whether it had half-worked. Each row now carries its own.
            */}

            {/*
              `grid-cols-1`, and it is load-bearing at 390px (12p: "nothing
              is clipped").

              A grid with no explicit column gets ONE implicit track sized to
              its content, which can be wider than the container — measured
              here as a 22px overflow on a 390px screen, with every row
              running 330px inside a 308px column and the right edge of every
              button cut off. `grid-cols-1` is `minmax(0, 1fr)`, which bounds
              the track to the container instead.
            */}
            <div className="mt-3 grid max-w-xl grid-cols-1 gap-3">
              {locked && (
                failed?.action === "lockout" ? (
                  <FailureRow
                    what="We couldn't clear the lockout. Nothing changed."
                    stillTrue={`It still clears itself on its own, and their PIN is untouched. ${failed.message}`}
                    onDismiss={() => setFailed(null)}
                    onRetry={clearLockout}
                  />
                ) : (
                  <button type="button" className={ACTION} onClick={clearLockout} disabled={busy === "lockout"}>
                    {busy === "lockout" ? "Clearing…" : "Clear the PIN lockout"}
                    <span className="block text-sm text-fg-faint">
                      Locked for another {lockMinutes} minute{lockMinutes === 1 ? "" : "s"} after wrong codes — their PIN is untouched
                    </span>
                  </button>
                )
              )}
              {/*
               * A face on the shelf who has never signed in. The invitation
               * claims this profile rather than making a second one (M41), so
               * everything already written here survives the join.
               */}
              {!person.joined_at && person.role !== "user" && (
                <button
                  type="button"
                  className={ACTION}
                  onClick={() =>
                    navigate("/admin/contributors/invite", { state: { personId: person.id } })
                  }
                >
                  Invite them by email
                  <span className="block text-sm text-fg-faint">
                    They pick their own PIN — this profile is waiting for them
                  </span>
                </button>
              )}

              {/*
                12j. Reset PIN is absent for a `user`, not drawn disabled.
                A disabled control is a promise that something exists behind
                it; this profile has no PIN to reset, and the Access block
                above has already said so in a sentence.
              */}
              {/*
                Each failure states what did not happen and what is still
                true (12o). "Nothing changed" is the half an admin needs
                most: a PIN reset that half-worked would mean somebody is
                locked out holding a code that no longer opens anything.
              */}
              {failed?.action === "pin" ? (
                <FailureRow
                  what="We couldn't reset the PIN. Nothing changed."
                  stillTrue={`Their old code still works. ${failed.message}`}
                  onDismiss={() => setFailed(null)}
                  onRetry={resetPin}
                />
              ) : person.role !== "user" && person.joined_at && (confirming === "pin" ? (
                <div className="flex items-center gap-3 rounded-md border border-line px-5 py-2.5">
                  <span className="flex-1 text-sm">
                    Replace their PIN? The old code stops working immediately.
                  </span>
                  <button type="button" onClick={() => setConfirming(null)} className="font-mono text-xs text-fg-faint">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={resetPin}
                    disabled={busy === "pin"}
                    className="text-accent"
                  >
                    {/* The row holds its place and only the confirm is
                        disabled; Cancel stays live (12o). */}
                    {busy === "pin" ? "ISSUING…" : "Reset PIN"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => setConfirming("pin")}
                >
                  {/*
                    12k. Absent until they have joined, not disabled: there is
                    no code to reset before an invitation is completed, and
                    ACCESS says so on the PIN row with Resend beside it. A
                    control that cannot fire is worse than no control (12j).
                  */}
                  Reset PIN
                  <span className="block text-sm text-fg-faint">
                    A new 6-digit code, shown once and emailed
                  </span>
                </button>
              ))}

              {failed?.action === "role" ? (
                <FailureRow
                  what="We couldn't change their role. Nothing changed."
                  stillTrue={
                    roleLabel(person.role)
                      ? `They are still ${roleLabel(person.role)!.toLowerCase()}. ${failed.message}`
                      : `Their role is exactly as it was. ${failed.message}`
                  }
                  onDismiss={() => setFailed(null)}
                  onRetry={toggleRole}
                />
              ) : confirming === "role" ? (
                <div className="flex items-center gap-3 rounded-md border border-line px-5 py-2.5">
                  <span className="flex-1 text-sm">
                    Make {person.name.split(" ")[0]}{" "}
                    {nextRole(person.role) === "admin" ? "an admin" : "a co-author"}?
                    {person.role === "user" && " They get a new 6-digit PIN, shown once."}
                  </span>
                  <button type="button" onClick={() => setConfirming(null)} className="font-mono text-xs text-fg-faint">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={toggleRole}
                    disabled={busy === "role"}
                    className="text-accent"
                  >
                    {busy === "role" ? "Changing…" : "Change role"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => setConfirming("role")}
                  disabled={isSelf || isLastAdmin}
                >
                  {person.role === "user"
                    ? "Change role"
                    : person.role === "admin"
                      ? "Make co-author"
                      : "Make admin"}
                  {/*
                    12n. Every guard says why, in place. A tooltip would put
                    the reason somewhere a keyboard cannot reach it, and the
                    reason is the only part that helps: "promote someone else
                    first" is an instruction, "disabled" is a wall.
                  */}
                  <span className="block text-sm text-fg-faint">
                    {isLastAdmin
                      ? "This is the only admin — make someone else an admin first"
                      : isSelf
                        ? "You cannot change your own role"
                        : person.role === "user"
                          ? "Give them a PIN and let them sign in"
                          : person.role === "admin"
                            ? "They keep adding memories, without managing people"
                            : "Full access, including people and deletion"}
                  </span>
                </button>
              )}


              {/*
                What the access axis means right now, said in a sentence
                (frames 12k, 12l, 12m). An admin arrives at this page because
                somebody cannot get in; the state pill alone does not tell
                them what to do about it.
              */}
              {(locked || person.status === "pending" || person.status === "deactivated" ||
                person.status === "remembered") && (
                <p
                  className="mt-4 rounded-[16px] p-[13px_16px] text-[13px] leading-[1.55]"
                  style={{
                    background: "rgba(var(--ink),.04)",
                    color: "rgba(var(--ink),.7)",
                  }}
                >
                  {locked ? (
                    <>
                      Too many wrong PIN attempts. It clears itself in {lockMinutes}{" "}
                      {lockMinutes === 1 ? "minute" : "minutes"} — or{" "}
                      <button
                        type="button"
                        onClick={clearLockout}
                        disabled={busy === "lockout"}
                        className="underline underline-offset-2 disabled:opacity-40"
                        style={{ color: "var(--accent-soft)" }}
                      >
                        {busy === "lockout" ? "clearing…" : "clear it now"}
                      </button>{" "}
                      if they are waiting on the phone. Their PIN still has to be right.
                    </>
                  ) : person.status === "pending" ? (
                    <>
                      The invitation was never completed, so there is no code to reset.
                      Resending it is the way in.
                    </>
                  ) : person.status === "deactivated" ? (
                    <>
                      Paused: they cannot sign in, and their face is{" "}
                      {visible ? "still on" : "off"} her screen. Everything they added stays.
                    </>
                  ) : (
                    <>
                      Kept as a memory. They cannot sign in and Recall does not write to
                      them. Everything they added stays exactly where it is.
                    </>
                  )}
                </p>
              )}

              {/* ── The visibility axis (043, frame 12a) ─────────────────── */}
              <div
                className="mt-4 rounded-[24px] p-[22px_24px]"
                style={{ background: "rgba(0,0,0,.25)", border: "1px solid rgba(var(--ink),.22)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-6">
                  {/*
                    `min-w-0` below `sm`, per 12p (nothing clipped at 390px).

                    A flat `min-w-[280px]` is wider than the 260px this panel
                    actually offers inside its own padding on a 390px screen,
                    so the column pushed 22px past the panel's edge and took
                    the display card's title with it. The floor is only there
                    to stop the switch row wrapping on a desktop, which is a
                    thing that cannot happen on a phone anyway.
                  */}
                  <div className="min-w-0 flex-1 sm:min-w-[280px]">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        aria-label={`Show ${person.name} on the display`}
                        disabled={busy === "visibility"}
                        onClick={toggleVisibility}
                        className="flex h-[28px] w-[48px] flex-none items-center rounded-full px-[3px] transition-colors disabled:opacity-50"
                        style={{
                          background: visible
                            ? "oklch(0.68 0.13 55 / 0.22)"
                            : "rgba(var(--ink),.08)",
                          border: `1px solid ${visible ? "oklch(0.78 0.1 55)" : "rgba(var(--ink),.2)"}`,
                          justifyContent: visible ? "flex-end" : "flex-start",
                        }}
                      >
                        <span className="h-5 w-5 rounded-full" style={{ background: "var(--cream)" }} />
                      </button>
                      <span className="text-[15px]" style={{ color: "var(--fg)" }}>
                        Show on {subjectPossessive(subjectName)} screen
                      </span>
                      <span
                        className="font-mono text-[11px] tracking-[0.12em]"
                        style={{ color: visible ? "var(--cream)" : "var(--fgw-dim)" }}
                      >
                        {busy === "visibility" ? "SAVING" : visible ? "SHOWN" : "HIDDEN"}
                      </span>
                    </div>
                    {/*
                      The switch's own failure (12o). Its whole promise is
                      that it changes nothing but the face on her screen —
                      so a failure has to say the face did not move either,
                      rather than leaving an admin wondering what did.
                    */}
                    {failed?.action === "visibility" && (
                      <p className="mt-3 text-[13px]" style={{ color: "var(--destructive-soft)" }}>
                        We couldn&apos;t change this. Her screen is exactly as it was, and their
                        access was never involved.{" "}
                        <button
                          type="button"
                          onClick={toggleVisibility}
                          className="underline underline-offset-2"
                        >
                          Try again
                        </button>
                      </p>
                    )}
                    <p className="mt-3 text-[13px] leading-[1.6]" style={{ color: "var(--fgw-hint)" }}>
                      {visible
                        ? `She sees their photo and name in her people view.`
                        : `Their face is not on her screen.`}{" "}
                      {/* The reassurance is the point of splitting the axes:
                          hiding a face is not taking anything away. */}
                      Their memories stay either way.
                    </p>
                    {/*
                      12l. Pausing hides by default (043), and the page says
                      so beside the switch — because the switch is still
                      independent, and an admin who wants the face back
                      without handing back the sign-in needs to know that is
                      a thing they can do.
                    */}
                    {person.status === "deactivated" && !visible && (
                      <p className="mt-2 text-[13px] leading-[1.6]" style={{ color: "var(--fgw-hint)" }}>
                        Pausing hid them. You can show them again without giving back their
                        sign-in.
                      </p>
                    )}
                  </div>

                  {/*
                    What the switch is about, shown rather than described (12a,
                    12q). On a phone this sits *underneath* the switch instead
                    of beside it — `flex-wrap` plus a full-width basis below
                    md — because cause and effect have to stay touching, and a
                    390px screen has no room for two columns.

                    It is fed from the channels already loaded, so it is their
                    real first channel and not a drawn stand-in. When the
                    switch is off the card dims and says so: the point of the
                    visibility axis is that this is the only thing that changes.
                  */}
                  <div
                    className="w-full flex-none rounded-[18px] p-[16px_18px] md:w-[210px]"
                    style={{
                      background: "rgba(var(--ink),.04)",
                      border: "1px solid rgba(var(--ink),.1)",
                      opacity: visible ? 1 : 0.45,
                      transition: "opacity .18s",
                    }}
                  >
                    <p className="label-caps" style={{ color: "var(--fgw-dim)" }}>
                      On her screen
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      {person.profile_picture_url ? (
                        <img
                          src={person.profile_picture_url}
                          alt=""
                          className="h-11 w-11 flex-none rounded-full object-cover"
                        />
                      ) : (
                        <InitialsAvatar name={person.name} size={44} />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[14px]" style={{ color: "var(--fg)" }}>
                          {person.name}
                        </p>
                        <p
                          className="truncate font-mono text-[10px] tracking-[0.12em]"
                          style={{ color: "var(--fgw-dim)" }}
                        >
                          {/*
                            "NO CHANNEL YET" is a claim about them, so it
                            needs a successful read behind it (M222). The
                            guarding operand was destructured eleven lines
                            from here and never consulted, so a failed
                            /channels request rendered as a statement that
                            this person has made nothing — the same lie the
                            contribution block told, on the same page.
                          */}
                          {channelsLoading || channelsFailed
                            ? "—"
                            : theirChannels[0]
                              ? `CH ${String(theirChannels[0].number).padStart(2, "0")} · ${theirChannels[0].title.toUpperCase()}`
                              : "NO CHANNEL YET"}
                        </p>
                      </div>
                    </div>
                    <p
                      className="mt-3 text-[12px] leading-[1.5]"
                      style={{ color: "var(--fgw-dim)" }}
                    >
                      {visible
                        ? "Her people view, as it looks now."
                        : "Not in her people view."}
                    </p>
                  </div>
                </div>
              </div>

              {/*
                THE FENCE (12q). Everything above is an everyday errand — edit
                a profile, hand out a PIN. These two are not, and on a phone a
                flat list makes the last row look like more of the same. The
                border is the whole point: it says the list ended and something
                else began, and it is why "Pause access" no longer sits next to
                "Make admin" as though they were the same weight of decision.

                The heading is what an admin is actually here to do, and the
                line under it is the reassurance they need before doing it.
              */}
              <div
                className="mt-6 rounded-[20px] p-[18px_18px_20px]"
                style={{ border: "1px solid rgba(var(--ink),.14)" }}
              >
                <p className="label-caps" style={{ color: "var(--fgw-dim)" }}>
                  If something changes
                </p>
                <p className="mt-1.5 text-[13px]" style={{ color: "var(--fgw-quiet)" }}>
                  Memories stay. Neither of these removes anything they added.
                </p>
                <div className="mt-4 grid gap-3">
              {/*
                12j. Absent for a `user`, not disabled. Pausing blocks
                sign-in, and this profile has no sign-in to block — the row
                would be a control over nothing, which is worse than no
                control at all.
              */}
              {failed?.action === "status" ? (
                <FailureRow
                  what="We couldn't change their access. Nothing changed."
                  stillTrue={
                    person.status === "deactivated"
                      ? `They still cannot sign in, and everything they added is untouched. ${failed.message}`
                      : `They can still sign in, and everything they added is untouched. ${failed.message}`
                  }
                  onDismiss={() => setFailed(null)}
                  onRetry={toggleStatus}
                />
              ) : person.role !== "user" && (confirming === "status" ? (
                <div className="flex items-center gap-3 rounded-md border border-line px-5 py-2.5">
                  <span className="flex-1 text-sm">
                    {closed
                      ? `Let ${person.name.split(" ")[0]} sign in again?`
                      : `Pause ${person.name.split(" ")[0]}’s access? They can’t sign in and ${subjectName?.trim() || "she"} won’t see them. Everything they added stays, and you can undo this at any time.`}
                  </span>
                  <button type="button" onClick={() => setConfirming(null)} className="font-mono text-xs text-fg-faint">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={toggleStatus}
                    disabled={busy === "status"}
                    style={{
                      color: closed ? "var(--accent)" : "var(--destructive-soft)",
                    }}
                  >
                    {busy === "status" ? "Saving…" : closed ? "Restore access" : "Pause access"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={ACTION}
                  onClick={() => setConfirming("status")}
                  disabled={isSelf || isLastAdmin}
                  style={
                    person.status === "deactivated" ? undefined : { borderColor: "var(--line)" }
                  }
                >
                  {/*
                    12n is precise about this: the destructive colour comes off
                    when the control cannot fire. Red on a dead button teaches
                    people that red means nothing here.
                  */}
                  <span
                    style={{
                      /*
                        12l: "the fence row inverts to Restore access in
                        cream — undoing is not a destructive act, so it does
                        not wear the destructive colour." And 12n: the colour
                        comes off entirely when the control cannot fire, so
                        red never appears on a dead button.
                      */
                      color:
                        isSelf || isLastAdmin || person.status === "deactivated"
                          ? "var(--fg)"
                          : "var(--destructive-soft)",
                    }}
                  >
                    {/*
                      The frames call these "Pause access" and "Restore
                      access" (12l, 12n, 12q). "Deactivate profile" describes
                      a database row; the thing an admin is doing is closing
                      a door, and the profile is not going anywhere.
                    */}
                    {person.status === "deactivated" ? "Restore access" : "Pause access"}
                  </span>
                  <span className="block text-sm text-fg-faint">
                    {isLastAdmin
                      ? "This is the only admin — make someone else an admin first"
                      : isSelf
                        ? "You cannot pause yourself"
                        : person.status === "deactivated"
                          ? "They can sign in again with the PIN they already have. Nothing they added changed while they were paused."
                          : "They can’t sign in. Everything they added stays. You can undo this at any time."}
                  </span>
                </button>
              ))}
              {/*
                12g/12h. Once somebody is remembered, the fence stops
                offering the action and states the fact instead — with a way
                back, because the frames are explicit that an admin can undo
                it. A row that has already happened is not a control.
              */}
              {person.status === "remembered" && (
                <div
                  className="mt-4 rounded-[16px] p-[15px_17px]"
                  style={{ border: "1px solid var(--remembered-line)" }}
                >
                  <p className="text-[14px]" style={{ color: "var(--accent-soft)" }}>
                    Remembered
                  </p>
                  <p className="mt-1.5 text-[13px] leading-[1.55] text-fg-muted">
                    Their sign-in is closed and their memories stay in the archive. They are still
                    on {subjectPossessive(subjectName)} screen if the switch above is on.
                  </p>
                  {/*
                    Deliberately no "since 9 August, marked by Andy" (12g).
                    Nothing records when the status changed or who changed
                    it, and inventing either from `updated_at` would put a
                    date and a name on the most sensitive row on the page.
                    The activity log is where that belongs when it exists.
                  */}
                  <button
                    type="button"
                    onClick={() => setConfirming("status")}
                    disabled={busy === "status"}
                    className="mt-3 text-[13px] underline underline-offset-2 disabled:opacity-40"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {busy === "status" ? "Undoing…" : "Undo"}
                  </button>
                </div>
              )}

              {person.status !== "remembered" && (
                <div className="mt-4">
                  {failed?.action === "remembered" ? (
                    <FailureRow
                      what="We couldn't mark them as remembered. Nothing changed."
                      stillTrue={`Their profile is exactly as it was, and so is everything they added. ${failed.message}`}
                      onDismiss={() => setFailed(null)}
                      onRetry={setRemembered}
                    />
                  ) : confirming === "remembered" ? (
                    <div
                      className="rounded-[16px] p-4"
                      style={{
                        border: "1px solid oklch(0.68 0.13 55 / 0.4)",
                        background: "oklch(0.68 0.13 55 / 0.07)",
                      }}
                    >
                      <p className="text-[14px]" style={{ color: "var(--accent-soft)" }}>
                        Mark {person.name} as remembered?
                      </p>
                      <p className="mt-1.5 text-[13px] leading-[1.55] text-fg-muted">
                        They will no longer be able to sign in, and Recall stops writing to
                        them. Everything they added — every photograph, every caption, their
                        name on the channels they made — stays exactly where it is.
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={setRemembered}
                          disabled={busy === "remembered"}
                          className="rounded-full px-4 py-2 text-[13px] font-medium leading-none disabled:opacity-40"
                          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                        >
                          {busy === "remembered" ? "Saving…" : "Mark as remembered"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="text-[13px] text-fg-faint hover:text-fg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming("remembered")}
                      disabled={isSelf || isLastAdmin}
                      className="w-full rounded-[16px] p-[15px_17px] text-left disabled:opacity-60"
                      style={{ border: "1px solid rgba(var(--ink),.12)" }}
                    >
                      {/*
                        Drawn disabled rather than hidden (12n). A row that
                        vanishes on your own profile teaches nothing; a row
                        that says "not for your own profile" teaches what the
                        state is for, and it keeps the list the same length
                        whoever you are looking at.
                      */}
                      <span
                        style={{
                          color: isSelf || isLastAdmin ? "var(--fg-faint)" : "var(--accent-soft)",
                        }}
                      >
                        Mark as remembered
                      </span>
                      <span className="block text-sm text-fg-faint">
                        {isSelf
                          ? "Not for your own profile"
                          : isLastAdmin
                            ? "This is the only admin — make someone else an admin first"
                            : "For someone no longer part of the family — removes their access, keeps everything they made"}
                      </span>
                    </button>
                  )}
                </div>
              )}
                </div>
              </div>
            </div>
          </div>
          {/*
            PRIVATE — ADMINS ONLY (12c, 12i, 12l), and it belongs INSIDE this
            column, last.

            It was rendered outside the two-column grid, so it spanned the
            whole page as a slab wider than everything above it and read as a
            floating panel rather than the final section of a record. 12a puts
            it where the other blocks are — DETAILS, CONTRIBUTION, ACCESS,
            ACTIONS, then this — hairline-separated, scrolling with the rest.
            Still admin-only, still last, and now the same width as the facts
            it sits under.
          */}
          </div>
        </div>
      </div>


      {newPin && (
        <PinRevealDialog
          pin={newPin.pin}
          name={person.name}
          email={person.email}
          emailSent={newPin.emailSent}
          subject={subjectName?.trim() || "the family"}
          /*
            No `onRetryEmail`, and that is a deliberate deviation from 12d.

            The frame draws "Try again" beside the failed-email line, which
            reads as "send that code again". Recall cannot do that: the PIN is
            shown once and only its hash is kept, so the only thing behind
            that button would be issuing a NEW code — silently changing the
            digits the admin is reading off the screen, directly under a
            sentence that says "Shown once".

            The failure line already carries the whole instruction: the code
            above still works, pass it on yourself. A button that appears to
            retry and actually re-rolls is worse than no button.
          */
          onClose={() => setNewPin(null)}
        />
      )}
    </PageFrame>
  );
}
