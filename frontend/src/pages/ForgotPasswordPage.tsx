import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useDoorTheme } from "@/lib/useWorkspaceTheme";

/**
 * "I've forgotten the family password" (M136, frame P1b).
 *
 * The family email is the root of recovery: it owns the subscription, resets
 * the password, and can re-run the trusted-screen ceremony. If everyone
 * forgets everything, that inbox is what saves the archive — so this page is
 * the whole of the way back in, and it asks for nothing but the address.
 *
 * **The answer never changes.** Sent or not sent, known address or unknown,
 * this page says the same sentence. Anything more helpful would turn the form
 * into a way to ask whether a given address belongs to a family caring for
 * someone with dementia (M19's rule; the backend answers identically for the
 * same reason, so the page cannot leak what the server refuses to say).
 */

const FIELD =
  "w-full rounded-md border border-input bg-white/[0.04] px-4 py-3.5 text-base outline-none focus:border-accent";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  /* Every door follows the colour the person chose (owner, 17 Sep 2026). */
  const { attrs: doorAttrs } = useDoorTheme();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Seconds until "Send it again" is offered — see the note beside it. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/family/recover", { email: email.trim() });
      setCooldown(60);
    } catch (err) {
      /*
        A refusal here is real and must be shown (Feedback, F-review).

        My first version swallowed this, on the reasoning that the route
        answers 200 whether or not the address is known — true of the
        *address*, and irrelevant to the *rate limit*. `api.ts` throws on a
        429, so a limited resend landed in an empty catch: the button did
        nothing, said nothing, and started no cooldown, which is a dead
        control wearing a working one's clothes.

        The server's own sentence is what gets shown. It knows why it
        refused; this page does not, and guessing would be the same mistake
        one level down.
      */
      setError(err instanceof Error ? err.message : "The email could not be sent.");
      // Refused or not, wait before offering again — hammering a rate limit
      // is how a family turns a slow minute into a locked one.
      setCooldown(60);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/family/recover", { email: email.trim() });
      setSent(true);
      setCooldown(60);
    } catch (err) {
      // Only a failure to *reach* the server lands here — the route answers
      // 200 whether or not the address is known, which is the point.
      setError(err instanceof Error ? err.message : "The email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <p className="text-center text-2xl font-bold tracking-tight">Recall</p>

        {sent ? (
          /*
            9b — the same words, ranked.

            Every sentence here was already on the page; they sat in three grey
            paragraphs of equal weight, so the one that matters — a new password
            signs everyone out — read as a footnote. It is a bordered block now,
            which is the whole argument of the redraw: hierarchy, not new copy.

            Two things are load-bearing and must not be "tidied" later. The
            result line stays conditional ("If that address belongs to a
            family"), because whether an address belongs to a family caring for
            someone with dementia is not a fact this form gets to confirm to a
            stranger. And the consequence says "including you", because the
            person reading it is the one most likely to assume they are the
            exception.
          */
          <div className="flex flex-col items-center">
            <span
              className="door-contrast flex h-[76px] w-[76px] items-center justify-center rounded-full"
              style={{ background: "rgba(var(--accent-channels),.14)", border: "1px solid rgba(var(--accent-channels),.35)" }}
            >
              <Mail size={30} strokeWidth={1.5} style={{ color: "var(--accent)" }} aria-hidden />
            </span>

            <h1 className="mt-[18px] text-center text-[26px] font-medium leading-[1.2]">
              Check the family inbox
            </h1>

            <p role="status" className="mt-3 text-center text-[13.5px] leading-[1.6] text-fg-muted">
              If that address belongs to a family, we have sent the next step.
            </p>

            {/*
              A chip, not a sentence — and a true one: the reset token really
              is single-use and really does expire in 30 minutes
              (`family.ts`, `expires_at: now + 30 * 60_000`). If that TTL ever
              changes, this line is the thing that starts lying.
            */}
            <span
              className="mt-[18px] rounded-full px-3.5 py-1.5 font-mono text-[11px] tracking-[0.06em]"
              style={{ background: "rgba(var(--ink),.06)", color: "rgba(var(--ink-cream),.7)" }}
            >
              Works once · expires in 30 minutes
            </span>

            <div
              className="mt-[26px] w-full rounded-[16px] p-4"
              style={{ border: "1px solid rgba(var(--accent-channels),.35)", background: "rgba(var(--accent-channels),.07)" }}
            >
              <p className="text-[14px] font-medium leading-[1.4]" style={{ color: "var(--accent-soft)" }}>
                A new password signs everyone out
              </p>
              {/* The same words as the recover screen's done state (M163) —
                  one wording for both, changed together or not at all. */}
              <p className="mt-1.5 text-[13px] leading-[1.55] text-fg-muted">
                Every phone and laptop is signed out. The family screen keeps playing,
                as always. If the family screen itself was lost, you can replace it in
                Settings.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/login")}
              className="mt-[26px] w-full rounded-[12px] px-8 py-[13px] text-sm font-medium leading-none"
              style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
            >
              Back to sign-in
            </button>

            {/*
              A way forward instead of a dead end — but NOT a guarantee, and
              the earlier comment here claimed one it could not keep.

              I had reasoned that 60s is stricter than the route's own limit
              (20 attempts per 15 minutes, one every 45s) so the countdown
              could never offer a resend the server refuses. That is wrong:
              `loginLimiter` is a single rateLimit() instance shared by eight
              routes in family.ts — sign-in, pairing, screen replacement, PIN
              entry, recovery — counting per IP across all of them. A
              household entering PINs on the same connection can spend the
              budget while this timer runs.

              So the timer is a courtesy, not a promise, and the refusal it
              cannot prevent is displayed instead of swallowed.
            */}
            {/* Reserved so the card does not jump when a refusal appears. */}
            <p
              role="alert"
              className="mt-3 min-h-5 text-center text-[13px] leading-[1.45] text-destructive-soft"
              style={{ visibility: error ? "visible" : "hidden" }}
            >
              {error || " "}
            </p>

            <p className="mt-2 text-center text-[13px] leading-[1.6] text-fg-faint">
              Nothing arrived?{" "}
              {cooldown > 0 ? (
                <>
                  <span style={{ color: "rgba(var(--ink-cream),.5)" }}>Send it again</span> in{" "}
                  {Math.floor(cooldown / 60)}:{String(cooldown % 60).padStart(2, "0")}
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resend()}
                  className="underline underline-offset-2 hover:text-fg disabled:opacity-40"
                >
                  Send it again
                </button>
              )}
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-10 text-center text-[22px] font-medium leading-[1.3]">
              Forgotten the family password
            </h1>
            <p className="mt-3 text-center text-[13px] leading-[1.6] text-fg-muted">
              Tell us the family email and we will send a link to set a new one.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="label-caps" htmlFor="email">
                  Family email
                </label>
                <input
                  id="email"
                  type="email"
                  autoFocus
                  required
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={FIELD}
                />
              </div>

              <p
                role="alert"
                className="min-h-5 text-sm leading-[1.45] text-destructive-soft"
                style={{ visibility: error ? "visible" : "hidden" }}
              >
                {error || " "}
              </p>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-[12px] bg-accent px-8 py-[15px] text-[15px] font-medium leading-none text-accent-foreground disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send the link"}
              </button>
            </form>

            <p className="mt-8 text-center text-[13px] leading-[1.6] text-fg-faint">
              Remembered it?{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="underline underline-offset-2 hover:text-fg"
              >
                Go back to sign-in
              </button>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
