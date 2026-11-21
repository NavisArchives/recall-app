import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  KIOSK_MIN_HEIGHT,
  KIOSK_MIN_WIDTH,
  useFitsKiosk,
  useIsHandheld,
} from "@/lib/kioskFit";
import { useDoorTheme } from "@/lib/useWorkspaceTheme";

/**
 * The last step of the trusted-device replacement ceremony (M117), opened
 * from the link in the family's inbox — on the machine that is about to
 * become the screen.
 *
 * One deliberate press stands between the link and the takeover. An email
 * link can be opened by a scanner, a preview, or a curious tap on the wrong
 * device, and this act retires the screen in the living room — so nothing
 * happens on load, and the button says exactly what it does.
 */
export function ReplaceScreenPage() {
  const navigate = useNavigate();
  /* Every door follows the colour the person chose (owner, 17 Sep 2026). */
  const { attrs: doorAttrs } = useDoorTheme();
  const [params] = useSearchParams();
  const { completeScreenReplacement } = useAuth();
  const token = params.get("t") ?? "";

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
    Where the phone actually gets in (M192).

    The link arrives by email, and email is read on a phone — so this page,
    not the sign-in form, is the realistic route by which a handset becomes
    the screen in Margaret's living room. It is also the worst place for it
    to happen, because taking over *retires the old screen*: get it wrong
    here and the display in the living room goes dark, and the machine that
    replaced it is in somebody's pocket.

    Two refusals, deliberately kept as two (see `lib/kioskFit.ts`):

      the law    — a phone is never the family screen, even one that would
                   render correctly, because the owner said never.
      the floor  — a window too small to draw the display, which is not a
                   statement about phones at all.

    A person is told which one it is, because the two have different ways
    out: a small window can be made bigger, and a phone cannot stop being a
    phone.
  */
  const handheld = useIsHandheld();
  const fits = useFitsKiosk();
  const refusal = handheld ? "handheld" : fits ? null : "too-small";

  async function takeOver() {
    setBusy(true);
    setError(null);
    try {
      await completeScreenReplacement(token);
      // This machine is the family screen now; its front door is her display.
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That link is not valid any more.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div {...doorAttrs} style={{ background: "var(--ground)" }} className="door-contrast flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-[380px] text-center">
        <p className="text-2xl font-bold tracking-tight">Recall</p>

        <h1 className="mt-10 text-[22px] font-medium leading-[1.3]">
          Make this the family screen
        </h1>
        <p className="mt-3 text-[13px] leading-[1.6] text-fg-muted">
          This device becomes the one screen the family trusts — the display in
          the living room. The old screen is signed out and stops working the
          moment this one takes over. Your memories are untouched.
        </p>

        {!token && (
          <p className="mt-6 text-sm leading-[1.5] text-destructive-soft">
            This link is missing its key. Open the full link from the family
            email on this device.
          </p>
        )}

        {/* Reserved, so the refusal never moves the button mid-press. */}
        {token && (
          <p
            role="alert"
            className="mt-6 min-h-5 text-sm leading-[1.5] text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>
        )}

        {/*
          The refusal replaces the button rather than disabling it. A greyed
          control on the page still reads as "this is the thing to do, and
          you have done something wrong" — and neither is true here.
        */}
        {token && refusal === "handheld" && (
          <p className="mt-6 text-sm leading-[1.6] text-fg-muted">
            A phone cannot be the family screen. The display is built for a screen that stays in
            one place, where it can be seen from across a room. Open this link on the tablet,
            monitor or computer that will live in the room with her — the link keeps working.
          </p>
        )}

        {token && refusal === "too-small" && (
          <p className="mt-6 text-sm leading-[1.6] text-fg-muted">
            This window is too small to show the display, so the takeover would leave the family
            with a screen that cuts its own memories off. Make the window bigger — at least{" "}
            {KIOSK_MIN_WIDTH} by {KIOSK_MIN_HEIGHT} — and this button comes back.
          </p>
        )}

        {token && !refusal && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void takeOver()}
            className="mt-4 w-full rounded-[12px] bg-accent px-8 py-[15px] text-[15px] font-medium leading-none text-accent-foreground disabled:opacity-40"
          >
            {busy ? "Taking over…" : "Make this the family screen"}
          </button>
        )}

        <p className="mt-8 text-[13px] leading-[1.6] text-fg-faint">
          Not what you meant to do?{" "}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="underline underline-offset-2 hover:text-fg"
          >
            Go to sign-in
          </button>
          {/*
            The reassurance only makes sense when there *is* a button (M193).

            "Nothing changes until the button above is pressed" rendered in
            the no-key state too, where the button is deliberately absent —
            pointing at a control that is not on the screen. Someone who
            opened a truncated link was told to press something they could
            not see, on a page about replacing the screen their family
            depends on. Without the key, the page has already changed
            nothing and cannot, so it says that instead.
          */}
          {/*
            M193's rule, which this page taught me, applied to its own new
            state: do not point at a button that is not on the screen. When
            the takeover is refused there is no button above, so the sentence
            that promises one would be the same mistake in a new place.
          */}
          {!token
            ? " — this page cannot change anything without the key."
            : refusal
              ? " — nothing has been changed, and nothing will be from here."
              : " — nothing changes until the button above is pressed."}
        </p>
      </div>
    </div>
  );
}
