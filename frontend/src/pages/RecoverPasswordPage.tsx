import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { useDoorTheme } from "@/lib/useWorkspaceTheme";

/**
 * Setting the new family password, from the emailed link (M136, P1b's second
 * half).
 *
 * This page is where `/recover?t=…` lands — the address the recovery email
 * has been sending people to since migration 027. **Nothing was there.** The
 * route did not exist, so the catch-all sent every recovery link to the front
 * door and dropped the token on the way: the backend minted tokens, the email
 * carried them, and the corridor ended at a wall. Recovery was shipped and
 * unreachable, which is the worst of both — a family locked out of their own
 * archive, holding a link that appeared to do nothing.
 *
 * The link is single-use and lasts 30 minutes. Completing it is one
 * transaction (migration 037): the token is spent, the password set, and
 * every remote session revoked together, so a reset either happens whole or
 * leaves the link alive to try again.
 *
 * **Everyone is signed out, deliberately.** A reset that leaves the old
 * sessions standing has not recovered anything — the departed phone, the lost
 * laptop and whoever knew the old password all keep their access. So this
 * page ends at the sign-in door rather than in a signed-in session, and says
 * so plainly instead of pretending the reset was smaller than it is.
 */

const FIELD =
  "w-full rounded-md border border-input bg-white/[0.04] px-4 py-3.5 text-base outline-none focus:border-accent";

/** Matches `passwordProblem` in the backend; the server is still the authority. */
const PASSWORD_MIN = 10;

export function RecoverPasswordPage() {
  const navigate = useNavigate();
  /* Every door follows the colour the person chose (owner, 17 Sep 2026). */
  const { attrs: doorAttrs } = useDoorTheme();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const token = params.get("t") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // Checked here only so the answer is instant; the same rules are enforced
    // server-side, where they actually hold.
    if (password.length < PASSWORD_MIN) {
      setError(
        `Use at least ${PASSWORD_MIN} characters — a phrase you will remember beats a puzzle you will not.`
      );
      return;
    }
    if (password !== confirm) {
      setError("Those two do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post("/family/recover/complete", { token, password });
      // The session this browser held (if any) was just revoked server-side;
      // ask who we are now rather than carrying a stale answer to the door.
      await refresh();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That link is not valid any more.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-[380px] text-center">
          <p className="text-2xl font-bold tracking-tight">Recall</p>
          <h1 className="mt-10 text-[22px] font-medium leading-[1.3]">
            The new password is set
          </h1>
          {/*
            The owner's words, and the same words the forgot screen uses
            (M163 / F58). One wording governs both surfaces so the redrawn 9b
            frame and the shipped code cannot drift apart — if this changes,
            change it in both files in one commit.

            Two rounds of wrongness are worth remembering here. It first said
            everyone was signed out "everywhere", which is not what the reset
            does: the guards exempt the family's trusted screen on purpose
            (`middleware/auth.ts`, `!device.isTrusted`), because the display in
            the living room must never be interrupted by an act performed on
            somebody's phone. The repair then over-corrected into "including a
            device the family no longer has" — reassuring, and false for the
            one device most likely to be gone, since that screen is exactly
            the one the sign-out exempts. The wording below promises only what
            the build does, and answers the lost-screen case by pointing at
            the place that actually handles it.
          */}
          <p className="mt-6 text-[14px] font-medium leading-[1.4]" style={{ color: "var(--accent-soft)" }}>
            A new password signs everyone out
          </p>
          <p role="status" className="mt-1.5 text-[13px] leading-[1.6] text-fg-muted">
            Every phone and laptop is signed out. The family screen keeps playing, as
            always. If the family screen itself was lost, you can replace it in
            Settings.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="mt-8 w-full rounded-[12px] bg-accent px-8 py-[15px] text-[15px] font-medium leading-none text-accent-foreground"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <p className="text-center text-2xl font-bold tracking-tight">Recall</p>

        <h1 className="mt-10 text-center text-[22px] font-medium leading-[1.3]">
          Set a new family password
        </h1>

        {!token ? (
          <>
            <p className="mt-3 text-center text-sm leading-[1.55] text-destructive-soft">
              This link is missing its key. Open the full link from the family
              email, or ask for a new one — they last 30 minutes.
            </p>
            <button
              type="button"
              onClick={() => navigate("/forgot-password")}
              className="mt-8 w-full rounded-[12px] px-8 py-[13px] text-sm font-medium leading-none"
              style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
            >
              Send a new link
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-center text-[13px] leading-[1.6] text-fg-muted">
              Every phone and laptop signs in again afterwards. The screen in
              the living room keeps playing, and the memories are untouched.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="label-caps" htmlFor="password">
                  New family password
                </label>
                <input
                  id="password"
                  type="password"
                  autoFocus
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD}
                />
                <p className="text-[12px] leading-[1.5] text-fg-faint">
                  At least {PASSWORD_MIN} characters. A phrase the family will
                  remember beats a puzzle they will not.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="label-caps" htmlFor="confirm">
                  Type it again
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
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
                {busy ? "Setting…" : "Set the password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
