import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Wordmark } from "@/components/Wordmark";

/**
 * One door, one credential, one form — design 27h, "inverted split: blurred
 * photograph".
 *
 * A PUBLIC PAGE HAS A FIXED DESIGN (owner, 17 Sep 2026: "the public pages,
 * they don't need to be influenced by other teams — they have fixed
 * designs"). This page used to take the signed-in profile's workspace colour,
 * which was wrong twice over: nothing has identified the person standing
 * here, so there is no "their colour" to use, and a front door that changes
 * palette depending on who last used the browser is not a front door. Ink,
 * paper and the vermillion are written here and nowhere else.
 *
 * This page has lost its switcher. M111 merged two unrelated credential
 * systems into one page but kept a toggle on it — "I'm on my own device" or
 * "This is our family screen" — so the first thing a signing-in family met
 * was a question about *where they were standing*, asked before anything had
 * identified them. Whichever they picked, they typed the same email and the
 * same password; the toggle only changed what happened next, which is the
 * server's business and not a thing to ask a person at the door.
 *
 * So: email, family password, in. Where this browser goes afterwards is the
 * server's answer (`next`) — a family to its chooser, the platform owner to
 * the one page that is theirs. Whether *this machine* becomes the family
 * screen is decided later, in the chooser, by someone the archive has already
 * recognised (F44: the setup lives behind sign-in, never in front of it).
 *
 * 9a — one card, one action, no side doors.
 *
 * The public front door now knows nothing about who is behind it: no family
 * named, no faces, no contributor count. That is the redraw's point. A page
 * that greets you by your family's name is a page that confirms your family
 * exists to anyone who guesses the address, and these are households caring
 * for someone with dementia.
 *
 * Two side doors that used to live here are gone. "Email the family a setup
 * link" — the ceremony that moves Recall to a new screen — now sits behind
 * sign-in on the chooser, because setup belongs to someone the archive has
 * already recognised (F44). "Use the code from your email" is gone because
 * invitees no longer arrive here at all: they arrive by the link in their
 * invitation, which lands on the claim sheet. Deleting a door is only safe
 * once its room has another entrance, so the ceremony link moved before this
 * one was removed — it is on ProfilesPage's foot.
 *
 * The families count the frame draws is deliberately NOT here. The design
 * says it "must be a live count at page load, never a hardcoded number", and
 * the companion frame 9c is the same page without it — the version that ships
 * until the number is both real and large enough to reassure. Nothing in the
 * layout leans on it, so turning it on later adds a row and moves nothing.
 */

/*
  The door's own palette — fixed, because the door is public.

  VERMILLION IS ALSO DECLARED AS `--accent` ON THE PAGE ROOT, and that is not
  decoration. The page said "nothing here reads a token" and it was not true:
  `<Wordmark>` paints its dot `var(--accent)`, and `.pressable` draws its
  hover ring from the same token — with no scope declaring one, both fell
  through to `:root` and came out the WORKSPACE AMBER. Measured on the running
  door: the dot computed `oklch(0.68 0.13 55)`, a tan, beside a #c13b22
  button. The design's mark is red.

  Declaring the token here rather than passing a colour to each consumer is
  the fix that also catches the next one: a custom property resolves where it
  is declared, so everything inside this page now gets the door's red without
  having to be told, and nothing outside it moves.
*/
const INK = "#121110";
const PAPER = "#f7f3eb";
const VERMILLION = "#c13b22";
const ON_INK = "#f7f3eb";

/*
  The photograph behind the ink panel (27h).

  It is blurred to 42px under the same angled scrim the display puts behind
  every channel, so the door already feels like the product before anyone is
  through it. Unreadable on purpose: at that radius it is warmth and colour,
  not a picture of anybody — which is the only way a face belongs on a page
  that has not identified its reader. This one is already published on
  recall.family, so the door discloses nothing the marketing site does not.
*/
const DOOR_PHOTO = "/site/room-terracotta.jpg";

/*
  A ruled line, not a box (27e).

  The frame draws each field as a single hairline under the text, which is
  what a form printed on paper looks like — and this door is the paper half
  of an inverted split. The line thickens and takes the accent on focus, so
  where you are is never in doubt without adding a second shape to the page.
*/
const FIELD =
  "w-full border-0 border-b bg-transparent px-0 pb-2.5 pt-1 text-[17px] outline-none transition-colors";
const FIELD_LINE = { borderColor: "rgba(20,19,15,.22)", color: INK };
const CAPS =
  "font-mono text-[10.5px] uppercase tracking-[0.2em]";

/*
  The numeral, and why it is a number at all.

  Recall's whole vocabulary is two-digit channels — the display answers to
  them, the cards in the house are printed with them. So the door carries one
  as its mark. It stands for nothing and opens nothing, which is why it is
  hidden from a screen reader: it is the product's handwriting, not an
  instruction.
*/
const DOOR_NUMERAL = "06";

export function SignInPage() {
  const navigate = useNavigate();
  const { signInFamily } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  /*
    The platform owner's second step (access-5). The server asks for an
    authenticator code only after a right password, by refusing with
    `code: "needs_code"`; the field appears then and never before, so the
    resting door asks a family for nothing new — and says nothing about who
    might be asked for more.
  */
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const typed = needsCode ? code.replace(/\s+/g, "") : undefined;
      const { next } = await signInFamily(email.trim(), password, typed);
      // Where to go is the server's answer, not this page's guess.
      navigate(next || "/profiles", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      if ((err as { code?: string } | null)?.code === "needs_code") {
        // The password was right: keep it, and ask for the code.
        setNeedsCode(true);
        setCode("");
      } else {
        setPassword("");
        setNeedsCode(false);
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
      An inverted split (27e): the dark half carries the product, the paper
      half carries the one thing to do. Below `lg` the two stack — the dark
      block becomes a short head and the form sits under it, because a
      half-screen of numeral above a keyboard is not a door, it is an
      obstacle.

      IT IS FULL BLEED, edge to edge, with no corner radius and no outer
      surface behind it. The first build had an 18px grey gutter and 28px
      rounded corners, because the design was read off a Claude Design canvas
      and the canvas's own frame — its margin, its rounding, its #e8e6e1
      backdrop — was copied along with the artwork (owner, 17 Sep 2026: "the
      rounded borders you see are of the canvas, not of the design"). The
      grid carried an `overflow-hidden` and a `100vh-36px` minimum for the
      same reason: one clipped the halves to a radius that should not exist,
      the other subtracted a gutter that should not exist. All of it is gone.

      The two tokens this page's own children DO read — `Wordmark`'s dot and
      `.pressable`'s ring, both `var(--accent)` — are answered here rather
      than left to fall through to the workspace's. See the palette note
      above: this is a public page, and it now declares what it is asked for
      instead of assuming nobody asks.
    */
    <div
      className="h-full overflow-y-auto"
      style={{ ["--accent" as string]: VERMILLION }}
    >
      {/* The seam sits left of centre in the frame, not on it: the ink half
          carries five short things and the paper half carries a form, so the
          form gets the wider side. Measured off 27e at about 45/55. */}
      <div className="grid min-h-full lg:grid-cols-[45fr_55fr]">
        {/* ── the dark half ───────────────────────────────────────────── */}
        <div
          className="relative isolate flex flex-col justify-between gap-10 overflow-hidden px-7 pb-10 pt-8 lg:px-[clamp(40px,4.4vw,72px)] lg:pb-[clamp(40px,4vw,64px)] lg:pt-[clamp(36px,3.6vw,56px)]"
          style={{ background: INK, color: ON_INK }}
        >
          {/* The photograph, then the scrim, then everything else. Both are
              behind the content and neither can be clicked through to. */}
          <img
            src={DOOR_PHOTO}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
            style={{ filter: "blur(42px) saturate(1.05)", transform: "scale(1.16)" }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "linear-gradient(196deg, rgba(18,17,16,.62) 0%, rgba(18,17,16,.82) 54%, rgba(18,17,16,.95) 100%)",
            }}
          />

          <Wordmark size={19} style={{ color: ON_INK }} />

          <div className="lg:pb-[6vh]">
            <div
              aria-hidden
              className="font-light italic leading-[0.82]"
              style={{
                font: "300 italic clamp(64px,11vw,150px)/0.82 Roboto, Helvetica, Arial, sans-serif",
                color: ON_INK,
                opacity: .94,
                letterSpacing: "-.02em",
              }}
            >
              {DOOR_NUMERAL}
            </div>
            <div
              className={`mt-6 lg:mt-9 ${CAPS}`}
              style={{ color: ON_INK, opacity: .66 }}
            >
              A living archive
            </div>
            <p
              className="mt-3 max-w-[18ch] text-[22px] font-light leading-[1.2] lg:mt-4 lg:text-[clamp(24px,2.1vw,30px)]"
              style={{ color: ON_INK, letterSpacing: "-.015em" }}
            >
              All in one place, within reach.
            </p>
          </div>

          <div
            className="font-mono text-[10.5px] uppercase leading-[1.9] tracking-[0.18em]"
            style={{ color: ON_INK, opacity: .55 }}
          >
            Nothing is public.
            <br />
            One archive. One family.
          </div>
        </div>

        {/* ── the paper half ──────────────────────────────────────────── */}
        <div
          className="relative flex flex-col justify-center px-7 pb-12 pt-10 lg:px-[clamp(44px,5vw,96px)] lg:py-16"
          style={{ background: PAPER }}
        >
          {/*
            Help stays in the corner where help always lives — as a mark, not
            a sentence. It is the one thing on this page that is not in the
            frame, and it earns its place: a family that cannot get through
            this door has nowhere else to ask.
          */}
          <a
            href="/help"
            aria-label="Need help?"
            title="Need help?"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full transition-colors lg:right-6 lg:top-6"
            style={{ color: "rgba(20,19,15,.42)" }}
          >
            <HelpCircle className="h-[21px] w-[21px]" strokeWidth={1.8} aria-hidden />
          </a>

          <div className="w-full max-w-[430px]">
            <h1
              className="text-[30px] font-semibold leading-[1.1] lg:text-[34px]"
              style={{ color: INK, letterSpacing: "-.02em" }}
            >
              Sign in
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.55]" style={{ color: "rgba(20,19,15,.62)" }}>
              With your family email and password.
            </p>

            <form onSubmit={handleSubmit} className="mt-9 flex flex-col gap-7">
              <div className="flex flex-col gap-2.5">
                <label className={CAPS} htmlFor="email" style={{ color: "rgba(20,19,15,.5)" }}>
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
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={(e) => (e.currentTarget.style.borderColor = VERMILLION)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(20,19,15,.22)")}
                  className={`${FIELD} placeholder:text-[color:rgba(20,19,15,.34)]`}
                  style={FIELD_LINE}
                />
              </div>

              <div className="flex flex-col gap-2.5">
                <label className={CAPS} htmlFor="password" style={{ color: "rgba(20,19,15,.5)" }}>
                  Family password
                </label>
                <span className="relative block">
                  <input
                    id="password"
                    type={reveal ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={(e) => (e.currentTarget.style.borderColor = VERMILLION)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(20,19,15,.22)")}
                    className={FIELD}
                    /* Room for the reveal control, so a long password runs to
                       the edge of the text and stops — never underneath the
                       word sitting on top of it. */
                    style={{ ...FIELD_LINE, paddingRight: 72 }}
                  />
                  {/*
                    A hit area, not just a word (M218). This measured 31x19
                    before — under WCAG's 24x24 floor, on the control someone
                    reaches for at the moment the password is already going
                    wrong, one-handed. The padding grows the target while the
                    visible word stays exactly where the frame puts it.
                  */}
                  <button
                    type="button"
                    onClick={() => setReveal((r) => !r)}
                    aria-label={reveal ? "Hide the password" : "Show the password"}
                    className={`absolute bottom-1 right-0 flex items-center px-2 py-2.5 ${CAPS}`}
                    style={{ color: "rgba(20,19,15,.45)" }}
                  >
                    {reveal ? "Hide" : "Show"}
                  </button>
                </span>
              </div>

              {needsCode && (
                <div className="flex flex-col gap-2.5">
                  <label className={CAPS} htmlFor="code" style={{ color: "rgba(20,19,15,.5)" }}>
                    Authenticator code
                  </label>
                  <input
                    id="code"
                    autoFocus
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9 ]*"
                    maxLength={7}
                    placeholder="123 456"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onFocus={(e) => (e.currentTarget.style.borderColor = VERMILLION)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(20,19,15,.22)")}
                    className={`${FIELD} font-mono tracking-[0.3em] placeholder:text-[color:rgba(20,19,15,.34)]`}
                    style={FIELD_LINE}
                  />
                </div>
              )}

              {/*
                Only present when there is an error. A reserved always-there
                line read as a stray gap between the password and the button;
                the layout shift on failure is the smaller cost, because
                failure is the rare path and the resting page is what
                everyone sees.
              */}
              {error && (
                <p role="alert" className="text-[14px] leading-[1.45]" style={{ color: "#a6301b" }}>
                  {error}
                </p>
              )}

              {/*
                The button and the way out, on one line (27e). "Forgotten it?"
                reads in the order the trouble happens — try, fail, then here
                is the door out — and sitting beside the action rather than
                under the field keeps the form to two ruled lines.
              */}
              <div className="mt-1 flex flex-wrap items-center gap-x-7 gap-y-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="pressable rounded-full px-9 py-[15px] text-[15px] font-medium leading-none transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: VERMILLION, color: PAPER }}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="py-1 text-[14.5px]"
                  style={{ color: "rgba(20,19,15,.6)" }}
                >
                  Forgotten it?
                </button>
              </div>

              <p className="mt-2 text-[13px] leading-[1.6]" style={{ color: "rgba(20,19,15,.5)" }}>
                Profiles and PINs come after this — the family key only opens the door.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
