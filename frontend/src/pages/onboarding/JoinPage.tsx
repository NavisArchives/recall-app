import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import {
  OnboardingChrome,
  PrimaryButton,
  CodeBoxes,
  LABEL,
  INPUT,
  INPUT_BORDER,
} from "@/components/onboarding/bits";

const CODE_LENGTH = 6;
const PIN_LENGTH = 6;

interface Invitation {
  invitee_name: string;
  relationship: string | null;
  /**
   * The familiar first name and nothing else. The subject's legal name,
   * date of birth and address used to travel here, to an unauthenticated
   * caller holding a short code — name, birth date and address being the
   * identity-theft triple, aimed at a population already targeted for it.
   * A member reads those after joining, through routes that need a session.
   */
  subject: { display_name: string };
  inviter_name: string | null;
}

/**
 * Joining an archive, frames 11d–11e.
 *
 * The invitation link carries a 128-bit token and is the path most people
 * take — arriving with `?t=` looks itself up immediately. The six-character
 * code remains for someone reading it aloud over the phone, and expires
 * sooner because it is so much smaller.
 *
 * Either way the credential shows whose archive this is and who you are to
 * them, then asks for the two things only you can choose — a PIN for shared
 * screens, and your name as you want it written.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const [code, setCode] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(false);
  const [tokenFailed, setTokenFailed] = useState(false);

  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link looks itself up on arrival; a full code looks itself up as it is
  // typed. A wrong one clears and says so.
  useEffect(() => {
    const byToken = !!token && !tokenFailed;
    if (!byToken && code.length !== CODE_LENGTH) return;
    if (invitation || checking) return;

    setChecking(true);
    setError(null);
    api
      .post<Invitation>("/onboarding/join/lookup", byToken ? { token } : { code })
      .then((data) => {
        setInvitation(data);
        setName(data.invitee_name ?? "");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "This invitation is not valid any more.");
        if (byToken) setTokenFailed(true);
        else setCode("");
      })
      .finally(() => setChecking(false));
  }, [code, token, tokenFailed, invitation, checking]);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ redirect_to: string }>("/onboarding/join/complete", {
        ...(token && !tokenFailed ? { token } : { code }),
        pin,
        name: name.trim(),
        address: address.trim() || null,
      });
      await refresh();
      navigate(result.redirect_to ?? "/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Joining did not work. Try again.");
      setBusy(false);
    }
  }

  if (!invitation) {
    return (
      <OnboardingChrome>
        {/* A centred max-width with the chrome's gutters, not a fixed 560px
            slab that bleeds off both edges of a phone (M93). */}
        <div className="flex w-full max-w-[560px] flex-col items-center gap-8 text-center">
          <div>
            <h1 className="text-[28px] font-bold leading-[1.3] tracking-[-0.01em] sm:text-[34px]">
              You've been invited to build an archive
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.5] text-fg-muted">
              Enter the login code from your email.
            </p>
          </div>

          <CodeBoxes length={CODE_LENGTH} value={code} onValue={setCode} />

          <p
            role="alert"
            className="h-5 text-sm"
            style={{
              visibility: error || checking ? "visible" : "hidden",
              color: error ? "var(--destructive-soft)" : "var(--fg-faint)",
            }}
          >
            {checking ? "Checking…" : error || " "}
          </p>

          <p className="text-[13px] leading-[1.5] text-fg-faint">
            Didn't get a code?{" "}
            <span className="text-fg-muted">Ask the person who invited you to resend it.</span>
          </p>

          {/*
            A door for the person whose code has already been used (M193).

            An invitation is spent on first use, so someone who joined last
            month and taps the old link again lands here, enters the code
            they were given, and is told it is not valid any more — with
            nothing to do next. They followed a link *we* sent them, so
            being left on a dead page is our doing, not their mistake. They
            already have an account; the ordinary sign-in is where they
            belong.
          */}
          {error && (
            <p className="text-[13px] leading-[1.5] text-fg-faint">
              Already set up your profile?{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="underline underline-offset-2 hover:text-fg"
              >
                Sign in with the family password
              </button>
              .
            </p>
          )}
        </div>
      </OnboardingChrome>
    );
  }

  const subject = invitation.subject;
  const subjectFirst = subject.display_name;
  const joinFirst = (invitation.invitee_name || name).trim().split(/\s+/)[0];

  return (
    <OnboardingChrome>
      {/*
        Two columns on the desktop, stacked on a phone (M93). The row never
        wrapped, so at 375 the archive card overflowed and the fields bled
        off-screen. The card stays *first*, so stacking puts it above the
        form: whose shelf you are joining is the reason this page exists,
        and it should not be the thing that scrolls away.
      */}
      {/* 904 = the card's 360 + the gap's 64 + the form's 480, so the desktop
          row is exactly the width it was before it gained a maximum. */}
      <div className="flex w-full max-w-[904px] flex-col items-stretch gap-8 lg:flex-row lg:gap-16">
        {/* Whose archive this is */}
        <div
          className="flex w-full flex-none flex-col items-center gap-[18px] rounded-[18px] px-6 py-8 text-center sm:px-9 sm:py-10 lg:w-[360px]"
          style={{ border: "1px solid rgba(var(--ink),.14)", background: "rgba(var(--ink),.03)" }}
        >
          <InitialsAvatar name={subjectFirst || "?"} size={110} />
          <div>
            <p className="text-2xl font-bold leading-[1.2]">{subjectFirst}</p>
            <p className="mt-1.5 text-[13px] leading-[1.5] text-fg-muted">
              {invitation.inviter_name
                ? `${invitation.inviter_name} invited you to help`
                : "You have been invited to help"}
            </p>
          </div>
          {invitation.relationship && (
            <span
              className="rounded-full px-3.5 py-1.5 font-mono text-[11px] tracking-[0.12em]"
              style={{ border: "1px solid rgba(var(--ink),.25)", color: "rgba(var(--ink),.7)" }}
            >
              YOU ARE {subjectFirst.toUpperCase()}'S {invitation.relationship.toUpperCase()}
            </span>
          )}
          <p className="mt-auto text-[13px] leading-[1.6] text-fg-faint">
            Once you're in, you can add photos, stories and voice memories to{" "}
            {subjectFirst}'s shelf.
          </p>
        </div>

        {/* The two things only they can choose */}
        <div className="flex w-full min-w-0 flex-col gap-[26px] lg:w-[480px]">
          <div>
            <h1 className="text-[24px] font-bold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">
              Almost there, {joinFirst}
            </h1>
            <p className="mt-1.5 text-sm leading-[1.5] text-fg-muted">
              Choose a PIN to protect your profile on shared devices.
            </p>
          </div>

          <div>
            <span className={LABEL}>YOUR PIN</span>
            <div className="mt-2.5 flex justify-start">
              <CodeBoxes
                length={PIN_LENGTH}
                value={pin}
                onValue={setPin}
                masked
                digitsOnly
                boxWidth={56}
                boxHeight={64}
                autoFocus
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <label>
              <span className={LABEL}>YOUR NAME</span>
              <input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                className={INPUT}
                style={{ ...INPUT_BORDER, height: 50 }}
              />
            </label>
            <label>
              <span className={LABEL}>
                ADDRESS <span className="text-white/30">· OPTIONAL</span>
              </span>
              <input
                value={address}
                maxLength={200}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, number, city"
                className={INPUT}
                style={{ ...INPUT_BORDER, height: 50 }}
              />
            </label>
          </div>

          <p
            role="alert"
            className="h-5 text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>

          <PrimaryButton
            onClick={() => void complete()}
            disabled={busy || pin.length !== PIN_LENGTH || !name.trim()}
          >
            {busy ? "Entering…" : "Enter the archive"}
          </PrimaryButton>
        </div>
      </div>
    </OnboardingChrome>
  );
}
