import "@/pages/onboarding/site.css";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Monitor } from "lucide-react";
import { useAuth, type PairingAdmin } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { BackButton, GROUND } from "@/components/login/ChooserShell";
import { Wordmark } from "@/components/Wordmark";
import { useDoorTheme } from "@/lib/useWorkspaceTheme";

/**
 * Handing this machine the family's screen.
 *
 * The door behind this page has existed since M111 — `POST /family/pair-screen`,
 * the family password, allowed only while a family has no trusted screen — and
 * `pairScreen` has sat on `AuthContext` since. **Nothing called it.** No page
 * anywhere offered the act, so a family whose screen had been retired could
 * not get another one without a console: the everyday pairing was reachable
 * only by the ceremony meant for *replacing* a screen, which sends a link by
 * email, and no email leaves production yet.
 *
 * So this is not a new power. It is the missing entrance to one, and it is
 * built where F44 says setup belongs — behind sign-in, reached from the
 * chooser by somebody the archive already recognises, never in front of the
 * door where M136 deliberately removed the "this is our family screen"
 * switcher.
 *
 * ── Why it asks for the password again ───────────────────────────────────
 *
 * The session on this browser proves somebody signed in. It does not prove
 * they meant to give away the family's one screen, and a chooser left open on
 * a borrowed laptop is exactly the state where an accidental press costs the
 * most: the slot is single, and taking it back needs the emailed ceremony.
 * The endpoint was written password-gated for that reason and this page does
 * not route around it. Re-typing is the confirmation.
 *
 * ── Why an administrator's PIN as well (access-2) ─────────────────────────
 *
 * Every member knows the family password, and a paired screen reads every
 * channel — private ones included — and outlives a password reset. So the
 * password alone no longer pairs: after it, an administrator of the family
 * chooses themselves and types their own PIN, counted against their
 * profile's lockout like any other. The family email hears about every
 * pairing, so one nobody expected does not go unnoticed.
 *
 * ── Why it says what it costs, before the button ─────────────────────────
 *
 * A family runs one screen of its own — 047 narrowed 027's index to browser
 * screens, so a Recall device sits beside that slot rather than inside it.
 * Pairing the wrong machine is still not free: it spends the slot, and the
 * way back is Settings (or, if nobody can reach Settings, the emailed
 * ceremony). The page says all of that above the button rather than in a
 * confirmation after it.
 */

const FIELD =
  "w-full rounded-md border border-input bg-white/[0.04] px-4 py-3.5 text-base outline-none focus:border-accent";

export function ScreenSetupPage() {
  const navigate = useNavigate();
  /* Every door follows the colour the person chose (owner, 17 Sep 2026). */
  const { attrs: doorAttrs } = useDoorTheme();
  const { pairingAdmins, pairScreen } = useAuth();
  const { subjectName } = useDisplay();
  const who = subjectName?.trim() || null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    Two steps on one card. `admins` is null until the password is proved;
    then it holds who may confirm, and the form asks for one of them and
    their PIN. The password is kept for the second call, which checks it
    again — nothing is remembered on the server between the two.
  */
  const [admins, setAdmins] = useState<PairingAdmin[] | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  function startOver() {
    setAdmins(null);
    setAdminId(null);
    setPin("");
    setPassword("");
    setError(null);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    if (!admins) {
      try {
        const list = await pairingAdmins(email.trim(), password);
        if (list.length === 0) {
          setError(
            "Nobody in this family has an administrator PIN yet, so nobody can confirm this screen. Ask for a replacement link sent to the family email instead."
          );
          setPassword("");
        } else {
          setAdmins(list);
          // One administrator is the usual family: nothing to choose.
          setAdminId(list.length === 1 ? list[0].id : null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "This machine could not be set up.");
        setPassword("");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!adminId) {
      setError("Choose who is confirming.");
      setBusy(false);
      return;
    }

    try {
      await pairScreen(email.trim(), password, adminId, pin);
      /*
        Straight to the display, replacing history: this machine is the
        screen now, and the way back to a chooser is `98`, not the browser's
        back button landing on a setup page it has already spent.
      */
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "This machine could not be set up.");
      setPin("");
      // A refusal of the password itself (a lock, a change elsewhere) needs
      // the first step again; a wrong PIN only needs the PIN again.
      if ((err as { code?: string } | null)?.code === "refused") {
        setAdmins(null);
        setAdminId(null);
        setPassword("");
      }
      setBusy(false);
    }
  }

  return (
    <div
      {...doorAttrs}
      className="door-contrast flex h-dvh flex-col overflow-y-auto px-5 pb-6 pt-6 sm:px-8 md:px-10"
      style={GROUND}
    >
      <div className="flex flex-none items-center gap-3">
        <span
          className="flex items-baseline gap-[9px] rounded-full px-5 py-[11px]"
          style={{ border: "1px solid rgba(var(--ink),.13)" }}
        >
          <Wordmark size={16} style={{ color: "var(--cream)" }} />
          <span className="text-[11px] font-light italic" style={{ color: "rgba(var(--ink-cream),.6)" }}>
            A living archive
          </span>
        </span>
        <BackButton onClick={() => navigate("/profiles")} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8">
        <div
          className="w-full max-w-[560px] rounded-[26px] p-[24px_22px_22px] lg:p-[36px_38px_32px]"
          style={{
            background: "#151517",
            border: "1px solid rgba(var(--ink),.12)",
            boxShadow: "0 30px 80px rgba(0,0,0,.5)",
          }}
        >
          <span
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "var(--accent-tint)" }}
          >
            <Monitor size={19} strokeWidth={1.7} style={{ color: "var(--accent)" }} aria-hidden />
          </span>

          <h1 className="mt-4 text-[24px] font-medium" style={{ color: "#F2F1EE" }}>
            Make this the main display
          </h1>

          <p className="mt-3 text-[14px] leading-[1.65]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
            This machine becomes the screen in {who ? `${who}'s` : "the"} room. It stops asking who
            is here and simply plays — channels open by tapping a card, and it stays signed in for
            thirty days so the display is never interrupted.
          </p>

          {/*
            The facts somebody needs *before* the button, not in a
            confirmation afterwards. The second one is the one that costs
            something, so it is not softened.
          */}
          <ul className="mt-4 flex flex-col gap-2.5">
            {[
              `Nothing in the archive changes — no memory, no channel, nobody's access.`,
              `A family runs one screen of its own. If another machine already has it, retire that one in Settings first.`,
              `A Recall device, if you have one, keeps playing beside this — it does not take the place.`,
              `An administrator confirms with their PIN, and the family email is told that a screen was paired.`,
            ].map((line) => (
              <li
                key={line}
                className="flex gap-2.5 text-[13.5px] leading-[1.6]"
                style={{ color: "rgba(var(--ink-cream),.6)" }}
              >
                <span aria-hidden style={{ color: "var(--accent)" }}>
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>

          <form onSubmit={confirm} className="mt-6 flex flex-col gap-[18px]">
            {!admins ? (
              <>
                <p className="text-[12.5px] leading-[1.6]" style={{ color: "rgba(var(--ink-cream),.45)" }}>
                  Confirm with the family email and password — the same key you signed in with.
                </p>

                <div className="flex flex-col gap-[9px]">
                  <label className="label-caps" htmlFor="screen-email">
                    Family email
                  </label>
                  <input
                    id="screen-email"
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

                <div className="flex flex-col gap-[9px]">
                  <label className="label-caps" htmlFor="screen-password">
                    Family password
                  </label>
                  <span className="relative block">
                    <input
                      id="screen-password"
                      type={reveal ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={FIELD}
                      style={{ paddingRight: 74 }}
                    />
                    {/* The same hit area M218 gave the sign-in page's twin, for
                        the same reason: this is where a mistype is discovered. */}
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      aria-label={reveal ? "Hide the password" : "Show the password"}
                      className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center px-3 py-3 text-[12.5px]"
                      style={{ color: "rgba(var(--ink-cream),.5)" }}
                    >
                      {reveal ? "Hide" : "Show"}
                    </button>
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12.5px] leading-[1.6]" style={{ color: "rgba(var(--ink-cream),.45)" }}>
                  Now an administrator of the family confirms with their own PIN.
                </p>

                {admins.length > 1 && (
                  <fieldset className="flex flex-col gap-[9px]">
                    <legend className="label-caps mb-[9px]">Who is confirming</legend>
                    <div className="flex flex-wrap gap-2">
                      {admins.map((admin) => (
                        <button
                          key={admin.id}
                          type="button"
                          aria-pressed={adminId === admin.id}
                          onClick={() => setAdminId(admin.id)}
                          className="rounded-full px-4 py-2.5 text-[14px] leading-none"
                          style={{
                            border: `1px solid ${adminId === admin.id ? "var(--accent)" : "rgba(var(--ink),.16)"}`,
                            background: adminId === admin.id ? "var(--accent-tint)" : "transparent",
                            color: "rgba(var(--ink-cream),.9)",
                          }}
                        >
                          {admin.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}

                <div className="flex flex-col gap-[9px]">
                  <label className="label-caps" htmlFor="screen-pin">
                    {admins.length === 1 ? `${admins[0].name}'s PIN` : "Their PIN"}
                  </label>
                  <input
                    id="screen-pin"
                    type="password"
                    autoFocus
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className={`${FIELD} font-mono tracking-[0.4em]`}
                  />
                </div>
              </>
            )}

            {/* Reserved, so the button never moves under a thumb already on it. */}
            <p
              role="alert"
              className="min-h-5 text-sm leading-[1.45] text-destructive-soft"
              style={{ visibility: error ? "visible" : "hidden" }}
            >
              {error || " "}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row-reverse">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-[12px] bg-accent px-8 py-[15px] text-[15px] font-medium leading-none text-accent-foreground disabled:opacity-40"
              >
                {busy ? "Setting up…" : admins ? "Make this the main display" : "Continue"}
              </button>
              <button
                type="button"
                onClick={() => (admins ? startOver() : navigate("/profiles"))}
                className="rounded-[12px] px-8 py-[15px] text-[15px] leading-none"
                style={{
                  border: "1px solid rgba(var(--ink),.16)",
                  color: "rgba(var(--ink-cream),.85)",
                }}
              >
                {admins ? "Back" : "Not this machine"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
