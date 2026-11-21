import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { PinInput } from "@/components/login/PinInput";
import { PinCard } from "@/components/login/PinCard";
import {
  ChooserHeader,
  ScreenPill,
  ChooserShell,
  FirstTimeTile,
  ProfileTile,
  SeeMoreCard,
  splitForDensity,
  type ChooserPerson,
} from "@/components/login/ChooserShell";
import { Monitor } from "lucide-react";
import { useIsMobile } from "@/mobile/useIsMobile";
import { useDoorTheme } from "@/lib/useWorkspaceTheme";

/**
 * Who is this, signed in from somewhere else — frames 2a/2b (M108, absorbing
 * M40, M61, M67, M80, M110).
 *
 * Not the kiosk chooser — she is not on this list at all, by design, and the
 * person holding this device is standing up somewhere. The desktop wears the
 * 20a system now: card tiles with name · relationship · role, a dashed
 * "First time here?" door for the invited-but-not-set-up, and the display's
 * own status stated once — "profiles are for the family; her frame just
 * keeps playing."
 *
 * What the frames did not draw but the page must not lose: M79's guard (no
 * session → /login), M80's held selection and under-wordmark Back, M67's
 * pending tiles ("invited — not joined yet" is a true fact with a real next
 * action), the lock state, and the sign-out foot whose price M111 set. The
 * frame's "Ask to join the family" footer is deliberately absent: its flow
 * (4b, a request to the family owner) is not built, and a drawn control that
 * does nothing is the lie the register exists to prevent (F26).
 */

interface FamilyProfile {
  id: string;
  name: string;
  relationship: string | null;
  role: "admin" | "co_author";
  /** The photograph they chose for themselves, or null. */
  photo_url: string | null;
  locked: boolean;
  /** A face nobody has claimed yet cannot be entered from out here. */
  claimable: boolean;
}

/**
 * Somebody's actual face, when they have given one.
 *
 * "Who's here?" is a question answered fastest by recognition, and the
 * people on this list have already chosen photographs of themselves — the
 * chooser was drawing initials over them. Initials remain the honest
 * fallback for a profile with no picture, and for one whose picture fails
 * to load: a broken-image glyph on the sign-in screen would be worse than
 * the letter it replaced.
 */
function Face({
  person,
  size,
  ring,
}: {
  person: { name: string; photo_url: string | null; role: string };
  size: number;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!person.photo_url || failed) {
    return <InitialsAvatar name={person.name} size={size} ring={ring ?? person.role === "admin"} />;
  }

  return (
    <img
      src={person.photo_url}
      alt=""
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        ...((ring ?? person.role === "admin") ? { boxShadow: "0 0 0 4px var(--accent-tint)" } : {}),
      }}
      className="flex-none rounded-full object-cover"
    />
  );
}

export function FamilyProfilesPage() {
  /* Every door follows the colour the person chose (owner, 17 Sep 2026). */
  const { attrs: doorAttrs } = useDoorTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh, profile: signedIn, signOut } = useAuth();
  const { subjectName } = useDisplay();
  const compact = useIsMobile();
  // The chip carries where it was pressed, so changing your mind is free (M61).
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null;

  const [selected, setSelected] = useState<FamilyProfile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Where the held selection stands (M80/F27b). Null until the pointer or
   * keyboard first moves it, so the ring opens on the signed-in face — and
   * then it stays wherever it was last put.
   */
  const [held, setHeld] = useState<string | null>(null);
  /*
   * Whether the grid is showing the overflow (7f). Declared here with the
   * other hooks, above every early return, so the hook count never changes
   * between renders (M60) — the trap that blanks the chooser on the one
   * screen nobody can read an error on.
   */
  const [seeingMore, setSeeingMore] = useState(false);

  /*
    `isPending`, not `isLoading` (M202, following M191).

    The guard at "no profiles yet" is `!isLoading && profiles.length === 0`,
    and `isLoading` is false for a query parked between retries — so the
    chooser could tell a family that nobody is on their shelf while it was
    still waiting to find out. On the page whose entire job is to list the
    people, that reads as the archive having lost them.
  */
  const { data, isPending: isLoading, isError } = useQuery({
    queryKey: ["family", "profiles"],
    queryFn: () => api.get<{ profiles: FamilyProfile[]; display_name: string | null }>("/family/profiles"),
    retry: false,
  });

  /*
   * An empty list and a failed request are not the same thing (M77/M79).
   */
  useEffect(() => {
    if (isError) navigate("/login", { replace: true });
  }, [isError, navigate]);

  const subject = subjectName?.trim() || null;

  async function enter(person: FamilyProfile, code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ redirect_to: string }>(`/family/profiles/${person.id}/enter`, {
        pin: code,
      });
      await refresh();
      navigate(res.redirect_to, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That PIN is not right.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  /*
   * One press, one meaning, at every width. A pending member is not a dead
   * row (M67): "invited — not joined yet" is a true fact with a real next
   * action, so pressing it goes where that action lives.
   */
  function press(person: FamilyProfile) {
    if (!person.claimable) {
      navigate("/admin/contributors/invite", { state: { personId: person.id } });
      return;
    }
    setSelected(person);
    setPin("");
    setError(null);
  }

  function fact(person: FamilyProfile): string {
    return person.locked
      ? "Locked for a few minutes"
      : !person.claimable
        ? "Invited — not joined yet"
        : person.role === "admin"
          ? "Administrator"
          : "Co-author";
  }

  function label(person: FamilyProfile): string {
    return !person.claimable
      ? `${person.name} — invited, not joined yet. Invite again`
      : `${person.name} — ${person.role === "admin" ? "administrator" : "co-author"}`;
  }

  const profiles = data?.profiles ?? [];

  // ------------------------------------------------------------- 2b · PIN
  if (selected) {
    // The reset path goes through another admin — no email flows here (2b).
    const otherAdmin = profiles.find(
      (p) => p.role === "admin" && p.id !== selected.id && p.claimable
    );
    const first = selected.name.trim().split(/\s+/)[0];

    return (
      <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast flex h-full flex-col overflow-hidden px-8 pb-8 pt-6 md:px-9">
        {/* The chooser's own header, unchanged — picking a profile must not
            rearrange the top of the page (owner). The circled back-arrow is
            "back to profiles"; it replaces the old text link and the
            "Switch profile" twin, which said the same thing twice. */}
        <ChooserHeader
          onBack={() => {
            setSelected(null);
            setPin("");
            setError(null);
          }}
          screen={
            data?.display_name
              ? { display_name: data.display_name, current_channel_number: undefined }
              : null
          }
        />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <PinCard
            avatar={<Face person={selected} size={100} />}
            title={`Hi ${first}`}
            subtitle={`Enter your PIN to open ${subject ? `${subject}'s` : "the family"} archive.`}
            footer={
              <>
                Forgot your PIN?{" "}
                <span style={{ color: "rgba(var(--ink-cream),.85)" }}>
                  Ask {otherAdmin ? otherAdmin.name.trim().split(/\s+/)[0] : "an administrator"} to
                  reset it
                </span>
              </>
            }
          >
            <PinInput
              value={pin}
              onChange={(next) => {
                // The verdict was about the code they just tried; typing a
                // new one makes it history (M72).
                if (error) setError(null);
                setPin(next);
              }}
              onComplete={(code) => {
                if (!busy) void enter(selected, code);
              }}
              state={error ? "error" : "idle"}
              disabled={busy}
            />

            <p
              role="alert"
              className="mt-5 h-5 text-sm"
              style={{
                visibility: error || busy ? "visible" : "hidden",
                color: error ? "var(--destructive-soft)" : "var(--fg-faint)",
              }}
            >
              {busy ? "Checking…" : error || " "}
            </p>
          </PinCard>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------- phone: the list
  if (compact) {
    return (
      <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast mx-auto flex h-full w-full max-w-[420px] flex-col px-6">
        <div className="flex-none pb-7 pt-10 text-center">
          {cameFrom && (
            <button
              type="button"
              onClick={() => navigate(cameFrom)}
              className="float-left font-mono text-[11px] tracking-[0.14em] text-fg-faint hover:text-fg"
            >
              ← BACK
            </button>
          )}
          <p className="text-[22px] font-bold tracking-tight">Who's here?</p>
          <p className="mt-1 text-[13px] text-fg-muted">
            Your PIN says which of you is here.
          </p>

          {/*
            The screen's name, which this header alone was missing (M146,
            reinstated by M166).

            Every other face of the chooser names the family's screen — the
            desktop list, and the PIN step on this very phone. Only the phone
            list left it out, so the name appeared, vanished, and came back
            as you moved through one flow. It is placed under the title
            rather than beside a wordmark, because this compact header has no
            wordmark to sit beside.

            No channel number is passed, deliberately: a remote page knows
            what the screen is called and not what it is showing, and an
            absent number renders as the name alone rather than a claimed
            status.
          */}
          {data?.display_name && (
            <div className="mt-4 flex justify-center">
              <ScreenPill
                screen={{ display_name: data.display_name, current_channel_number: undefined }}
              />
            </div>
          )}
        </div>

        {/* The page holds still; the list moves. */}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {isLoading && <p className="py-10 text-center text-sm text-fg-muted">Loading…</p>}

          {profiles.map((p) => {
            const pending = !p.claimable;
            return (
              <button
                key={p.id}
                type="button"
                disabled={p.locked}
                aria-label={label(p)}
                onClick={() => press(p)}
                className="mb-2.5 flex w-full items-center gap-3.5 rounded-[16px] border border-line-soft p-3 text-left disabled:opacity-40"
              >
                <Face person={p} size={44} />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{p.name}</span>
                  <span className="block text-xs text-fg-faint">
                    {p.relationship ? `${p.relationship} · ` : ""}
                    {fact(p)}
                  </span>
                  {p.id === signedIn?.id && (
                    <span
                      className="mt-0.5 block font-mono text-[9px] tracking-[0.2em]"
                      style={{ color: "var(--accent)" }}
                    >
                      YOU
                    </span>
                  )}
                </span>

                {pending && (
                  <span className="flex-none text-[12px]" style={{ color: "var(--accent)" }}>
                    Invite again →
                  </span>
                )}
              </button>
            );
          })}

          {/* The join door, on the phone too — the device most invites are
              opened on. */}
          {!isLoading && (
            <button
              type="button"
              onClick={() => navigate("/join")}
              className="mb-2.5 flex w-full items-center gap-3.5 rounded-[16px] p-3 text-left"
              style={{ border: "1px dashed rgba(var(--ink),.25)" }}
            >
              <span
                className="door-contrast flex h-11 w-11 flex-none items-center justify-center rounded-full text-xl font-light"
                style={{ border: "1px dashed rgba(var(--ink),.3)", color: "rgba(var(--ink-cream),.6)" }}
              >
                +
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium" style={{ color: "rgba(var(--ink-cream),.85)" }}>
                  First time here?
                </span>
                <span className="block text-xs text-fg-faint">
                  Invited but not set up yet? Enter your code.
                </span>
              </span>
            </button>
          )}

          {!isLoading && profiles.length === 0 && (
            <p className="py-10 text-center text-sm text-fg-muted">
              Nobody in this family has a PIN yet.
            </p>
          )}
        </div>

        <div className="flex-none border-t border-line-soft py-4">
          <button
            type="button"
            onClick={() => {
              void signOut().then(() => navigate("/login", { replace: true }));
            }}
            className="w-full text-center font-mono text-[10px] tracking-[0.14em] text-fg-faint hover:text-fg"
          >
            {/*
              The remote truth, not the screen's (M166/F61).

              This said "SIGN THIS DEVICE OUT — THE FAMILY PASSWORD SIGNS IT
              BACK IN", which describes replacing the family's screen (M117):
              a trusted machine relinquishing its place, won back by a
              ceremony. A phone is not that. It holds a remote family
              session, it signs out like any browser, and it signs back in
              the ordinary way — password, profile, PIN. Borrowing
              device-tier language for it promised a ceremony that would
              never happen and implied this phone was the family's screen.

              The desktop path has said "Log out of this family" since the
              owner-directed log-out work; this is the same sentence, in the
              phone's own voice.
            */}
            LOG OUT OF THIS FAMILY
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------ 2a · the desktop
  //
  // The same ChooserShell the device renders (owner-directed uniformity):
  // identical header, circled back, screen pill, family grid, First-time
  // tile and sign-out foot. The one thing absent here is the subject's
  // hand-back card — her face is never sent to a remote device, so this
  // route shows the family and nothing of hers.
  const toPerson = (pp: FamilyProfile): ChooserPerson => ({
    id: pp.id,
    name: pp.name,
    relationship: pp.relationship,
    role: pp.role,
    photoUrl: pp.photo_url,
    locked: pp.locked,
    pending: !pp.claimable,
    isYou: pp.id === signedIn?.id,
  });

  // Six cells, capped (7f): the tail past five folds behind "See more".
  const { shown, hidden } = splitForDensity(profiles);

  return (
    <ChooserShell
      title="Who's here?"
      subtitle={`Profiles are for the family — ${subject ? `${subject}'s` : "the"} frame just keeps playing.`}
      onBack={cameFrom ? () => navigate(cameFrom) : undefined}
      // The remote page knows the screen's name but not what is playing
      // (M146) — undefined channel means "name only", never a claimed status.
      screen={
        data?.display_name
          ? { display_name: data.display_name, current_channel_number: undefined }
          : null
      }
      onSignOut={() => void signOut().then(() => navigate("/login", { replace: true }))}
      footNote="Not on the shelf? Someone in the family adds you — Recall is invitation-only."
      /*
        Setup, in the corner where setup belongs (F44).

        Small and quiet on purpose: on this page the act is choosing a
        profile, and handing a machine the family's one screen is a thing
        somebody does once. It sits opposite the log-out — the two controls
        that are about this *browser* rather than about who is using it.

        Desktop only, and that is a decision rather than an omission. The
        phone chooser does not get it: a family has one screen slot, taking
        it back needs an emailed link, and a button that lets somebody spend
        that slot on the phone in their hand is a trap — not a smaller
        version of this one.
      */
      corner={
        <button
          type="button"
          onClick={() => navigate("/screen-setup")}
          className="flex items-center gap-2 rounded-full px-3.5 py-2 font-mono text-[10px] tracking-[0.14em] transition-colors hover:bg-white/[0.06]"
          style={{ border: "1px solid rgba(var(--ink),.12)", color: "rgba(var(--ink-cream),.5)" }}
        >
          <Monitor size={13} strokeWidth={1.8} aria-hidden />
          MAKE MAIN DISPLAY
        </button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody in this family has a PIN yet.</p>
      ) : (
        <div className="grid grid-cols-3 content-start gap-4">
          {/*
            The grid is six cells and never grows (7f): past five people the
            fifth becomes a "See more" stack and the tail folds behind it, so
            the chooser stays two rows and never runs under the foot — the
            overflow the many-contributor family hit. No Margaret here (she is
            device-only), so all six cells are the family's.
          */}
          {(seeingMore ? hidden : shown).map((p) => (
            <ProfileTile
              key={p.id}
              person={toPerson(p)}
              held={p.id === (held ?? signedIn?.id)}
              onHold={() => setHeld(p.id)}
              onPick={() => press(p)}
            />
          ))}
          {!seeingMore && hidden.length > 0 && (
            <SeeMoreCard
              hidden={hidden.map((p) => ({ id: p.id, name: p.name }))}
              total={profiles.length}
              onOpen={() => setSeeingMore(true)}
            />
          )}
          {!seeingMore && <FirstTimeTile onClick={() => navigate("/join")} />}
        </div>
      )}
    </ChooserShell>
  );
}
