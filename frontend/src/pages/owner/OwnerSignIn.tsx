import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Wordmark } from "@/components/Wordmark";
import { api } from "@/lib/api";

/**
 * The door on `/owner` (owner, 21 Sep 2026: "create a cooler owner dashboard
 * login than the public one… one with the login in the middle of the screen,
 * like we did for the other stuff").
 *
 * The public door at `/login` is a split: a dark half carrying the product
 * and a paper half carrying the form. This one is the other shape the app
 * already uses for a door — one card in the middle of the screen, the way
 * `/forgot-password` and `/recover` stand — but on ink rather than on the
 * workspace ground, lit from two corners, with the form in glass over it.
 *
 * IT NAMES NOTHING BEHIND IT, and that is not an oversight to be tidied
 * later. `/owner` is built around a refusal that hides whether there is
 * anything at this address at all; a door headed "platform console" would
 * announce, to anyone who guessed the path, exactly what that 404 exists to
 * withhold. So every word here is a word any Recall sign-in could carry:
 * "Sign in", "Email", "Password". The page is cooler than the public door
 * without being more talkative than it.
 *
 * THE LABELS SAY "EMAIL", NOT "FAMILY EMAIL", and that is the one piece of
 * copy that is load-bearing rather than cosmetic. The credential is the same
 * one `/login` takes, but the row it belongs to here is not a household —
 * the platform owner owns no archive (see `requirePlatformOwner`, which
 * resolves by family id for exactly that reason). Asking this person for
 * their "family email" would be wrong about who they are, and the neutral
 * word happens to be the quieter one too.
 *
 * WHERE IT GOES AFTERWARDS IS THE SERVER'S ANSWER, not this page's guess —
 * `POST /family/login` replies `next: "/owner"` for the platform owner and
 * `next: "/profiles"` for everyone else. So a family that finds this address
 * and signs in lands on its own chooser and never sees a console, and the
 * platform owner lands on the page already underneath this one.
 *
 * THE PALETTE IS FIXED, like every other door (owner, 17 Sep 2026: "the
 * public pages, they don't need to be influenced by other teams — they have
 * fixed designs"). Nothing has identified the person standing here, so there
 * is no "their colour" to take, and a door that changes palette depending on
 * who last used the browser is not a door.
 */

/*
  The door's own palette. `--accent` is declared on the page root rather than
  passed to each consumer: `Wordmark` paints its dot `var(--accent)` and
  `.pressable` draws its ring from the same token, and with no scope
  declaring one both fall through to `:root` and come out the workspace
  amber. That is measured behaviour — it happened on the public door and was
  fixed there the same way. A custom property resolves where it is declared.
*/
const INK = "#0d0c0b";
const CREAM = "#f2f1ee";
const VERMILLION = "#c13b22";
/** Readable on ink. The public door's #a6301b is dark-on-dark here. */
const ALARM = "#ff9d85";

const MONO = "'Roboto Mono', monospace";
const CAPS = "font-mono text-[10.5px] uppercase tracking-[0.2em]";

/*
  The numeral, and why it is this one.

  The public door wears 06 and says so: it stands for nothing. This one
  wears 99, which in the product's own vocabulary is the reserved channel
  the display will not let anyone assign — `channelNumbers.ts` keeps 00, 10,
  98 and 99 out of a family's hands. It is the closest thing Recall has to a
  number that means "not for the household", so it is the right mark for the
  one page that is not a household's. Hidden from a screen reader: it is
  handwriting, not an instruction.
*/
const DOOR_NUMERAL = "99";

const FIELD_BASE: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,.055)",
  border: "1px solid rgba(255,255,255,.13)",
  borderRadius: 12,
  padding: "13px 15px",
  color: CREAM,
  /* 16px, not 15: anything smaller makes iOS zoom the page on focus. */
  fontSize: 16,
  lineHeight: 1.2,
  outline: "none",
  transition: "border-color .16s, box-shadow .16s, background-color .16s",
};

function focusOn(el: HTMLInputElement) {
  el.style.borderColor = VERMILLION;
  el.style.boxShadow = `0 0 0 3px rgba(193,59,34,.22)`;
  el.style.background = "rgba(255,255,255,.075)";
}

function focusOff(el: HTMLInputElement) {
  el.style.borderColor = "rgba(255,255,255,.13)";
  el.style.boxShadow = "none";
  el.style.background = "rgba(255,255,255,.055)";
}

export function OwnerSignIn() {
  const navigate = useNavigate();
  const { signInFamily, refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  /*
    Two-step sign-in (access-5). Once the platform owner has an authenticator
    enrolled, /family/login answers `needs_code` to the password alone; the
    field appears then and not before, so the resting page still asks for
    nothing a family's sign-in would not.
  */
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  async function signInWithCode(): Promise<{ next: string }> {
    const res = await api.post<{ ok: true; next: string }>("/family/login", {
      email: email.trim(),
      password,
      code: code.replace(/\s+/g, ""),
    });
    await refresh();
    return { next: res.next };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { next } = needsCode ? await signInWithCode() : await signInFamily(email.trim(), password);
      /*
        For the platform owner `next` is this very address, and navigating
        to the page you are already on does nothing — which is correct and
        is not what makes the console appear. `signInFamily` has refreshed
        the session by now, so the dashboard above this component re-renders
        with a session and takes over. The navigate is here for everyone
        else, whom the server sends to their own chooser instead.
      */
      navigate(next || "/profiles", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      if ((err as { code?: string } | null)?.code === "needs_code") {
        // The password was right; keep it, and ask for the code.
        setNeedsCode(true);
        setCode("");
      } else {
        setPassword("");
        setNeedsCode(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="owner-door relative h-full overflow-y-auto"
      style={{ background: INK, color: CREAM, ["--accent" as string]: VERMILLION }}
    >
      <style>{`
        /*
          The two lights drift, slowly enough that you notice it only if you
          sit here — which, on a sign-in page, nobody should have to. It is
          off entirely for anyone who has asked their machine for less
          motion.
        */
        @keyframes ownerDoorDriftA {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50%      { transform: translate3d(3%, 4%, 0) scale(1.08); }
        }
        @keyframes ownerDoorDriftB {
          0%, 100% { transform: translate3d(0,0,0) scale(1.04); }
          50%      { transform: translate3d(-4%, -3%, 0) scale(1); }
        }
        .owner-door .owner-glow-a { animation: ownerDoorDriftA 34s ease-in-out infinite; }
        .owner-door .owner-glow-b { animation: ownerDoorDriftB 42s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .owner-door .owner-glow-a,
          .owner-door .owner-glow-b { animation: none; }
        }
      `}</style>

      {/* ── the ground: two lights, a ruled grid, and a vignette over it ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className="owner-glow-a absolute"
          style={{
            inset: "-30% 20% 40% -25%",
            background: "radial-gradient(closest-side, rgba(193,59,34,.42), transparent 70%)",
            filter: "blur(30px)",
          }}
        />
        <span
          className="owner-glow-b absolute"
          style={{
            inset: "45% -25% -30% 30%",
            background: "radial-gradient(closest-side, rgba(226,154,104,.30), transparent 70%)",
            filter: "blur(36px)",
          }}
        />
        {/*
          The grid is the workspace's own graph paper, faint. It is masked to
          fade out at the edges rather than running into them, because a grid
          that stops at the viewport looks like a bug in the page and a grid
          that fades looks like light.
        */}
        <span
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(242,241,238,.055) 1px, transparent 1px)," +
              "linear-gradient(90deg, rgba(242,241,238,.055) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(120% 90% at 50% 45%, #000 20%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(120% 90% at 50% 45%, #000 20%, transparent 78%)",
          }}
        />
        <span
          className="absolute inset-0"
          style={{
            background: "radial-gradient(130% 100% at 50% 50%, transparent 38%, rgba(0,0,0,.62) 100%)",
          }}
        />
      </div>

      {/* ── the card, in the middle of the screen ───────────────────────── */}
      <div className="relative flex min-h-full flex-col items-center justify-center gap-7 px-6 py-14">
        <div
          className="relative w-full overflow-hidden"
          style={{
            maxWidth: 420,
            borderRadius: 22,
            padding: "34px 32px 30px",
            background: "rgba(255,255,255,.055)",
            border: "1px solid rgba(255,255,255,.11)",
            backdropFilter: "blur(20px) saturate(1.3)",
            WebkitBackdropFilter: "blur(20px) saturate(1.3)",
            boxShadow: "0 44px 96px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.09)",
          }}
        >
          {/* The numeral, ghosted into the card's own corner. */}
          <span
            aria-hidden
            className="pointer-events-none absolute select-none"
            style={{
              top: -26,
              right: 10,
              font: "300 italic 150px/0.8 Roboto, Helvetica, Arial, sans-serif",
              letterSpacing: "-.03em",
              color: CREAM,
              opacity: 0.055,
            }}
          >
            {DOOR_NUMERAL}
          </span>

          <div className="relative">
            <Wordmark size={18} style={{ color: CREAM }} />

            <h1
              className="mt-8 text-[28px] font-semibold leading-[1.1]"
              style={{ letterSpacing: "-.02em" }}
            >
              Sign in
            </h1>
            <p className="mt-2 text-[14.5px] leading-[1.5]" style={{ color: "rgba(242,241,238,.72)" }}>
              With your email and password.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className={CAPS} htmlFor="owner-email" style={{ color: "rgba(242,241,238,.66)" }}>
                  Email
                </label>
                <input
                  id="owner-email"
                  type="email"
                  autoFocus
                  required
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={(e) => focusOn(e.currentTarget)}
                  onBlur={(e) => focusOff(e.currentTarget)}
                  className="placeholder:text-[color:rgba(242,241,238,.56)]"
                  style={FIELD_BASE}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className={CAPS} htmlFor="owner-password" style={{ color: "rgba(242,241,238,.66)" }}>
                  Password
                </label>
                <span className="relative block">
                  <input
                    id="owner-password"
                    type={reveal ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={(e) => focusOn(e.currentTarget)}
                    onBlur={(e) => focusOff(e.currentTarget)}
                    /* Room for the reveal control, so a long password runs to
                       the edge of the text and stops — never underneath the
                       word sitting on top of it. */
                    style={{ ...FIELD_BASE, paddingRight: 74 }}
                  />
                  {/* A hit area, not just a word: the padding grows the target
                      past WCAG's 24x24 floor while the visible word stays put
                      (M218, on the public door's twin of this control). */}
                  <button
                    type="button"
                    onClick={() => setReveal((r) => !r)}
                    aria-label={reveal ? "Hide the password" : "Show the password"}
                    className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center px-3 py-2.5 ${CAPS}`}
                    style={{ color: "rgba(242,241,238,.66)" }}
                  >
                    {reveal ? "Hide" : "Show"}
                  </button>
                </span>
              </div>

              {needsCode && (
                <div className="flex flex-col gap-2">
                  <label className={CAPS} htmlFor="owner-code" style={{ color: "rgba(242,241,238,.66)" }}>
                    Code
                  </label>
                  <input
                    id="owner-code"
                    autoFocus
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onFocus={(e) => focusOn(e.currentTarget)}
                    onBlur={(e) => focusOff(e.currentTarget)}
                    className="placeholder:text-[color:rgba(242,241,238,.56)]"
                    style={{ ...FIELD_BASE, fontFamily: MONO, letterSpacing: ".3em" }}
                  />
                </div>
              )}

              {/* Only present when there is one. A reserved line reads as a
                  stray gap in the resting page, which is what everyone sees. */}
              {error && (
                <p role="alert" className="text-[14px] leading-[1.45]" style={{ color: ALARM }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="pressable mt-1 w-full rounded-full px-8 py-[15px] text-[15px] font-medium leading-none transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: VERMILLION, color: "#f7f3eb" }}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="mx-auto py-1 text-[14px]"
                style={{ color: "rgba(242,241,238,.7)" }}
              >
                Forgotten it?
              </button>
            </form>
          </div>
        </div>

        <p
          style={{
            font: `400 10px/1.9 ${MONO}`,
            letterSpacing: ".22em",
            color: "rgba(242,241,238,.58)",
            textTransform: "uppercase",
          }}
        >
          Nothing is public.
        </p>
      </div>
    </div>
  );
}
