import { useEffect, useRef, useState } from "react";

/**
 * The new PIN, given a surface (frames 12c–12f).
 *
 * It used to be one reserved line of text under the button: "New PIN: 988364 —
 * shown only once." That is the correct information in the wrong shape. This
 * code exists to be *read out over the phone* or copied into a message, by
 * somebody who will not see it again — and a 14px sentence you have to find
 * with your eye is the worst possible container for a thing you get one look
 * at.
 *
 * So: a dialog, the digits at 82px in two groups of three, and the three ways
 * a person actually passes a code on — copy it, copy a message around it, or
 * read it aloud down the phone.
 *
 * Four states, one component:
 *   sent    (12c) the email went
 *   failed  (12d) it did not, and the code still works
 *   copied  (12e) after Copy code
 *   aloud   (12f) the phone-call view
 */

/** "988364" → "988 364", the way a person says it. */
function split(pin: string): [string, string] {
  const clean = pin.replace(/\D/g, "");
  const half = Math.ceil(clean.length / 2);
  return [clean.slice(0, half), clean.slice(half)];
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * "988364" → "Nine eight eight, three six four."
 *
 * For the person reading it down a phone line to someone who cannot see the
 * screen. Digits spoken one at a time — never "nine hundred and eighty-eight",
 * which is a different thing to type.
 */
function aloud(pin: string): string {
  const [a, b] = split(pin);
  const say = (part: string) =>
    part
      .split("")
      .map((d) => WORDS[Number(d)] ?? d)
      .join(" ");
  const first = say(a);
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}, ${say(b)}.`;
}

export function PinRevealDialog({
  pin,
  name,
  email,
  emailSent,
  subject,
  onRetryEmail,
  retrying,
  onClose,
}: {
  pin: string;
  name: string;
  email?: string | null;
  emailSent: boolean;
  /** Whose archive it is, for the message the admin forwards. */
  subject: string;
  /*
    Optional, and currently never passed (see the call site). 12d draws a
    "Try again", but a PIN is stored hashed and shown once, so nothing can
    re-send the same code — only issue a different one. The prop stays for the
    day a resend-this-code path exists; until then the failure text is the
    whole answer.
  */
  onRetryEmail?: () => void;
  retrying?: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"code" | "message" | null>(null);
  const [readingAloud, setReadingAloud] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [a, b] = split(pin);

  const message = `Hello ${name} — your new PIN for ${subject}'s archive is ${a} ${b}. Sign in at recall.family. Please keep it to yourself.`;

  /*
    Focus lands on the dismissal, and **nothing else dismisses** (12c).

    The frame is explicit: "dismissal is `I've saved it`, and a stray click
    does not close it." Escape used to close, and so did a mousedown on the
    scrim — both perfectly ordinary dialog behaviour, and both wrong for this
    one dialog, because what is on screen is the only copy of the code that
    will ever exist. We keep a hash; nobody can read it back. A misplaced
    click while reaching for Copy, or an Escape pressed out of habit, ends
    with an administrator on the phone to somebody who still cannot sign in,
    and the only way forward is issuing a different code.

    So the way out is the button that says the true thing — I have saved it —
    and it is the first thing focus reaches, which is also the keyboard route
    to leaving.
  */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function copy(what: "code" | "message") {
    try {
      await navigator.clipboard.writeText(what === "code" ? `${a} ${b}` : message);
      setCopied(what);
    } catch {
      /* A refused clipboard is not worth an error here: the digits are on
         screen at 82px, which is the fallback. */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(11,11,12,.55)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={readingAloud ? "Read this PIN aloud" : `New PIN for ${name}`}
        className="w-full max-w-[600px] rounded-[26px] p-[38px_40px_32px]"
        style={{
          background: "var(--panel-dialog)",
          border: "1px solid rgba(var(--ink),.22)",
          boxShadow: "var(--shadow-dialog)",
        }}
      >
        <p
          className="font-mono text-[12px] tracking-[0.14em]"
          style={{ color: "var(--fgw-hint)" }}
        >
          {readingAloud ? "READ THIS ALOUD" : `NEW PIN · ${name.toUpperCase()}`}
        </p>

        {/* Two groups of three, so it reads as 988 364 and not 988364 — the
            gap is what a person's voice does anyway. */}
        <div className="mt-[26px] flex items-baseline justify-center gap-[26px]">
          {[a, b].map((part, i) => (
            <span
              key={i}
              className="font-mono text-[64px] leading-none md:text-[82px]"
              style={{ color: "var(--cream)", fontWeight: 500, letterSpacing: ".02em" }}
            >
              {part}
            </span>
          ))}
        </div>

        {readingAloud ? (
          <>
            {/* 12f — for the phone call. Spoken digit by digit, because
                "nine hundred and eighty-eight" is a different thing to type. */}
            <p
              className="mt-[22px] text-center text-[17px] leading-[1.6]"
              style={{ color: "rgba(var(--ink),.85)" }}
            >
              {aloud(pin)}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setReadingAloud(false)}
                className="whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                style={{ border: "1px solid rgba(var(--ink),.22)", color: "var(--cream)" }}
              >
                Back to the panel
              </button>
              <button
                type="button"
                onClick={() => void copy("code")}
                className="whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
              >
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p
              className="mt-[22px] text-center text-[13.5px] leading-[1.6]"
              style={{ color: "rgba(var(--ink),.7)" }}
            >
              Shown once. We can&apos;t read it back — only issue a new one.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => void copy("code")}
                className="whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
              >
                {copied === "code" ? "Copied" : "Copy code"}
              </button>
              <button
                type="button"
                onClick={() => void copy("message")}
                className="whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                style={{ border: "1px solid rgba(var(--ink),.22)", color: "var(--cream)" }}
              >
                {copied === "message" ? "Message copied" : "Copy a message to send them"}
              </button>
              <button
                type="button"
                onClick={() => setReadingAloud(true)}
                className="whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                style={{ border: "1px solid rgba(var(--ink),.22)", color: "var(--cream)" }}
              >
                Large text
              </button>
            </div>

            {/* 12e's line. It says where the code went, because a clipboard is
                a place and people worry about it. */}
            <p
              className="mt-3 h-4 text-center text-[12px]"
              style={{ color: "var(--fgw-quiet)", visibility: copied ? "visible" : "hidden" }}
              role="status"
            >
              {copied ? "Copied to the clipboard. It is not saved anywhere else." : " "}
            </p>

            <div className="my-[22px] h-px" style={{ background: "rgba(var(--ink),.12)" }} />

            {/* 12c / 12d — what happened to the email, and what to do if it
                did not go. The failure is the live case for most families:
                a contributor without an address never gets one. */}
            <div
              className="flex items-center gap-3 rounded-[14px] p-[13px_16px]"
              style={{ border: "1px solid rgba(var(--ink),.12)" }}
            >
              <span
                className="h-[7px] w-[7px] flex-none rounded-full"
                style={{
                  background: emailSent ? "oklch(0.72 0.16 150)" : "var(--accent)",
                }}
              />
              <span className="flex-1 text-[13px]" style={{ color: "rgba(var(--ink),.75)" }}>
                {emailSent ? (
                  <>Sent to {email}</>
                ) : (
                  <>
                    We couldn&apos;t send the email.{" "}
                    <span style={{ color: "var(--fgw-hint)" }}>
                      The code above still works. Pass it on yourself.
                    </span>
                  </>
                )}
              </span>
              {!emailSent && onRetryEmail && (
                <button
                  type="button"
                  onClick={onRetryEmail}
                  disabled={retrying}
                  className="flex-none text-[13px] underline underline-offset-2 disabled:opacity-40"
                  style={{ color: "var(--accent-soft)" }}
                >
                  {retrying ? "Trying…" : "Try again"}
                </button>
              )}
            </div>

            <p
              className="mt-[22px] font-mono text-[11px] tracking-[0.14em]"
              style={{ color: "var(--fgw-hint)" }}
            >
              THE MESSAGE
            </p>
            <p
              className="mt-2.5 rounded-[14px] p-[13px_16px] text-[13px] leading-[1.6]"
              style={{ background: "rgba(var(--ink),.04)", color: "rgba(var(--ink),.7)" }}
            >
              {message}
            </p>
          </>
        )}

        <div className="mt-7 flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-[11px] text-[13px] font-medium leading-none"
            style={{ border: "1px solid rgba(var(--ink),.22)", color: "var(--cream)" }}
          >
            I&apos;ve saved it
          </button>
        </div>
      </div>
    </div>
  );
}
