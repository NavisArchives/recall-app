import type { ReactNode } from "react";
import type { Author } from "@/types";

/**
 * ACCESS — frames 12b, 12k, 12m.
 *
 * "The half the admin came for." Somebody arrives at this page because a
 * person cannot get in, and until now the page answered with a status pill
 * and a stack of buttons: no date of last sign-in, no word on whether a PIN
 * had ever been set, nothing about the invitation. The three facts an admin
 * is actually looking for were the three the page did not state.
 *
 * Three rows, always the same three, in the same order — so the answer is
 * found by position rather than by reading. Each carries its own action
 * where an admin looks for it (12k: "Resend and Copy link sit on the
 * invitation row, not in the button stack").
 *
 * ── What this block refuses to do ────────────────────────────────────────
 *
 * It never prints a date it does not have. Every value here is either a real
 * timestamp from the server or an explicit word — "Never", "Never set" —
 * that means the absence itself. This page spent a week having figures
 * invented from `?? []`; a fabricated "last signed in" would be the same
 * mistake about something an admin is about to act on.
 */

function Row({
  label,
  value,
  tone,
  action,
  hint,
}: {
  label: string;
  value: ReactNode;
  /** `accent` is for a value that is not neutral information (12k). */
  tone?: "accent";
  action?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="border-t border-line-soft py-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="label-caps flex-none">{label}</p>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <span
            className="text-[14px]"
            style={{ color: tone === "accent" ? "var(--accent-soft)" : "var(--fg)" }}
          >
            {value}
          </span>
          {action}
        </div>
      </div>
      {hint && (
        <p className="mt-2 max-w-prose text-[13px] leading-[1.6]" style={{ color: "var(--fg-faint)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "long" })
    : null;

/** "3 days ago", or null when there is no date to count from. */
export function ago(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return null;
}

export function AccessBlock({
  person,
  locked,
  lockedUntil,
  onResetPin,
  onClearLockout,
  onResend,
  onCopyLink,
  copiedLink,
  busy,
  failure,
}: {
  person: Author;
  locked: boolean;
  lockedUntil: Date | null;
  onResetPin: () => void;
  onClearLockout: () => void;
  onResend: () => void;
  onCopyLink: () => void;
  copiedLink: boolean;
  busy: string | null;
  /**
   * A failure belonging to one of these rows (12o) — Clear lockout is an
   * action taken here, so its failure is reported here rather than beside a
   * button on the other side of the page.
   */
  failure?: ReactNode;
}) {
  const joined = !!person.joined_at;
  const lastSeen = person.last_seen_at;
  const relative = ago(lastSeen);

  /*
    `undefined` is not `null`, and the difference matters more here than
    anywhere else on the page.

    `null` means the archive knows they have never signed in. `undefined`
    means the field was never sent — which is what a non-admin receives,
    because `/people/:id` narrows its columns by the reader. Collapsing the
    two prints "Never" for somebody who signs in daily, on the row an admin
    reads before deciding whether to reset a working PIN.

    The page only draws this block for an admin, so this should never fire.
    It is here because "should never fire" is exactly the reasoning that put
    a false exemption in the backstop earlier this week.
  */
  const seenKnown = lastSeen !== undefined;

  /*
    48px on a phone, per 12p — "targets are 48px and up". These were 26px
    tall, which is under every touch guideline, and Resend is the control an
    admin presses while somebody waits for an invitation to arrive.
    `min-h` rather than a fixed height so the label still centres.
  */
  const linkAction =
    "inline-flex min-h-[48px] items-center rounded-full px-4 text-[12px] leading-none transition-colors hover:border-accent disabled:opacity-40 sm:min-h-[32px] sm:px-3.5";

  return (
    <section className="mt-8 border-t border-line-soft pt-6">
      <p className="label-caps">Access</p>
      {failure && <div className="mt-3 max-w-2xl">{failure}</div>}

      <div className="mt-3 max-w-2xl">
        <Row
          label="Last signed in"
          value={
            lastSeen ? (
              <>
                {relative ? `${relative} · ` : ""}
                {new Date(lastSeen).toLocaleString("en-GB", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              </>
            ) : seenKnown ? (
              /*
                "Never" is the honest answer and it is information, not an
                absence of it — an invited person who never arrived looks
                exactly like this, and that is what an admin needs to see.
              */
              "Never"
            ) : (
              <span style={{ color: "var(--fg-faint)" }}>Not known</span>
            )
          }
        />

        <Row
          label="PIN"
          tone={!joined ? "accent" : undefined}
          value={
            !joined ? (
              /*
                12k. The one PIN value in `--accent-soft`: "Never set" is not
                neutral information, it means the invitation never landed.
              */
              "Never set"
            ) : locked && lockedUntil ? (
              `Locked until ${lockedUntil.toLocaleTimeString("en-GB", { timeStyle: "short" })}`
            ) : (
              /*
                We know a PIN exists, and deliberately not when it was set —
                there is no such column, and inventing "Set 12 June" from
                `created_at` would be a date about the wrong event.
              */
              "Set"
            )
          }
          action={
            locked ? (
              /*
                12m. The only amber-outlined action on the page: it is the
                thing an admin came here to do at 14:08, with somebody
                waiting on the phone. The alternative today is waiting it out
                or burning a working PIN.
              */
              <button
                type="button"
                onClick={onClearLockout}
                disabled={busy === "lockout"}
                className={linkAction}
                style={{ border: "1px solid var(--accent-soft)", color: "var(--accent-soft)" }}
              >
                {busy === "lockout" ? "Clearing…" : "Clear lockout"}
              </button>
            ) : joined ? (
              <button
                type="button"
                onClick={onResetPin}
                disabled={busy === "pin"}
                className={linkAction}
                style={{ border: "1px solid var(--line)", color: "var(--fg)" }}
              >
                Reset PIN
              </button>
            ) : null
          }
          hint={
            locked && lockedUntil ? (
              <>
                Too many wrong attempts. It clears itself at{" "}
                {lockedUntil.toLocaleTimeString("en-GB", { timeStyle: "short" })} — or clear it now
                and they can try again. Their PIN still has to be right.
              </>
            ) : !joined ? (
              /* 12k: says why Reset PIN is the wrong tool here. */
              <>
                The invitation was never completed, so there is no code to reset. Resending is the
                way in.
              </>
            ) : null
          }
        />

        <Row
          label="Invitation"
          value={
            joined ? (
              `Joined ${when(person.joined_at)}`
            ) : (
              <>Invited {when(person.created_at)} · not yet joined</>
            )
          }
          action={
            !joined ? (
              <>
                <button
                  type="button"
                  onClick={onResend}
                  className={linkAction}
                  style={{ border: "1px solid var(--line)", color: "var(--fg)" }}
                >
                  Resend
                </button>
                <button
                  type="button"
                  onClick={onCopyLink}
                  className={linkAction}
                  style={{
                    border: "1px solid var(--line)",
                    color: copiedLink ? "var(--accent-soft)" : "var(--fg)",
                  }}
                >
                  {copiedLink ? "Copied" : "Copy link"}
                </button>
              </>
            ) : null
          }
        />
      </div>
    </section>
  );
}
