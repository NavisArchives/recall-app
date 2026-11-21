import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Monitor, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { renewalStatus } from "@/lib/renewal";

/**
 * Which machines are this family's screens (047).
 *
 * Settings could sign *this* browser out and that was the whole of it, so
 * the product never answered the plainest question a family has about its
 * own display: **which device is it?** A household could not tell a screen
 * that was asleep from one that had been retired, could not see when it was
 * last used, and — if the machine was gone — had no way to free the slot
 * except a link posted to the family inbox.
 *
 * Two kinds of row, and the difference is the whole design:
 *
 *   **A Recall device** is hardware this project ships. It carries a mark
 *   instead of a control, because retiring it is not the family's to do —
 *   and it does not hold the browser-screen slot, so the invitation to add
 *   another machine stays open beside it.
 *
 *   **A browser screen** is a machine the family paired itself, and it is
 *   theirs to retire. That is the way out that did not exist before.
 *
 * Every state is asked for rather than assumed: a failed read says it could
 * not be read, and never draws an empty house — "no screen is paired" is the
 * one sentence that would send somebody to spend a slot they already spent.
 */

const LABEL = "font-mono text-[11px] tracking-[0.16em] text-fg-muted";

export interface Screen {
  id: string;
  name: string | null;
  is_recall_device: boolean;
  trusted_at: string | null;
  last_used_at: string | null;
  software_version: string | null;
  /** 056 — when the trusted screen's session is due for renewal. Never a deadline that stops anything. */
  session_expires_at: string | null;
}

function when(at: string | null): string | null {
  if (!at) return null;
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

export function ScreensBlock({ subject }: { subject: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const {
    data: screens,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["settings-screens"],
    queryFn: () => api.get<Screen[]>("/settings/screens"),
  });

  const retire = useMutation({
    mutationFn: (id: string) => api.post(`/settings/screens/${id}/retire`, {}),
    onSuccess: () => {
      setConfirming(null);
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: ["settings-screens"] });
    },
    onError: (err: unknown) =>
      setFailed(err instanceof Error ? err.message : "That screen could not be retired."),
  });

  const renew = useMutation({
    mutationFn: () => api.post("/settings/screens/renew", {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings-screens"] }),
  });

  /*
    Only a browser screen holds the slot (047). Hardware sits beside it, so a
    family that owns a Recall device is still invited to add the tablet in
    the kitchen — the thing the old one-trusted-device rule refused them.
  */
  const paired = screens ?? [];
  const hasBrowserScreen = paired.some((s) => !s.is_recall_device);
  const unread = isPending || isError;

  return (
    <section className="mt-8 border-t border-line-soft pt-6">
      <p className={LABEL}>SCREENS</p>
      <p className="mt-2.5 text-[15px] text-fg-muted">
        The machines that play {subject ? `${subject}'s` : "the"} archive in the room. Everything
        else — phones, laptops, this page — signs in as a person instead.
      </p>

      {unread && (
        <p className="mt-3.5 text-sm text-fg-muted">
          {isPending ? "Checking…" : "The screens could not be read, so we cannot say what is paired."}
        </p>
      )}

      {!unread && paired.length === 0 && (
        <p className="mt-3.5 text-sm text-fg-muted">
          No screen is paired. Until one is, {subject ? `${subject}'s` : "the"} display has nowhere
          to play.
        </p>
      )}

      {isAdmin && !unread && <RenewalBanner screens={paired} busy={renew.isPending} onRenew={() => renew.mutate()} error={renew.isError} />}

      {!unread && paired.length > 0 && (
        <ul className="mt-3.5 flex flex-col gap-2.5">
          {paired.map((screen) => (
            <ScreenRow
              key={screen.id}
              screen={screen}
              confirming={confirming === screen.id}
              busy={retire.isPending}
              onAsk={() => {
                setConfirming(screen.id);
                setFailed(null);
              }}
              onCancel={() => {
                setConfirming(null);
                setFailed(null);
              }}
              onRetire={() => retire.mutate(screen.id)}
            />
          ))}
        </ul>
      )}

      {failed && (
        <p role="alert" className="mt-2.5 text-sm" style={{ color: "var(--destructive-soft)" }}>
          {failed}
        </p>
      )}

      {/*
        The invitation, and it is deliberately offered even when a browser
        screen already holds the slot — the refusal a person needs to read is
        the one the door gives, which names the ceremony. Hiding the control
        would leave them with a question and nowhere to ask it.

        Not shown while the list is unread: inviting somebody to set up a
        second screen on the strength of a failed request is how the slot
        gets spent twice.
      */}
      {!unread && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/screen-setup")}
            className="min-h-[44px] sm:min-h-0 rounded-md px-5 py-2.5 text-sm transition-colors hover:border-accent"
            style={{ border: "1px solid var(--line)" }}
          >
            {hasBrowserScreen ? "Set up a different screen" : "Set up a screen"}
          </button>
          <span className="text-xs text-fg-faint">
            {hasBrowserScreen
              ? "Retire the one above first — a family runs one screen of its own beside any Recall device."
              : "Open Recall on that machine and confirm with the family password."}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * The admin-only renewal notice (056, owner's numbers: 90-day standard, a
 * 14-day advance notice, admin-only, renew before it ever lapses — it never
 * goes straight to expired).
 *
 * Silent outside the window: a family should never see a housekeeping date
 * that is not yet due. Silent for a co-author too — the route itself is
 * `requireRole(CAN_MANAGE_PEOPLE)`, admin-only, so this component only needs
 * to keep from offering a control that would 403.
 */
function RenewalBanner({
  screens,
  busy,
  onRenew,
  error,
}: {
  screens: Screen[];
  busy: boolean;
  onRenew: () => void;
  error: boolean;
}) {
  const browserScreen = screens.find((s) => !s.is_recall_device && s.session_expires_at);
  const status = browserScreen ? renewalStatus(browserScreen.session_expires_at) : null;
  if (!status?.visible) return null;
  const { overdue, dueLabel: due } = status;

  return (
    <div
      role="status"
      className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] p-3.5"
      style={{
        border: `1px solid ${overdue ? "rgba(220,90,80,.4)" : "rgba(var(--accent-channels),.4)"}`,
        background: overdue ? "rgba(220,90,80,.08)" : "rgba(var(--accent-channels),.08)",
      }}
    >
      <p className="text-[13.5px] leading-[1.5]" style={{ color: overdue ? "var(--destructive-soft)" : "var(--accent-soft)" }}>
        {overdue
          ? `The screen was due to renew on ${due}. Her screen keeps playing — this is just housekeeping.`
          : `Renew by ${due} — her screen keeps playing either way.`}
      </p>
      <button
        type="button"
        onClick={onRenew}
        disabled={busy}
        className="min-h-[44px] flex-none rounded-full px-4 py-2 text-[13px] leading-none transition-colors hover:border-accent disabled:opacity-50 sm:min-h-0"
        style={{ border: "1px solid var(--line)" }}
      >
        {busy ? "Renewing…" : "Renew now"}
      </button>
      {error && (
        <p role="alert" className="basis-full text-[12.5px]" style={{ color: "var(--destructive-soft)" }}>
          That did not go through. Nothing has changed — try again.
        </p>
      )}
    </div>
  );
}

/**
 * One machine, as a row — presentation only, so the states this component has
 * that a fetch cannot reach (hardware, a never-used screen, mid-confirm) are
 * renderable in `/dev/states` with no session and no server.
 *
 * The alternative was to verify the populated list by reading the source,
 * which is the thing this project stopped accepting as evidence.
 */
export function ScreenRow({
  screen,
  confirming,
  busy,
  onAsk,
  onCancel,
  onRetire,
}: {
  screen: Screen;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRetire: () => void;
}) {
  /*
    "Paired" and "last used" are different dates and only one of them may
    wear the words "last used".

    The first draft fell back from `last_used_at` to `trusted_at` and kept
    the same label, so a machine paired in February and never opened since
    reported **"Last used 1 Feb 2026"** — a date on which nobody used it.
    Caught by putting the row in `/dev/states` with a null `last_used_at`,
    which is the state the live list cannot be made to show on demand.

    A screen that has never been opened is the single most useful thing this
    list can tell somebody: it means the machine is paired and the display is
    not actually running in the room.
  */
  const used = when(screen.last_used_at);
  const paired = when(screen.trusted_at);
  const last = used
    ? `Last used ${used}`
    : paired
      ? `Paired ${paired}, not opened since`
      : "Not used yet";

  return (
              <li
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-line-soft p-3.5"
              >
                <span
                  className="min-h-[44px] sm:min-h-0 flex h-9 w-9 flex-none items-center justify-center rounded-full"
                  style={{ background: "var(--accent-tint)" }}
                >
                  {screen.is_recall_device ? (
                    <ShieldCheck size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} aria-hidden />
                  ) : (
                    <Monitor size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} aria-hidden />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px]">{screen.name || "The family screen"}</span>
                    {screen.is_recall_device && (
                      <span
                        className="min-h-[44px] sm:min-h-0 rounded-full px-2.5 py-[5px] font-mono text-[9px] leading-none tracking-[0.08em]"
                        style={{ background: "var(--accent-tint)", color: "var(--accent-on-tint)" }}
                      >
                        RECALL DEVICE
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-fg-faint">
                    {/*
                      Three separate facts, each printed only if it is known.
                      A screen that has never reported a version says nothing
                      about its version rather than "unknown", which reads as
                      a fault on a row that is working perfectly well.
                    */}
                    {[last, screen.software_version ? `Version ${screen.software_version}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>

                {screen.is_recall_device ? (
                  <span className="text-xs text-fg-faint">Stays with the archive</span>
                ) : confirming ? (
                  <span className="flex items-center gap-4 text-sm">
                    <span className="text-fg-muted">Retire it?</span>
                    <button type="button" onClick={onCancel} className="text-fg-faint hover:text-fg">
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onRetire}
                      style={{ color: "var(--destructive-soft)" }}
                    >
                      {busy ? "Retiring…" : "Retire"}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onAsk}
                    className="min-h-[44px] sm:min-h-0 rounded-md px-4 py-2 text-sm transition-colors hover:border-accent"
                    style={{ border: "1px solid var(--line)" }}
                  >
                    Retire
                  </button>
                )}
              </li>
  );
}
