import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";

/**
 * `/invite/<token>` — the premium moment (M44).
 *
 * Somebody the platform owner spoke to opens a link. This is the first thing
 * they see of Recall, and it does one thing: says what this is, and offers
 * one button. No form, no fields, no choices — the form is on the other side
 * of Begin, once the link is known to be good.
 *
 * The token is checked *before* the form rather than after it, so a dead link
 * is a sentence on the first screen instead of a rejection after somebody has
 * typed their mother's name and birthday in.
 *
 * Invalid, expired, revoked, already-used and fabricated all end the same
 * gentle way. That is not politeness, it is the absence of an oracle: a
 * stranger feeding it guesses learns nothing from the difference.
 */
export function FoundingInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ready" | "dead">("checking");
  const [email, setEmail] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .post<{ ok: true; email: string }>("/onboarding/founding/check", { token })
      .then((res) => {
        if (!alive) return;
        setEmail(res.email);
        setState("ready");
      })
      .catch(() => alive && setState("dead"));
    return () => {
      alive = false;
    };
  }, [token]);

  if (state === "checking") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-fg-muted">One moment…</p>
      </div>
    );
  }

  if (state === "dead") {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-[460px] max-w-full text-center">
          <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.01em]">
            This invitation has closed
          </h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-muted">
            Invitations work once and last thirty days. If you think yours should still be open,
            reply to the email it came in and we will send another.
          </p>

          {/*
            The same door M193 gave `JoinPage`, on the page that actually
            carries the link (M193, third criterion).

            `e8b6233` fixed the code-entry screen and left this one, which
            is where the founding invitation itself lands: `/invite/<token>`.
            An invitation is spent on first use, so the person most likely to
            see this sentence is somebody who joined weeks ago and tapped the
            old link again — and until now the only thing offered was "reply
            to the email", which asks a person who already has an account to
            write to a stranger and wait.

            Offering sign-in to *everyone* who reaches this state gives a
            guesser nothing: the page still refuses to say which of expired,
            revoked, spent or fabricated it was, so the door is not an
            oracle. It is the same sentence for all of them, and the same
            way out.
          */}
          <p className="mt-6 text-[13px] leading-[1.5] text-fg-faint">
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-[560px] max-w-full text-center">
        <p className="font-mono text-[11px] leading-none tracking-[0.18em] text-accent">
          RECALL · AN INVITATION
        </p>

        <h1 className="mt-6 text-[40px] font-bold leading-[1.15] tracking-[-0.01em]">
          A living archive of one person's life
        </h1>

        <p className="mt-4 text-[15px] leading-[1.7] text-fg-muted">
          Photographs, voices and films, gathered by the people who love them and shown on a screen
          in their home — opened by touching an everyday object, with no menus and nothing to
          learn.
        </p>

        <button
          type="button"
          onClick={() => navigate("/signup", { state: { founderToken: token } })}
          className="mt-9 rounded-[12px] bg-accent px-10 py-[17px] text-[15px] font-medium leading-none text-accent-foreground transition-opacity hover:opacity-90"
        >
          Begin
        </button>

        <p className="mt-5 text-[13px] text-fg-faint">
          Invited as {email}. It takes a few minutes.
        </p>
      </div>
    </div>
  );
}
