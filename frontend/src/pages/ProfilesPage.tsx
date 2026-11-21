import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth, type Role } from "@/context/AuthContext";
import { useScreenState } from "@/hooks/useAdminData";
import { useIsHandheld } from "@/lib/kioskFit";
import { PinInput } from "@/components/login/PinInput";
import { PinCard } from "@/components/login/PinCard";
import {
  ChooserHeader,
  ChooserShell,
  FirstTimeTile,
  GROUND,
  ProfileTile,
  SubjectCard,
  type ChooserPerson,
  SeeMoreCard,
  splitForDensity,
} from "@/components/login/ChooserShell";
import { useWorkspaceTheme } from "@/lib/useWorkspaceTheme";

interface Profile {
  id: string;
  name: string;
  relationship: string | null;
  role: Role;
  requires_pin: boolean;
  locked: boolean;
  photo_url: string | null;
}

function Avatar({
  profile,
  size,
  ring,
}: {
  profile: Profile;
  size: number;
  ring?: boolean;
}) {
  const style = {
    width: size,
    height: size,
    // A circle may not be squashed: inside the chooser's flex column, a short
    // viewport would otherwise shrink the fixed height and turn faces into
    // pills.
    flexShrink: 0,
    // The admin's mark: thick but quiet — the accent at tint strength, so it
    // reads as a role, never as a selection (M53).
    ...(ring ? { boxShadow: "0 0 0 4px var(--accent-tint)" } : {}),
  };

  return profile.photo_url ? (
    <img
      src={profile.photo_url}
      alt=""
      style={style}
      className="rounded-full object-cover"
    />
  ) : (
    <span
      aria-hidden
      style={{ ...style, fontSize: size / 3 }}
      className="flex items-center justify-center rounded-full bg-white/10 font-medium"
    >
      {profile.name.charAt(0)}
    </span>
  );
}

/**
 * Level 2 — who is at the keyboard, on the family screen itself.
 *
 * One profile selector, everywhere (owner-directed): this and the remote
 * chooser both render through `ChooserShell`, so a road never lands on a
 * screen that looks a little different. What stays its own is only what the
 * device is *allowed* to show — the subject's hand-back card lives here, on
 * her trusted screen, and never on a remote phone — never how it is drawn.
 */
export function ProfilesPage() {
  const navigate = useNavigate();
  /* The chooser keeps the person's colour on every one of its states —
     loading and PIN entry included, or the ground would change under them
     mid-sign-in. */
  const { attrs: themeAttrs } = useWorkspaceTheme();
  const location = useLocation();
  const { unlockProfile, profile: signedIn, signOut } = useAuth();
  const signedInId = signedIn?.id ?? null;
  // Where the chip was pressed, so the chooser can hand you back (M61).
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null;
  // The corner states the screen's own status, not the hour (owner-directed).
  const { data: screen } = useScreenState();
  // Whether to offer the screen-move ceremony at the foot at all (M192).
  const handheld = useIsHandheld();
  // The header's switcher can arrive asking for one person's PIN directly.
  const preselected = useRef(false);

  const [selected, setSelected] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "error" | "success">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Where the held selection stands (M80/F27b) — the 2a idiom: the highlight
   * is a selection that stays where the pointer last stood, opening on the
   * subject, whose card is the one this screen exists for.
   */
  const [held, setHeld] = useState<string | null>(null);
  /*
   * Declared up here with the others, and not beside the grid it belongs to.
   *
   * It used to sit below the `isLoading` early return, so the chooser called
   * one fewer hook while the profiles were still arriving and one more once
   * they had — and React refuses a component whose hook count changes between
   * renders. On the family screen that is the `99` chooser throwing instead
   * of drawing, in the one room where nobody can read an error.
   */
  const [seeingMore, setSeeingMore] = useState(false);

  /*
    The emailed setup link that moves Recall to a new screen (M117), requested
    from here since 9a. Gated by the family inbox exactly as before — this asks
    for no password and changes nothing about the chooser.
  */
  const [ceremonySent, setCeremonySent] = useState(false);
  const [ceremonyError, setCeremonyError] = useState<string | null>(null);
  async function requestCeremonyLink() {
    setCeremonyError(null);
    try {
      await api.post("/family/replace-screen", {});
      setCeremonySent(true);
    } catch (err) {
      /*
        A refusal here is real and must be shown (F-review).

        This used to report success on every path, on the reasoning that the
        route answers the same either way. That is true of *whether the
        address exists* and of nothing else: `api.ts` throws on a 429, and a
        rate-limited request landed in a catch that announced the email was on
        its way. The screen said a link had been sent while no token had been
        minted — the same shape as the empty body this call used to send, one
        level up. A control that claims to have worked is worse than one that
        admits it did not.
      */
      setCeremonyError(
        err instanceof Error ? err.message : "The link could not be sent. Try again in a moment."
      );
    }
  }

  /*
    `isPending`, not `isLoading` (M205, following M191). A query parked
    between retries reports `isLoading: false` with no data, so the guard
    below fell through and the chooser drew itself with nobody on it — on
    the page whose entire job is to list the people in the family.
  */
  const { data: profiles, isPending: isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<Profile[]>("/auth/profiles"),
  });

  const enter = useCallback(
    async (profile: Profile, code?: string) => {
      setBusy(true);
      try {
        const res = await unlockProfile(profile.id, code);
        setState("success");
        setMessage(`Hello, ${profile.name}`);
        setTimeout(() => navigate(res.redirect_to, { replace: true }), 600);
      } catch (err) {
        const text = err instanceof Error ? err.message : "Wrong code.";

        // Too many wrong codes locks the profile server-side, but the screen
        // never says so: no countdown, no "locked" — the dots shake once and
        // the display simply returns to Margaret. Whoever forgot their PIN
        // asks an admin; her screen is not the place to wait out a timer.
        if (/locked|too many/i.test(text)) {
          setState("error");
          setMessage(null);
          setPin("");
          setTimeout(async () => {
            // Her profile by its role, not by "whichever face needs no
            // PIN": the list is sorted by name, and anything else that
            // looked PIN-free would be tried first and leave the chooser up.
            const home = profiles?.find((p) => p.role === "user");
            if (home) {
              try {
                const res = await unlockProfile(home.id);
                navigate(res.redirect_to, { replace: true });
                return;
              } catch {
                /* fall back to the chooser */
              }
            }
            setSelected(null);
            setState("idle");
          }, 900);
          return;
        }

        setState("error");
        setMessage(text);
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [navigate, unlockProfile, profiles]
  );

  function choose(profile: Profile) {
    setMessage(null);
    setState("idle");
    setPin("");

    // A profile without a PIN opens straight away.
    if (!profile.requires_pin) {
      void enter(profile);
      return;
    }
    setSelected(profile);
  }

  useEffect(() => {
    if (selected && pin.length === 6 && !busy) void enter(selected, pin);
  }, [pin, selected, busy, enter]);

  useEffect(() => {
    const wanted = (location.state as { selectId?: string } | null)?.selectId;
    if (!wanted || preselected.current || !profiles) return;
    const target = profiles.find((p) => p.id === wanted);
    if (target) {
      preselected.current = true;
      choose(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, location.state]);

  if (isLoading) {
    return (
      <div {...themeAttrs} className="door-contrast flex h-dvh items-center justify-center text-fg-muted" style={GROUND}>
        Loading…
      </div>
    );
  }

  const subject = profiles?.find((p) => p.role === "user");
  const others = profiles?.filter((p) => p.role !== "user") ?? [];

  /*
    Density (7f). The grid is six cells and never grows; the sixth is always
    "First time here?", so five are left for people. Past five, the fifth
    becomes the See more card and the tail stacks behind it. Margaret is
    outside the grid at every density and is not counted — "no Margaret, no
    repeats" is 7g's own caption.
  */
  const { shown, hidden } = splitForDensity(others);

  // ------------------------------------------------------------ PIN entry
  if (selected) {
    return (
      <div {...themeAttrs} className="door-contrast flex h-dvh flex-col overflow-hidden px-8 pb-8 pt-6 md:px-9" style={GROUND}>
        <ChooserHeader
          onBack={() => {
            setSelected(null);
            setPin("");
            setMessage(null);
          }}
          screen={screen}
        />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <PinCard
            avatar={<Avatar profile={selected} size={104} ring={selected.role === "admin"} />}
            title={selected.name}
            subtitle="Your 6-digit PIN"
            footer={
              <>
                Forgot your PIN?{" "}
                <span style={{ color: "rgba(var(--ink-cream),.85)" }}>Ask an administrator to reset it</span>
              </>
            }
          >
            <PinInput
              value={pin}
              onChange={(next) => {
                /*
                 * The verdict clears on the person's own action, not on a clock
                 * (M72): fresh digits must never paint red under a stale
                 * "Wrong code".
                 */
                if (state === "error") {
                  setState("idle");
                  setMessage(null);
                }
                setPin(next);
              }}
              state={state}
              disabled={busy}
            />

            {/* Always present: text appearing must never re-centre the column. */}
            <p
              role={state === "error" ? "alert" : "status"}
              className="mt-5 h-6 text-base"
              style={{
                color: state === "error" ? "var(--destructive-soft)" : "var(--fg-muted)",
                visibility: message ? "visible" : "hidden",
              }}
            >
              {message || " "}
            </p>
          </PinCard>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ chooser
  const toPerson = (pf: Profile): ChooserPerson => ({
    id: pf.id,
    name: pf.name,
    relationship: pf.relationship,
    role: pf.role === "admin" ? "admin" : "co_author",
    photoUrl: pf.photo_url,
    locked: pf.locked,
    // Every face on the trusted device is claimed — the chooser only lists
    // people who already have a PIN.
    pending: false,
    isYou: pf.id === signedInId,
  });

  return (
    <ChooserShell
      title="Who's here?"
      /*
        Opened, the See more card turns the grid into 7g: only the people it
        was hiding, and the back arrow returns to the shelf rather than off
        the page. Margaret and the four already shown are not repeated —
        showing a face twice would make the second one look like a different
        person.
      */
      subtitle={
        seeingMore
          ? `${hidden.length} more ${hidden.length === 1 ? "contributor" : "contributors"} — everyone else is on the shelf.`
          : subject
            ? `Pick your profile — or hand the main screen back to ${subject.name}.`
            : "Pick your profile."
      }
      onBack={
        seeingMore
          ? () => setSeeingMore(false)
          : cameFrom
            ? () => navigate(cameFrom)
            : undefined
      }
      screen={screen}
      /*
        The sign-out is on the chooser, on every device, at the owner's word.
        It was once suppressed on her own screen (M29) so a display could not
        strand itself; the owner has asked for it here regardless — an admin
        signing the family screen out is a deliberate act, and the way back is
        the family password on the same machine.
      */
      onSignOut={() => void signOut().then(() => navigate("/login", { replace: true }))}
      /*
        The replacement ceremony's door, rehoused (9a).

        It used to sit on the public sign-in page, which was the wrong side of
        the lock: moving Recall to a new screen is setup, and setup belongs to
        someone the archive has already recognised (F44). 9a deletes it from
        the front door and says it "now lives behind sign-in", which is here.

        It moved BEFORE it was deleted there, deliberately. This is the only
        place in the product that can *request* the emailed link, so removing
        it without a new home would have left the ceremony reachable only by
        someone already holding a link to it — a door you can open only if you
        are already inside.
      */
      footNote={
        ceremonySent ? (
          <span role="status">
            The link is on its way to the family email. Open it on this screen —
            the old screen is retired the moment this one takes over.
          </span>
        ) : ceremonyError ? (
          <span role="alert" className="text-destructive-soft">
            {ceremonyError}
          </span>
        ) : (
          <>
            Not on the shelf? Someone in the family adds you — Recall is
            invitation-only.{" "}
            {/*
              The offer is not made on a phone (M192).

              This is the door to the ceremony that retires the screen in
              Margaret's living room, and a phone can never be its
              replacement. Offering it anyway would mean walking somebody
              through requesting a link, waiting for the email, opening it,
              and only then being refused — a refusal at the end of an
              errand rather than before it. The same reasoning as M196's
              door: refuse before the work, not after.

              The refusal is `ReplaceScreenPage`'s, not this one's, because
              the link can be opened anywhere. Hiding the offer is courtesy;
              the gate is there.
            */}
            {!handheld && (
              <button
                type="button"
                onClick={() => void requestCeremonyLink()}
                className="underline underline-offset-2 hover:text-fg"
              >
                Moving Recall to this screen?
              </button>
            )}
          </>
        )
      }
    >
      {/*
        Side by side is the TV's luxury; a phone stacks (owner-directed).

        The set is capped and centred (owner, 17 Sep 2026). Left to fill the
        frame, three columns on a 1690px screen put a hand's width of paper
        between neighbouring faces and the group stopped reading as one shelf
        — the eye had to travel from face to face instead of taking them in
        together. The cap holds the cards at a size a person scans in one
        look, and the shell already centres whatever it is given.
      */}
      <div className="mx-auto flex w-full max-w-[1040px] flex-col items-stretch gap-6 md:flex-row md:gap-7">
        {/* Her hand-back card, left of the divider — device only. */}
        {subject && (
          <>
            <SubjectCard
              name={subject.name}
              photoUrl={subject.photo_url}
              held={(held ?? subject.id) === subject.id}
              onHold={() => setHeld(subject.id)}
              onPick={() => choose(subject)}
            />
            <div className="h-px w-full md:h-auto md:w-px md:self-stretch" style={{ background: "rgba(var(--ink),.1)" }} />
          </>
        )}

        {/* The family grid — a fixed six cells, whatever the family's size (7f). */}
        <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-3 sm:grid-cols-3 sm:gap-4">
          {(seeingMore ? hidden : shown).map((profile) => (
            <ProfileTile
              key={profile.id}
              person={toPerson(profile)}
              held={profile.id === (held ?? subject?.id ?? signedInId)}
              onHold={() => setHeld(profile.id)}
              onPick={() => choose(profile)}
            />
          ))}
          {!seeingMore && hidden.length > 0 && (
            <SeeMoreCard
              hidden={hidden.map((p) => ({ id: p.id, name: p.name }))}
              total={others.length}
              onOpen={() => setSeeingMore(true)}
            />
          )}
          {!seeingMore && <FirstTimeTile onClick={() => navigate("/join")} />}
        </div>
      </div>

      {/* The "Hello, name" beat before the screen turns over. */}
      <p
        role="status"
        className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-xl text-fg-muted"
        style={{ visibility: message && state === "success" ? "visible" : "hidden" }}
      >
        {message || " "}
      </p>
    </ChooserShell>
  );
}
