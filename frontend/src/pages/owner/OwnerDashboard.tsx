import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Inbox,
  LogOut,
  MonitorSmartphone,
  Printer,
  Receipt,
  Search,
  X,
} from "lucide-react";
import { api, API_ORIGIN } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Wordmark } from "@/components/Wordmark";
import { isGenuinelyMissing } from "@/lib/missingOrUnreachable";
import { PostcardFront, PostcardBack } from "@/components/admin/PostcardPreview";
import { PaymentCell, type FamilyPayment } from "./PaymentCell";
import { OwnerSignIn } from "./OwnerSignIn";
import { StepUpDialog, TwoStepSignIn, needsStepUp, readStepUp } from "./OwnerSecurity";
import {
  OWNER_SWATCH,
  OWNER_THEMES,
  ownerThemeAttrs,
  ownerThemeStyle,
  useOwnerTheme,
  type OwnerTheme,
} from "./ownerTheme";

/**
 * The platform owner's dashboard (M55) — information, never content.
 *
 * Not the family owner's page. A family owner administers one archive and can
 * read every memory in it; the platform owner sees how many families exist,
 * how big they are and whether anyone is using them, and has no route to a
 * single photograph. That boundary is enforced in the backend, not here — but
 * this page is written so it could not display content even if it arrived.
 *
 * Its failed states are now inspectable without a platform-owner session
 * (M221) — the three queries can be failed one at a time:
 *
 *   /dev/pages/owner?mode=empty&role=admin                        launch day
 *   /dev/pages/owner?mode=empty&role=admin&fail=/owner/families    the outage door
 *   /dev/pages/owner?mode=empty&role=admin&fail=/owner/door        the doorstep withholds
 *   /dev/pages/owner?mode=empty&role=admin&fail=/owner/health      four dashes
 *   /dev/pages/owner?mode=notfound&role=admin                      a stranger, unchanged
 *
 * The last one is the control that matters: a stranger must still get the
 * bare "Nothing here." with no reason and no retry, or the outage wording
 * added for the owner has leaked the distinction the 404 exists to hide.
 *
 * Reachable only by typing `/owner`. Linked from no family navigation, the
 * same convention as `/admin`, and every refusal behind it is 404-shaped so
 * a family admin who guesses the path learns only that there is nothing
 * there.
 *
 * Signing in happens here as well as at `/login` — see the note above the
 * `!signedIn` branch for why that costs the 404 nothing. The states gallery
 * cannot reach that branch, because its stub answers every `/auth/session`
 * with a session; to look at it, sign out and open `/owner`.
 */

interface FamilyRow {
  archive_id: string | null;
  family_name: string | null;
  email: string;
  created_at: string;
  is_platform_owner: boolean;
  /*
    `null` when that count could not be read (M221). A real zero is a real
    zero — a new family genuinely has none — so the type has to carry the
    difference the backend now sends.
  */
  members: number | null;
  channels: number | null;
  media_files: number | null;
  storage_bytes: number | null;
  last_activity: string | null;
  /*
    Three answers, not two (M221). `false` is "no trusted screen"; `null` is
    "the installations table could not be read", and the difference decides
    whether somebody rings this family to ask why they never set it up.
  */
  screen_paired: boolean | null;
  screen_last_seen: string | null;
  subscription: string;
  /** The family row's id — the payment routes are keyed on it (055). */
  family_id: string;
  /** The manual-invoice state machine (055); absent from an older API. */
  payment?: FamilyPayment;
}

interface Health {
  /**
   * Three outcomes, not two (M68).
   *
   * "down" is a database nobody can reach. "error" is one that answered and
   * refused — a renamed column, a permission fault. They need different
   * reactions from the person reading this page, so they are different words.
   */
  database: "up" | "down" | "error";
  detail: string | null;
  families: number | null;
  memories: number | null;
  subscriptions: number | null;
  errors_24h: number | null;
  storage: number | null;
}

interface DoorRequest {
  id: string;
  email: string;
  name: string | null;
  note: string | null;
  status: "pending" | "invited" | "dismissed";
  created_at: string;
  /** 057 — which configuration and billing they chose on the request page. */
  interested_tier?: "digital" | "dock" | null;
  billing_period?: "monthly" | "yearly" | null;
}

interface FoundingInvitation {
  id: string;
  email: string;
  note: string | null;
  created_at: string;
  state: "waiting" | "accepted" | "expired" | "revoked";
  expires_at: string;
}

const HEAD = "px-3 py-2.5 text-left font-mono text-[10px] tracking-[0.16em] text-fg-faint";

/** A figure, or a dash when that particular read failed (M221). */
const count = (n: number | null) =>
  n === null ? <span style={{ color: "var(--fg-faint)" }}>—</span> : n;
const CELL = "px-3 py-3 text-sm";

function when(at: string | null) {
  if (!at) return "—";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * The doorstep (M44): who is asking, and who has been let in.
 *
 * The only writes on this surface, and deliberately so — minting an
 * invitation is what the platform owner is actually *for*. They touch
 * `founding_invitations` and `invitation_requests`, which hold an address and
 * a note and belong to no family, so the information-never-content boundary
 * the rest of this page keeps is not bent to make room for them.
 */
function Doorstep() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ email: string; link: string; sent: boolean } | null>(null);

  const { data, isPending: doorPending, isError: doorFailed } = useQuery({
    queryKey: ["owner", "door"],
    queryFn: () => api.get<{ requests: DoorRequest[]; invitations: FoundingInvitation[] }>("/owner/door"),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["owner", "door"] });
    void queryClient.invalidateQueries({ queryKey: ["owner", "families"] });
  };

  const invite = useMutation({
    mutationFn: (body: { email: string; note?: string }) =>
      api.post<{ email: string; link: string; sent: boolean }>("/owner/door/invitations", body),
    onSuccess: (res) => {
      setMinted(res);
      setEmail("");
      setNote("");
      setError(null);
      refresh();
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "That could not be sent."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/owner/door/invitations/${id}/revoke`, {}),
    onSuccess: refresh,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/owner/door/requests/${id}/dismiss`, {}),
    onSuccess: refresh,
  });

  function send(event: FormEvent) {
    event.preventDefault();
    invite.mutate({ email: email.trim(), note: note.trim() || undefined });
  }

  const waiting = (data?.requests ?? []).filter((r) => r.status === "pending");
  const live = (data?.invitations ?? []).filter((i) => i.state === "waiting");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="owner-card flex flex-col p-5">
        <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">INVITE SOMEBODY</p>

        <form onSubmit={send} className="mt-3.5 flex flex-1 flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="h-[44px] w-full rounded-[10px] border bg-transparent px-3.5 text-sm outline-none focus:border-accent"
            style={{ borderColor: "rgba(var(--ink),.22)" }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A note to yourself — who they are, where you met"
            className="h-[44px] w-full rounded-[10px] border bg-transparent px-3.5 text-sm outline-none focus:border-accent"
            style={{ borderColor: "rgba(var(--ink),.22)" }}
          />
          {/*
            The action sits in the card's bottom-right corner.

            Left-aligned under two full-width fields it left a wide dead gap
            beside it and read as an afterthought. On the right it closes the
            form the way the eye already travels — down the fields, out to the
            corner — and the card reads as a finished shape.
          */}
          {/*
            Reserved, and above the action rather than below it. Kept in the
            layout at all times so a failure never shifts the card, but read
            before the button, which is the order somebody actually needs it
            in — and it no longer holds the action off the card's floor.
          */}
          <p
            role="alert"
            className="mt-auto h-5 text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>

          <button
            type="submit"
            disabled={invite.isPending}
            className="pressable self-end rounded-full px-[22px] py-[11px] text-sm font-medium text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {invite.isPending ? "Sending…" : "Send an invitation"}
          </button>
        </form>

        {/*
          The link exists in readable form exactly once — here and in the
          email. The row keeps only its hash, so this is the only chance to
          hand it over by another route if mail does not arrive.
        */}
        {minted && (
          <div
            className="mt-2 rounded-[10px] p-3"
            style={{ background: "rgba(var(--accent-channels),.10)", border: "1px solid rgba(var(--accent-channels),.35)" }}
          >
            <p className="text-sm">
              {minted.sent ? `Sent to ${minted.email}.` : `Mail failed — hand this to ${minted.email}.`}
            </p>
            <p className="mt-1.5 break-all font-mono text-[11px] text-fg-muted">{minted.link}</p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(minted.link)}
              className="mt-2 text-xs text-accent underline underline-offset-2"
            >
              Copy the link
            </button>
          </div>
        )}
      </div>

      <div className="owner-card p-5">
        <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          {/*
            The header must not contradict its own body (M221). Its sibling
            forty lines down already withholds; this one printed
            "ASKING · 0" straight above the sentence explaining that the
            list could not be read.
          */}
          ASKING{doorPending || doorFailed ? "" : ` · ${waiting.length}`}
        </p>
        <div className="scroll-thin mt-3 max-h-[220px] overflow-y-auto pr-1">
          {(doorPending || doorFailed) && (
            <p className="py-6 text-center text-sm text-fg-muted">
              {doorPending
                ? "Checking…"
                : "This could not be loaded, so we cannot say who is asking."}
            </p>
          )}
          {!doorPending && !doorFailed && waiting.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-muted">
              People who ask for an invitation appear here, with what they wrote.
            </p>
          )}
          {waiting.map((r) => (
            <div key={r.id} className="border-t border-line-soft py-3 first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{r.name || r.email}</span>
                <span className="flex-none text-xs text-fg-faint">{when(r.created_at)}</span>
              </div>
              {r.name && <p className="text-xs text-fg-faint">{r.email}</p>}
              {(r.interested_tier || r.billing_period) && (
                <p className="mt-1 font-mono text-[10px] tracking-[0.14em]" style={{ color: "var(--accent-soft)" }}>
                  {r.interested_tier === "dock" ? "RECALL DOCK" : r.interested_tier === "digital" ? "RECALL" : ""}
                  {r.interested_tier && r.billing_period ? " · " : ""}
                  {r.billing_period ? r.billing_period.toUpperCase() : ""}
                </p>
              )}
              {r.note && <p className="mt-1 text-[13px] leading-[1.5] text-fg-muted">{r.note}</p>}
              <div className="mt-2 flex gap-4">
                <button
                  type="button"
                  onClick={() => invite.mutate({ email: r.email, note: r.note ?? undefined })}
                  className="text-xs text-accent"
                >
                  Invite
                </button>
                <button
                  type="button"
                  onClick={() => dismiss.mutate(r.id)}
                  className="text-xs text-fg-faint hover:text-fg"
                >
                  Set aside
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="owner-card p-5 lg:col-span-2">
        <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          INVITATIONS OUT{doorPending || doorFailed ? "" : ` · ${live.length}`}
        </p>
        <div className="scroll-thin mt-3 max-h-[200px] overflow-y-auto pr-1">
          {/*
            The door's own list is a separate query from the page's (M205):
            the M191 gate above covers `families` and `health`, not this. On
            a failed load it said invitations "appear here until they are
            used" — an empty-state sentence for a list nobody had read.
          */}
          {(doorPending || doorFailed) && (
            <p className="py-6 text-center text-sm text-fg-muted">
              {doorPending
                ? "Checking…"
                : "This could not be loaded, so we cannot say what is outstanding."}
            </p>
          )}
          {!doorPending && !doorFailed && (data?.invitations ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-fg-muted">
              Invitations you send appear here until they are used.
            </p>
          )}
          {(data?.invitations ?? []).map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-4 border-t border-line-soft py-2.5 first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{i.email}</span>
              <span className="flex-none text-xs text-fg-faint">
                {i.state === "waiting"
                  ? `expires ${when(i.expires_at)}`
                  : i.state === "accepted"
                    ? "accepted"
                    : i.state}
              </span>
              {i.state === "waiting" && (
                <button
                  type="button"
                  onClick={() => revoke.mutate(i.id)}
                  className="flex-none text-xs text-fg-faint hover:text-destructive-soft"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Frame 18j — the fulfilment queue. What Recall sees, not the family.
 *
 * A flat mono table, deliberately plainer than the family workspace: it is a
 * queue, not a memory. The nine internal states collapse to three the family
 * ever reads (preparing, on its way, delivered), and the failed row keeps its
 * reason and its retry here so nobody's grandmother is shown a printer error.
 *
 * The oldest card is the first row, and the header says how long it has been
 * waiting — that figure is the reason to open this page at all.
 */
interface QueueCard {
  id: string;
  kind: string;
  state: string;
  created_at: string;
  shipping_reference: string | null;
  shipping_carrier: string | null;
  failure_reason: string | null;
  channel: { number: number | null; title: string } | null;
  sender: { name: string } | null;
  recipient: { name: string } | null;
  /* Whose envelope (053). The address itself is only on the print sheet. */
  deliver_to: { name: string | null; has_address: boolean };
}

/** The full payload for printing one card — GET /owner/fulfilment/:id/print. */
interface PrintPayload {
  id: string;
  channel: { number: number | null; title: string; description: string | null } | null;
  sender: { name: string; relationship: string | null } | null;
  recipient: { name: string } | null;
  deliver_to: { name: string | null; address: string | null };
  archive_since: string | null;
  photo_url: string | null;
}

/** How long a card has been sitting, in the words an operator would use. */
function waited(since: string): string {
  const ms = Date.now() - new Date(since).getTime();
  if (Number.isNaN(ms)) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}h` : "under an hour";
}

function Fulfilment() {
  const queryClient = useQueryClient();
  const [failing, setFailing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  /* Which card's print sheet is open, if any. */
  const [printing, setPrinting] = useState<string | null>(null);
  /* The posted-capture: which card, and the two envelope facts. */
  const [posting, setPosting] = useState<string | null>(null);
  const [carrier, setCarrier] = useState("bpost");
  const [reference, setReference] = useState("");

  const { data, isPending, isError } = useQuery({
    queryKey: ["owner", "fulfilment"],
    queryFn: () =>
      api.get<{ queued: number; inFlight: number; oldest: string | null; cards: QueueCard[] }>(
        "/owner/fulfilment"
      ),
    staleTime: 0,
  });

  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: object }) =>
      api.post(`/owner/fulfilment/${id}/${action}`, body ?? {}),
    onSuccess: async () => {
      setFailing(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["owner", "fulfilment"] });
    },
  });

  const cards = data?.cards ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          FULFILMENT — INTERNAL
        </span>
        {/*
          The count and the age of the oldest card, or an honest silence. A
          failed read must not render "0 in the queue" — that is the one
          sentence that would stop somebody looking.
        */}
        <span className="text-sm text-fg-muted">
          {isPending
            ? "reading the queue…"
            : isError
              ? "the queue could not be read"
              : cards.length === 0
                ? "nothing waiting"
                : `${data?.queued ?? 0} in the queue · ${cards.length} in flight` +
                  (data?.oldest ? ` · oldest ${waited(data.oldest)}` : "")}
        </span>
      </div>

      {!isPending && !isError && cards.length > 0 && (
        <div className="owner-card mt-3 overflow-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="sticky top-0" style={{ background: "var(--owner-thead)" }}>
              <tr>
                <th className={HEAD}>CARD</th>
                <th className={HEAD}>DELIVER TO</th>
                <th className={HEAD}>FROM</th>
                <th className={HEAD}>CREATED</th>
                <th className={HEAD}>STATUS</th>
                <th className={HEAD}>SHIPPING</th>
                <th className={HEAD}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const number =
                  typeof c.channel?.number === "number"
                    ? String(c.channel.number).padStart(2, "0")
                    : "--";
                const shipping =
                  c.state === "failed"
                    ? c.failure_reason || "no reason recorded"
                    : [c.shipping_carrier, c.shipping_reference].filter(Boolean).join(" · ");
                return (
                  <tr key={c.id} className="border-t border-line-soft align-top">
                    <td className={`${CELL} font-mono`}>
                      {number} — {c.channel?.title ?? "no channel"} ·{" "}
                      {c.kind === "postcard" ? "postcard" : "connected"}
                    </td>
                    <td className={CELL}>
                      <span className="block">{c.deliver_to?.name ?? c.recipient?.name ?? "—"}</span>
                      {c.deliver_to?.has_address ? (
                        /* The address is on the print sheet, which asks for
                           the password and leaves an audit row (access-5). */
                        <span className="mt-0.5 block text-[12px] text-fg-faint">
                          address on the print sheet
                        </span>
                      ) : (
                        /* Loud, because this row cannot be posted: the family
                           has not given a postal address yet. Saying "—"
                           here would read as a formatting choice. */
                        <span className="mt-0.5 block text-[12px]" style={{ color: "var(--warn, #D9A04E)" }}>
                          no address on the archive
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{c.sender?.name ?? "—"}</td>
                    <td className={CELL}>
                      {new Date(c.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className={`${CELL} font-mono`}>
                      <span style={{ color: c.state === "failed" ? "var(--destructive-soft)" : undefined }}>
                        {c.state}
                      </span>
                    </td>
                    <td className={`${CELL} font-mono text-fg-faint`}>{shipping || "—"}</td>
                    <td className={CELL}>
                      <div className="flex flex-wrap gap-1.5">
                        {(c.state === "queued" || c.state === "printing" || c.state === "failed") && (
                          <QueueButton onClick={() => setPrinting(c.id)} busy={false}>
                            Print
                          </QueueButton>
                        )}
                        {c.state === "queued" && (
                          <QueueButton
                            onClick={() => act.mutate({ id: c.id, action: "printing" })}
                            busy={act.isPending}
                          >
                            Process
                          </QueueButton>
                        )}
                        {c.state === "printing" && (
                          <>
                            <QueueButton onClick={() => setPosting(c.id)} busy={act.isPending}>
                              Posted
                            </QueueButton>
                            <QueueButton onClick={() => setFailing(c.id)} busy={act.isPending}>
                              Failed
                            </QueueButton>
                          </>
                        )}
                        {c.state === "failed" && (
                          <QueueButton
                            onClick={() => act.mutate({ id: c.id, action: "retry" })}
                            busy={act.isPending}
                          >
                            Retry
                          </QueueButton>
                        )}
                        {c.state === "shipped" && (
                          <span className="text-[12px] text-fg-faint">tracking</span>
                        )}
                      </div>

                      {posting === c.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <input
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            placeholder="carrier"
                            aria-label="Carrier"
                            className="w-[90px] rounded-[8px] border border-line-soft bg-transparent px-2 py-1 text-[12px]"
                          />
                          <input
                            autoFocus
                            value={reference}
                            onChange={(e) => setReference(e.target.value)}
                            placeholder="tracking no. (optional)"
                            aria-label="Tracking number"
                            className="w-[150px] rounded-[8px] border border-line-soft bg-transparent px-2 py-1 text-[12px]"
                          />
                          <QueueButton
                            onClick={() =>
                              act.mutate(
                                {
                                  id: c.id,
                                  action: "sent",
                                  body: {
                                    shipping_carrier: carrier.trim(),
                                    shipping_reference: reference.trim(),
                                  },
                                },
                                { onSuccess: () => { setPosting(null); setReference(""); } }
                              )
                            }
                            busy={act.isPending}
                          >
                            It's in the post
                          </QueueButton>
                          <QueueButton onClick={() => setPosting(null)} busy={false}>
                            Cancel
                          </QueueButton>
                        </div>
                      )}

                      {failing === c.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <input
                            autoFocus
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="what went wrong"
                            aria-label="What went wrong"
                            className="rounded-[8px] border border-line-soft bg-transparent px-2 py-1 text-[12px]"
                          />
                          <QueueButton
                            onClick={() =>
                              act.mutate({
                                id: c.id,
                                action: "failed",
                                body: { failure_reason: reason },
                              })
                            }
                            busy={act.isPending}
                          >
                            Save
                          </QueueButton>
                          <QueueButton onClick={() => setFailing(null)} busy={false}>
                            Cancel
                          </QueueButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {act.isError && (
        <p className="mt-2 text-[13px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
          That did not go through — the card may have been moved by somebody else. Reload the queue.
        </p>
      )}

      {printing && <PrintSheet cardId={printing} onClose={() => setPrinting(null)} />}

      <p className="mt-2 max-w-[70ch] text-[12px] leading-[1.6] text-fg-faint">
        Family-facing status stays coarse — preparing, on its way, delivered. The internal states
        never leak into the workspace.
      </p>
    </div>
  );
}

/**
 * The print sheet — one card, both faces, true postcard geometry.
 *
 * 620×440 units at A6's own ratio (148×105mm — the two differ by less than a
 * millimetre across the card, absorbed by print scaling). The owner presses
 * the browser's Print; `@media print` blanks everything but the two faces
 * and the address block, one per page, so the physical output is exactly:
 * front, back, envelope label.
 */
function PrintSheet({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["owner", "print", cardId],
    queryFn: () => api.get<PrintPayload>(`/owner/fulfilment/${cardId}/print`),
    /*
      One read per opening. Every read writes a 'print' row to the owner
      audit log, and the browser's print dialog hands focus back when it
      closes — with a zero stale time and the default refetch-on-focus, one
      printed card left several audit rows, and once the ten-minute step-up
      ran out the password dialog rose over a sheet already open. So the
      sheet never refetches on its own, and its copy is dropped when it
      closes: opening it again is a new read, and a new row.
    */
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // A step-up refusal is a question for the owner, not a hiccup to retry.
    retry: (count, err) => !needsStepUp(err) && count < 3,
  });
  /*
    The card carries a family's photograph and address, so the backend asks
    for the password again first (access-5). It answers `step_up_required`;
    this asks, and reads the card again once it is answered — only while
    there is no card on screen yet.
  */
  const stepUp = isError && needsStepUp(error) && !data;

  /*
    The card components live in the admin bundle and speak NfcCard; the print
    payload is reshaped into one rather than teaching those components a
    second shape. `id` is only a React key downstream.
  */
  const card = data
    ? ({
        id: data.id,
        label: data.channel?.title ?? "Postcard",
        tag_code: null,
        channel_id: null,
        linked_object: null,
        created_at: "",
        kind: "postcard",
        state: "queued",
        media_file_id: null,
        recurrence: "once",
        photo_mode: "chosen",
        next_send_at: null,
        sent_at: null,
        delivered_at: null,
        returned_at: null,
        failed_at: null,
        shipping_carrier: null,
        shipping_reference: null,
        archive_since: data.archive_since,
        channel: data.channel
          ? { id: "print", number: data.channel.number ?? 0, title: data.channel.title, description: data.channel.description }
          : null,
        photo: data.photo_url ? { id: "print", url: data.photo_url, caption: null } : null,
        sender: data.sender ? { id: "print", name: data.sender.name, relationship: data.sender.relationship } : null,
        recipient: data.recipient ? { id: "print", name: data.recipient.name } : null,
      } as unknown as import("@/hooks/useAdminData").NfcCard)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-6 print:static print:overflow-visible print:p-0"
      style={{ background: "rgba(11,11,12,.92)" }}
      role="dialog"
      aria-label="Print this card"
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-sheet, .print-sheet * { visibility: visible; }
          .print-sheet { position: absolute; inset: 0; background: white; }
          .print-face { page-break-after: always; }
        }
      `}</style>

      <div className="mx-auto flex max-w-[700px] flex-col items-center gap-6">
        <div className="flex w-full items-center justify-between print:hidden">
          <p className="font-mono text-[11px] tracking-[0.16em] text-fg-faint">
            PRINT — FRONT, BACK, THEN THE LABEL
          </p>
          <div className="flex gap-2">
            <QueueButton onClick={() => window.print()} busy={false}>
              Print
            </QueueButton>
            <QueueButton onClick={onClose} busy={false}>
              Close
            </QueueButton>
          </div>
        </div>

        {isPending && <p className="text-fg-muted">Preparing the card…</p>}
        {isError && !stepUp && !data && (
          <p role="alert" style={{ color: "var(--destructive-soft)" }}>
            The card could not be read — it may have left the queue.
          </p>
        )}
        {stepUp && (
          <StepUpDialog
            reason="Opening a card to print"
            onCancel={onClose}
            onDone={() => void refetch()}
          />
        )}

        {card && (
          <div className="print-sheet flex flex-col items-center gap-6">
            <div className="print-face"><PostcardFront card={card} /></div>
            <div className="print-face"><PostcardBack card={card} /></div>
            {/* The envelope label: the one block that is not the card. */}
            <div
              className="print-face w-[620px] max-w-full bg-white p-10 text-black"
              style={{ font: "400 22px/1.6 'Roboto Mono', monospace" }}
            >
              <p style={{ whiteSpace: "pre-line" }}>
                {data?.deliver_to.name ?? data?.recipient?.name ?? ""}
                {"\n"}
                {data?.deliver_to.address ?? "NO ADDRESS ON THE ARCHIVE"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueButton({
  children,
  onClick,
  busy,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="rounded-full border border-line-soft px-2.5 py-1 font-mono text-[11px] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Hardware the families asked for (052) — the Devices page's other end.
 *
 * The same shape of promise as the postcard queue: a family pressed a button
 * that says something will arrive, and this is where somebody keeps that
 * promise. Handled rows leave the list; there is no history view here
 * because the owner's question is "who is waiting", not "what have I done".
 */
interface HardwareAsk {
  id: string;
  archive_id: string;
  device_kind: "screen" | "reader_dock" | "hub";
  note: string | null;
  created_at: string;
  requester: { name: string } | null;
}

const HARDWARE_NAME: Record<HardwareAsk["device_kind"], string> = {
  screen: "screen",
  reader_dock: "card reader & dock",
  hub: "hub",
};

function DeviceRequests() {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: ["owner", "device-requests"],
    queryFn: () =>
      api.get<{ waiting: number; requests: HardwareAsk[] }>("/owner/device-requests"),
    staleTime: 0,
  });

  const handled = useMutation({
    mutationFn: (id: string) => api.post(`/owner/device-requests/${id}/handled`, {}),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["owner", "device-requests"] }),
  });

  const rows = data?.requests ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          HARDWARE REQUESTS
        </span>
        <span className="text-sm text-fg-muted">
          {isPending
            ? "reading…"
            : isError
              ? "the requests could not be read"
              : rows.length === 0
                ? "nobody waiting"
                : `${rows.length} waiting`}
        </span>
      </div>

      {!isPending && !isError && rows.length > 0 && (
        <div className="owner-card mt-3 overflow-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="sticky top-0" style={{ background: "var(--owner-thead)" }}>
              <tr>
                <th className={HEAD}>DEVICE</th>
                <th className={HEAD}>ASKED BY</th>
                <th className={HEAD}>WHEN</th>
                <th className={HEAD}>NOTE</th>
                <th className={HEAD}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className={`${CELL} font-mono`}>{HARDWARE_NAME[r.device_kind]}</td>
                  <td className={CELL}>{r.requester?.name ?? "—"}</td>
                  <td className={CELL}>
                    {new Date(r.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className={`${CELL} text-fg-faint`}>{r.note ?? "—"}</td>
                  <td className={CELL}>
                    <QueueButton
                      onClick={() => handled.mutate(r.id)}
                      busy={handled.isPending}
                    >
                      Handled
                    </QueueButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The drive the family keeps (M241).
 *
 * The Recall Archive home visit ends with a memory stick, and this is what
 * fills it: one zip with every photograph, every recording and a page that
 * reads them without Recall and without a subscription.
 *
 * A plain navigation, not a fetch. The response is a stream that can run to
 * hundreds of megabytes, and the browser's own download handles that — and
 * shows its own progress — where an in-page fetch would hold the whole
 * archive in the tab's memory first. The filename comes from the server's
 * Content-Disposition, which is where the date in it is decided.
 *
 * Before it goes, the step-up (access-5): a whole family's archive leaves
 * only after the password — and the code, when two-step sign-in is on — was
 * typed in the last ten minutes. A navigation cannot read a 401, so the
 * button asks the backend first whether one is live, and asks the owner when
 * it is not.
 *
 * The platform owner's own row owns no archive (M55), so it has nothing to
 * export and says so instead of offering a button that would 409.
 */
function ExportArchiveButton({
  familyId,
  isPlatformRow,
}: {
  familyId: string;
  isPlatformRow: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState("");
  if (isPlatformRow) return <span className="text-fg-faint">—</span>;

  const url = `${API_ORIGIN}/api/owner/families/${familyId}/export`;
  const go = () => window.location.assign(url);

  async function begin() {
    setProblem("");
    setChecking(true);
    try {
      const live = await readStepUp();
      if (live.active) go();
      else setAsking(true);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void begin()}
        disabled={checking}
        className="pressable inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[12.5px] leading-none disabled:opacity-50"
        style={{ border: "1px solid rgba(var(--ink),.2)" }}
        title="One zip: every photograph, every recording, and a page that opens without Recall"
      >
        Export archive
      </button>
      {problem && (
        <p role="alert" className="mt-1.5 text-[12px] text-destructive-soft">
          {problem}
        </p>
      )}
      {asking && (
        <StepUpDialog
          reason="Exporting this family's archive"
          onCancel={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            go();
          }}
        />
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────── the console */

type Tab = "overview" | "families" | "door" | "fulfilment" | "hardware" | "security";
type FamilyFilter = "all" | "active" | "invoiced" | "noscreen" | "quiet";

/** A family that has not been used for this long is worth a phone call. */
const QUIET_DAYS = 14;
/** The invoice sheet says "due in 14 days"; past that it is overdue here too. */
const INVOICE_DUE_DAYS = 14;

function daysSince(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  families: "Families",
  door: "Door",
  fulfilment: "Postcards",
  hardware: "Hardware",
  security: "Security",
};

const PLAN_LABEL: Record<FamilyPayment["state"], string> = {
  none: "Not invoiced",
  invoiced: "Invoiced",
  active: "Active",
  paused: "Paused",
  closed: "Closed",
};

/*
  The plan pill. Active green and paused red keep their own colours in every
  theme (workspace-themes.css: "status pills that carry meaning"); only the
  invoiced wash follows the accent. Same tones as PaymentCell's own pill, so
  the table and the drawer never disagree about what a state looks like.
*/
function PlanBadge({ state }: { state: FamilyPayment["state"] }) {
  const tone =
    state === "active"
      ? { background: "rgba(90,160,110,.18)", color: "var(--on-live, #8fd3a3)" }
      : state === "invoiced"
        ? { background: "var(--accent-tint)", color: "var(--accent-on-tint)" }
        : state === "paused"
          ? { background: "rgba(220,90,80,.16)", color: "#e8877a" }
          : { background: "var(--owner-card-strong)", color: "var(--fg-faint)" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[3px] font-mono text-[9.5px] tracking-[0.14em]"
      style={tone}
    >
      {PLAN_LABEL[state].toUpperCase()}
    </span>
  );
}

/** One figure the owner asked for by name, drawn large. */
function Tile({
  label,
  value,
  state,
  note,
}: {
  label: string;
  value: string;
  /** `idle` is "not answered yet" — grey, never a verdict. */
  state: "ok" | "warn" | "bad" | "idle";
  note?: string | null;
}) {
  const colour =
    state === "ok"
      ? "var(--accent)"
      : state === "warn"
        ? "#d8a33c"
        : state === "bad"
          ? "var(--destructive-soft, #e8877a)"
          : "rgba(var(--ink),.25)";
  return (
    <div className="owner-card flex min-w-0 flex-1 flex-col justify-between gap-3 px-4 py-3.5">
      <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-fg-faint">
        <span aria-hidden className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: colour }} />
        {label}
      </p>
      <p
        className="truncate text-[26px] font-semibold leading-none tracking-[-0.02em]"
        style={{ fontVariantNumeric: "tabular-nums" }}
        title={note ?? undefined}
      >
        {value}
      </p>
      {note && <p className="truncate text-[11px] leading-[1.4] text-fg-faint">{note}</p>}
    </div>
  );
}

/**
 * The colour picker in the header. A circle showing the current swatch;
 * pressed, it opens the five options. The word is always beside the colour.
 */
function ThemeMenu({ theme, onChoose }: { theme: OwnerTheme; onChoose: (t: OwnerTheme) => void }) {
  const [open, setOpen] = useState(false);
  const current = OWNER_SWATCH[theme];

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Colour: ${current.label}. Change the console's colour`}
        title="Console colour"
        className="pressable flex h-[38px] items-center gap-2.5 rounded-full pl-2 pr-3.5 text-[13px] leading-none"
        style={{ border: "1px solid var(--owner-line)", background: "var(--owner-card)" }}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full"
          style={{ background: current.ground, border: "1px solid var(--line)" }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: current.accent }} />
        </span>
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      {open && (
        <>
          {/* A backdrop, so a click anywhere else closes it. */}
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-[220px] rounded-[16px] p-2"
            style={{
              background: "var(--panel-menu, var(--owner-thead))",
              border: "1px solid var(--owner-line)",
              boxShadow: "var(--shadow-menu, 0 18px 40px rgba(0,0,0,.4))",
            }}
          >
            <p className="px-2.5 pb-1.5 pt-1 font-mono text-[9.5px] tracking-[0.18em] text-fg-faint">
              THIS DEVICE
            </p>
            {OWNER_THEMES.map((t) => {
              const swatch = OWNER_SWATCH[t];
              const active = t === theme;
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onChoose(t);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[13.5px]"
                  style={{ background: active ? "var(--accent-tint)" : undefined }}
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full"
                    style={{ background: swatch.ground, border: "1px solid var(--line)" }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch.accent }} />
                  </span>
                  <span className="flex-1">{swatch.label}</span>
                  {active && <Check size={14} strokeWidth={2} aria-hidden style={{ color: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** One row of "Needs you": what, how many, and where to go. */
interface Need {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** null: that read failed, and the row says so instead of a number. */
  count: number | null;
  detail: string;
  tone: "alarm" | "warn" | "calm";
  go: () => void;
}

function NeedsYou({ needs, allRead }: { needs: Need[]; allRead: boolean }) {
  const live = needs.filter((n) => n.count === null || n.count > 0);
  return (
    <section className="owner-card p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.18em] text-fg-faint">NEEDS YOU</p>
        <p className="text-[12px] text-fg-faint">
          {live.length === 0 ? (allRead ? "Nothing is waiting on you." : "Still reading…") : `${live.length} thing${live.length === 1 ? "" : "s"}`}
        </p>
      </div>
      {live.length === 0 ? (
        <p className="mt-4 text-[14px] leading-[1.6] text-fg-muted">
          {allRead
            ? "Nobody at the door, no cards to post, no hardware asked for, every invoice paid, every family with a screen and in use."
            : "The queues are being read."}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {live.map((n) => (
            <li key={n.key}>
              <button
                type="button"
                onClick={n.go}
                className="pressable flex w-full items-center gap-4 rounded-[12px] px-2.5 py-3 text-left transition-colors hover:bg-[var(--owner-card-strong)]"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
                  style={{
                    background:
                      n.tone === "alarm"
                        ? "rgba(220,90,80,.16)"
                        : n.tone === "warn"
                          ? "var(--accent-tint)"
                          : "var(--owner-card-strong)",
                    color: n.tone === "alarm" ? "#e8877a" : n.tone === "warn" ? "var(--accent-on-tint)" : "var(--fg-muted)",
                  }}
                >
                  {n.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] leading-[1.3]">{n.label}</span>
                  <span className="block text-[12px] leading-[1.4] text-fg-faint">{n.detail}</span>
                </span>
                <span
                  className="flex-none text-[22px] font-semibold leading-none tracking-[-0.02em]"
                  style={{ fontVariantNumeric: "tabular-nums", color: n.count === null ? "var(--fg-faint)" : undefined }}
                >
                  {n.count === null ? "—" : n.count}
                </span>
                <ChevronRight size={16} strokeWidth={1.8} aria-hidden className="flex-none text-fg-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What has happened lately — `/owner/events`, which nothing rendered before. */
interface PlatformEvent {
  kind: "family_created" | "screen_paired";
  at: string;
  archive_id: string | null;
  detail: string;
}

function RecentEvents({ enabled }: { enabled: boolean }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["owner", "events"],
    queryFn: () => api.get<{ events: PlatformEvent[]; database: string }>("/owner/events"),
    enabled,
    staleTime: 60_000,
  });
  const events = (data?.events ?? []).slice(0, 12);

  return (
    <section className="owner-card flex min-h-0 flex-col p-5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-fg-faint">LATELY</p>
      <div className="scroll-thin mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {(isPending || isError) && (
          <p className="py-6 text-center text-[13px] text-fg-muted">
            {isPending ? "Reading…" : "The recent events could not be read."}
          </p>
        )}
        {!isPending && !isError && events.length === 0 && (
          <p className="py-6 text-center text-[13px] text-fg-muted">
            New families and screens coming to life appear here.
          </p>
        )}
        {events.map((e, i) => (
          <div
            key={`${e.kind}-${e.at}-${i}`}
            className="flex items-baseline gap-3 border-t py-2.5 first:border-t-0"
            style={{ borderColor: "var(--owner-line)" }}
          >
            <span
              aria-hidden
              className="relative top-[-2px] inline-block h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: e.kind === "family_created" ? "var(--accent)" : "rgba(var(--ink),.35)" }}
            />
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {e.kind === "family_created" ? `New family — ${e.detail}` : "A trusted screen was in use"}
            </span>
            <span className="flex-none text-[11.5px] text-fg-faint">{when(e.at)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * One family, opened from the table. Everything that used to be crammed
 * into a 260px cell — the invoice machine, the export — lives here with
 * room to breathe, beside the facts the table only had space to abbreviate.
 */
function FamilyDrawer({ family, onClose }: { family: FamilyRow; onClose: () => void }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const days = daysSince(family.last_activity);
  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "SINCE", value: new Date(family.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" }) },
    { label: "MEMBERS", value: count(family.members) },
    { label: "CHANNELS", value: count(family.channels) },
    { label: "FILES", value: count(family.media_files) },
    {
      label: "SCREEN",
      value:
        family.screen_paired === null ? (
          <span className="text-fg-faint">could not be read</span>
        ) : family.screen_paired ? (
          `Paired${family.screen_last_seen ? ` · seen ${when(family.screen_last_seen).toLowerCase()}` : ""}`
        ) : (
          <span style={{ color: "#d8a33c" }}>None paired</span>
        ),
    },
    {
      label: "LAST ACTIVITY",
      value: family.last_activity ? when(family.last_activity) : <span className="text-fg-faint">none recorded</span>,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={family.family_name ?? family.email}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0,0,0,.45)", backdropFilter: "blur(3px)" }}
      />
      <aside
        className="scroll-thin relative flex h-full w-full max-w-[460px] flex-col overflow-y-auto"
        style={{
          background: "var(--panel-dialog, var(--owner-thead))",
          borderLeft: "1px solid var(--owner-line)",
          boxShadow: "var(--shadow-dialog, 0 0 80px rgba(0,0,0,.5))",
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.18em] text-fg-faint">FAMILY</p>
            <h2 className="mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.01em]">
              {family.family_name || "—"}
            </h2>
            <p className="mt-1 truncate text-[13px] text-fg-muted">{family.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pressable flex h-10 w-10 flex-none items-center justify-center rounded-full"
            style={{ border: "1px solid var(--owner-line)" }}
          >
            <X size={16} strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 px-6">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="font-mono text-[9.5px] tracking-[0.18em] text-fg-faint">{f.label}</dt>
              <dd className="mt-1 text-[14px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
        {days !== null && days >= QUIET_DAYS && (
          <p className="mx-6 mt-4 rounded-[10px] px-3 py-2 text-[12.5px] leading-[1.5]" style={{ background: "var(--accent-tint)", color: "var(--accent-on-tint)" }}>
            Quiet for {days} days. Worth a call.
          </p>
        )}

        <div className="mx-6 mt-6 border-t pt-5" style={{ borderColor: "var(--owner-line)" }}>
          <p className="font-mono text-[10px] tracking-[0.18em] text-fg-faint">PLAN</p>
          <div className="mt-3">
            <PaymentCell
              familyId={family.family_id}
              isPlatformRow={family.is_platform_owner}
              payment={
                family.payment ?? {
                  state: "none",
                  tier: null,
                  invoice_number: null,
                  invoice_amount_cents: null,
                  invoiced_at: null,
                  paid_at: null,
                  activated_at: null,
                  paused_at: null,
                }
              }
            />
          </div>
        </div>

        <div className="mx-6 mb-8 mt-6 border-t pt-5" style={{ borderColor: "var(--owner-line)" }}>
          <p className="font-mono text-[10px] tracking-[0.18em] text-fg-faint">ARCHIVE</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ExportArchiveButton familyId={family.family_id} isPlatformRow={family.is_platform_owner} />
            <span className="text-[12px] leading-[1.5] text-fg-faint">
              {family.is_platform_owner
                ? "The platform row owns no archive."
                : "One zip for the memory stick. Nothing in it is readable from this console."}
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

const FILTER_LABEL: Record<FamilyFilter, string> = {
  all: "All",
  active: "Active plan",
  invoiced: "Invoiced",
  noscreen: "No screen",
  quiet: `Quiet ${QUIET_DAYS}d+`,
};

function passes(f: FamilyRow, filter: FamilyFilter): boolean {
  if (f.is_platform_owner) return filter === "all";
  switch (filter) {
    case "all":
      return true;
    case "active":
      return f.payment?.state === "active";
    case "invoiced":
      return f.payment?.state === "invoiced";
    case "noscreen":
      return f.screen_paired === false;
    case "quiet": {
      const d = daysSince(f.last_activity);
      return d !== null && d >= QUIET_DAYS;
    }
  }
}

function FamiliesPanel({
  families,
  filter,
  onFilter,
  onOpen,
}: {
  families: FamilyRow[];
  filter: FamilyFilter;
  onFilter: (f: FamilyFilter) => void;
  onOpen: (family: FamilyRow) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const rows = useMemo(() => {
    const matches = families.filter(
      (f) =>
        passes(f, filter) &&
        (!q || (f.family_name ?? "").toLowerCase().includes(q) || f.email.toLowerCase().includes(q))
    );
    /* Most recently alive first; never-seen after; the platform row last. */
    return matches.sort((a, b) => {
      if (a.is_platform_owner !== b.is_platform_owner) return a.is_platform_owner ? 1 : -1;
      const at = a.last_activity ?? "";
      const bt = b.last_activity ?? "";
      return at < bt ? 1 : at > bt ? -1 : 0;
    });
  }, [families, filter, q]);

  return (
    <section className="owner-card flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
        <label className="relative min-w-0 flex-1 basis-[220px]">
          <Search size={14} strokeWidth={1.8} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a family or an email"
            aria-label="Find a family"
            className="h-[38px] w-full rounded-full bg-transparent pl-9 pr-4 text-[13.5px] outline-none placeholder:text-[color:var(--fg-hint)] focus:border-accent"
            style={{ border: "1px solid var(--owner-line)" }}
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
          {(Object.keys(FILTER_LABEL) as FamilyFilter[]).map((f) => {
            const active = f === filter;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onFilter(f)}
                className="rounded-full px-3 py-[7px] text-[12.5px] leading-none transition-colors"
                style={{
                  border: `1px solid ${active ? "var(--accent)" : "var(--owner-line)"}`,
                  background: active ? "var(--accent-tint)" : undefined,
                  color: active ? "var(--accent-on-tint)" : undefined,
                }}
              >
                {FILTER_LABEL[f]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="sticky top-0 z-10" style={{ background: "var(--owner-thead)" }}>
            <tr>
              <th className={HEAD}>FAMILY</th>
              <th className={HEAD}>SINCE</th>
              <th className={`${HEAD} text-right`}>MEMBERS</th>
              <th className={`${HEAD} text-right`}>CHANNELS</th>
              <th className={`${HEAD} text-right`}>FILES</th>
              <th className={HEAD}>SCREEN</th>
              <th className={HEAD}>LAST ACTIVITY</th>
              <th className={HEAD}>PLAN</th>
              <th className={HEAD}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.family_id}
                onClick={() => onOpen(f)}
                className="cursor-pointer border-t transition-colors hover:bg-[var(--owner-card-strong)]"
                style={{ borderColor: "var(--owner-line)" }}
              >
                <td className={CELL}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{f.family_name || "—"}</span>
                    {/* The platform row itself, shown rather than filtered out:
                        seeing that exactly one row holds the flag is worth
                        more than a tidier table. */}
                    {f.is_platform_owner && (
                      <span
                        className="flex-none rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.14em]"
                        style={{ background: "var(--accent-tint)", color: "var(--accent-on-tint)" }}
                      >
                        PLATFORM
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-fg-faint">{f.email}</span>
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {new Date(f.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                </td>
                <td className={`${CELL} text-right`} style={{ fontVariantNumeric: "tabular-nums" }}>{count(f.members)}</td>
                <td className={`${CELL} text-right`} style={{ fontVariantNumeric: "tabular-nums" }}>{count(f.channels)}</td>
                <td className={`${CELL} text-right`} style={{ fontVariantNumeric: "tabular-nums" }}>{count(f.media_files)}</td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {f.is_platform_owner ? (
                    <span className="text-fg-faint">—</span>
                  ) : f.screen_paired === null ? (
                    <span className="text-fg-faint" title="The screens could not be read.">—</span>
                  ) : f.screen_paired ? (
                    <span className="inline-flex items-center gap-2" title={f.screen_last_seen ? `Seen ${when(f.screen_last_seen).toLowerCase()}` : undefined}>
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--on-live, #8fd3a3)" }} />
                      Paired
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2" style={{ color: "#d8a33c" }}>
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "#d8a33c" }} />
                      None
                    </span>
                  )}
                </td>
                <td className={`${CELL} whitespace-nowrap`}>{f.is_platform_owner ? <span className="text-fg-faint">—</span> : when(f.last_activity)}</td>
                <td className={`${CELL} whitespace-nowrap`}>
                  {f.is_platform_owner ? (
                    <span className="text-fg-faint">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <PlanBadge state={f.payment?.state ?? "none"} />
                      {f.payment?.invoice_number && (
                        <span className="font-mono text-[11px] text-fg-faint">{f.payment.invoice_number}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className={`${CELL} text-right`}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(f);
                    }}
                    aria-label={`Open ${f.family_name || f.email}`}
                    className="pressable inline-flex h-8 w-8 items-center justify-center rounded-full"
                    style={{ border: "1px solid var(--owner-line)" }}
                  >
                    <ChevronRight size={15} strokeWidth={1.8} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Empty states say what will appear, not "no data". Past the gate,
            this can only be a load that succeeded with nothing in it — or a
            filter that matched nothing. */}
        {rows.length === 0 && (
          <p className="px-4 py-12 text-center text-[13.5px] text-fg-muted">
            {families.length === 0
              ? "Every family that creates an archive will appear here, with its size and when it was last used."
              : "No family matches that."}
          </p>
        )}
      </div>
    </section>
  );
}

export function OwnerDashboard() {
  const navigate = useNavigate();
  const { signedIn, loading: sessionLoading } = useAuth();
  const [theme, chooseTheme] = useOwnerTheme();
  const [tab, setTab] = useState<Tab>("overview");
  const [filter, setFilter] = useState<FamilyFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const {
    data: health,
    isLoading: isLoadingHealth,
    isError: healthUnavailable,
  } = useQuery({
    queryKey: ["owner", "health"],
    queryFn: () => api.get<Health>("/owner/health"),
    // Health is about right now, so it is never served from a cache.
    staleTime: 0,
    refetchOnMount: "always",
    // Nobody is asking until somebody is here. See the door below.
    enabled: signedIn,
  });

  const { data, isPending, isError, error, isSuccess } = useQuery({
    queryKey: ["owner", "families"],
    queryFn: () => api.get<{ families: FamilyRow[]; database: string }>("/owner/families"),
    enabled: signedIn,
  });

  /*
    The queues, read here for the overview's "Needs you" and the tab badges.
    Same keys as the panels' own queries, so React Query holds one copy and
    the panel and the badge can never disagree. Enabled only once the
    families read has answered — the M191 rule: nothing about this console
    is asked for until the door has been answered.
  */
  const behindDoor = signedIn && isSuccess;
  const door = useQuery({
    queryKey: ["owner", "door"],
    queryFn: () => api.get<{ requests: DoorRequest[]; invitations: FoundingInvitation[] }>("/owner/door"),
    enabled: behindDoor,
  });
  const queue = useQuery({
    queryKey: ["owner", "fulfilment"],
    queryFn: () =>
      api.get<{ queued: number; inFlight: number; oldest: string | null; cards: QueueCard[] }>("/owner/fulfilment"),
    staleTime: 0,
    enabled: behindDoor,
  });
  const hardware = useQuery({
    queryKey: ["owner", "device-requests"],
    queryFn: () => api.get<{ waiting: number; requests: HardwareAsk[] }>("/owner/device-requests"),
    staleTime: 0,
    enabled: behindDoor,
  });

  /*
    Written plainly rather than inside a `useMemo`, on purpose: the
    fabricated-figures census (M205) walks `const x = data?.y ?? []` and
    would not see the same default inside an arrow. A counted default the
    census cannot see is a verdict nobody is forced to write, so the shape
    stays the one it walks. The M191 gate below is what makes it safe.
  */
  const families = data?.families ?? [];
  const real = families.filter((f) => !f.is_platform_owner);

  /** A number, or a dash — never a zero invented to fill the space. */
  const num = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : String(value);

  // The counts are only as trustworthy as the probe that fetched them.
  const healthState: "ok" | "idle" = !isLoadingHealth && health?.database === "up" ? "ok" : "idle";

  /*
    What needs the owner, from what has been read. Every count is null when
    its read failed (M221's rule, carried up a level): the row then shows a
    dash and says the read failed, because "0 asking at the door" on a day
    the door could not be read is the one sentence that stops somebody
    looking.
  */
  const needs: Need[] = (() => {
    const asking = door.isSuccess ? door.data.requests.filter((r) => r.status === "pending").length : null;
    const cards = queue.isSuccess ? queue.data.cards : null;
    const toPost = cards ? cards.filter((c) => c.state === "queued" || c.state === "printing").length : null;
    const failed = cards ? cards.filter((c) => c.state === "failed").length : null;
    const waitingHardware = hardware.isSuccess ? hardware.data.requests.length : null;
    const invoiced = real.filter((f) => f.payment?.state === "invoiced");
    const overdue = invoiced.filter((f) => (daysSince(f.payment?.invoiced_at) ?? 0) > INVOICE_DUE_DAYS).length;
    const noScreen = real.filter((f) => f.screen_paired === false).length;
    const screenUnknown = real.filter((f) => f.screen_paired === null).length;
    const quiet = real.filter((f) => {
      const d = daysSince(f.last_activity);
      return d !== null && d >= QUIET_DAYS;
    }).length;
    const unread = "could not be read";

    return [
      {
        key: "door",
        icon: <Inbox size={16} strokeWidth={1.8} aria-hidden />,
        label: "Asking at the door",
        count: asking,
        detail: asking === null ? `The door ${unread}.` : "People who asked for an invitation, with what they wrote.",
        tone: "warn",
        go: () => setTab("door"),
      },
      {
        key: "failed",
        icon: <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />,
        label: "Postcards that failed",
        count: failed,
        detail: failed === null ? `The queue ${unread}.` : "Each keeps its reason and can be retried.",
        tone: "alarm",
        go: () => setTab("fulfilment"),
      },
      {
        key: "post",
        icon: <Printer size={16} strokeWidth={1.8} aria-hidden />,
        label: "Postcards to print and post",
        count: toPost,
        detail:
          toPost === null
            ? `The queue ${unread}.`
            : queue.data?.oldest
              ? `The oldest has waited ${waited(queue.data.oldest)}.`
              : "Queued or being printed.",
        tone: "warn",
        go: () => setTab("fulfilment"),
      },
      {
        key: "hardware",
        icon: <MonitorSmartphone size={16} strokeWidth={1.8} aria-hidden />,
        label: "Hardware asked for",
        count: waitingHardware,
        detail: waitingHardware === null ? `The requests ${unread}.` : "A screen, a reader and dock, or a hub.",
        tone: "warn",
        go: () => setTab("hardware"),
      },
      {
        key: "invoiced",
        icon: <Receipt size={16} strokeWidth={1.8} aria-hidden />,
        label: "Invoices waiting to be paid",
        count: invoiced.length,
        detail: overdue > 0 ? `${overdue} past the ${INVOICE_DUE_DAYS}-day due date.` : `Due within ${INVOICE_DUE_DAYS} days of sending.`,
        tone: overdue > 0 ? "alarm" : "calm",
        go: () => {
          setFilter("invoiced");
          setTab("families");
        },
      },
      {
        key: "noscreen",
        icon: <MonitorSmartphone size={16} strokeWidth={1.8} aria-hidden />,
        label: "Families with no screen paired",
        count: noScreen,
        detail:
          screenUnknown > 0
            ? `Plus ${screenUnknown} whose screens could not be read.`
            : "They signed up and never set the display up. Worth a call.",
        tone: "warn",
        go: () => {
          setFilter("noscreen");
          setTab("families");
        },
      },
      {
        key: "quiet",
        icon: <Activity size={16} strokeWidth={1.8} aria-hidden />,
        label: `Quiet for ${QUIET_DAYS} days or more`,
        count: quiet,
        detail: "No scan, visit or upload lately.",
        tone: "calm",
        go: () => {
          setFilter("quiet");
          setTab("families");
        },
      },
    ];
  })();

  const allRead = door.isSuccess && queue.isSuccess && hardware.isSuccess;

  /* The badge a tab wears: a count when it is known, nothing when it is not. */
  const badge: Partial<Record<Tab, number>> = {
    families: isSuccess ? real.length : undefined,
    door: door.isSuccess ? door.data.requests.filter((r) => r.status === "pending").length : undefined,
    fulfilment: queue.isSuccess ? queue.data.cards.length : undefined,
    hardware: hardware.isSuccess ? hardware.data.requests.length : undefined,
  };

  const opened = openId ? families.find((f) => f.family_id === openId) ?? null : null;

  /*
    THE DOOR IS ON THIS ADDRESS TOO (owner, 21 Sep 2026: "build it so i can
    just also login here, with needing to go to the public page").

    Before this, signing in to the platform console meant typing /login,
    signing in, landing on a family chooser, and then typing /owner by hand —
    a detour with nothing in it, because the server has known since M40 where
    to send this credential: `POST /family/login` answers `next: "/owner"` for
    the platform owner and `next: "/profiles"` for everyone else. The only
    thing missing was a place to type it here.

    THIS DISCLOSES NOTHING THAT /login DOES NOT. The 404-shaped refusal this
    page is built around protects against a *signed-in family admin* who
    guesses the address — the comment at the top of this file says so, and
    that person is untouched: they have a session, so they fall straight
    through to `OwnerDoor` and its bare "Nothing here." A stranger with no
    session sees a sign-in page that names nothing behind it (OwnerSignIn).
  */
  if (sessionLoading) return <OwnerDoor waiting outage={false} />;
  if (!signedIn) return <OwnerSignIn />;

  if (isPending || isError) {
    /*
      Nothing paints until the answer is in (M191) — a family session that
      opened this address must never watch the console render before it
      collapses to "Nothing here." And a refusal and an outage are not the
      same news for the person who owns the platform (M221): the 404 stays
      ambiguous, a 503 does not.
    */
    return <OwnerDoor waiting={isPending && !isError} outage={isError && !isGenuinelyMissing(error)} />;
  }

  return (
    /*
     * This one frames itself, deliberately (M75). `/owner` renders straight
     * under the app's `main` — inside neither shell, because it belongs to
     * no family and wears none of their furniture.
     */
    <div
      {...ownerThemeAttrs(theme)}
      /* No `overflow-hidden` here: the glows clip inside their own wrapper,
         the body region scrolls itself, and a clipped root cut the colour
         menu off wherever the console was shorter than the menu. */
      className="owner-console relative flex h-full min-h-0 flex-col"
      style={ownerThemeStyle(theme)}
    >
      <style>{`
        .owner-console .owner-card {
          background: var(--owner-card);
          border: 1px solid var(--owner-line);
          border-radius: 18px;
          backdrop-filter: blur(18px) saturate(1.25);
          -webkit-backdrop-filter: blur(18px) saturate(1.25);
        }
        @keyframes ownerGlowA {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50%      { transform: translate3d(2%, 3%, 0) scale(1.06); }
        }
        @keyframes ownerGlowB {
          0%, 100% { transform: translate3d(0,0,0) scale(1.04); }
          50%      { transform: translate3d(-3%, -2%, 0) scale(1); }
        }
        .owner-console .owner-glow-a { animation: ownerGlowA 38s ease-in-out infinite; }
        .owner-console .owner-glow-b { animation: ownerGlowB 46s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .owner-console .owner-glow-a, .owner-console .owner-glow-b { animation: none; }
        }
        .owner-console .owner-tab[aria-selected="true"] {
          background: var(--chip-on);
          color: var(--on-chip-on);
        }
      `}</style>

      {/* ── the ground: the door's two lights and its graph paper ───────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span
          className="owner-glow-a absolute"
          style={{
            inset: "-35% 30% 45% -25%",
            background: "radial-gradient(closest-side, var(--owner-glow-a), transparent 70%)",
            filter: "blur(30px)",
          }}
        />
        <span
          className="owner-glow-b absolute"
          style={{
            inset: "50% -25% -35% 40%",
            background: "radial-gradient(closest-side, var(--owner-glow-b), transparent 70%)",
            filter: "blur(36px)",
          }}
        />
        <span
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(var(--owner-grid) 1px, transparent 1px)," +
              "linear-gradient(90deg, var(--owner-grid) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%)",
            WebkitMaskImage: "radial-gradient(120% 90% at 50% 40%, #000 30%, transparent 85%)",
          }}
        />
        <span
          className="absolute inset-0"
          style={{ background: "radial-gradient(130% 100% at 50% 50%, transparent 45%, var(--owner-vignette) 100%)" }}
        />
      </div>

      {/* ── the header ─────────────────────────────────────────────────── */}
      {/* `z-20`: the colour menu drops out of this header over the body
          region below, which is positioned and painted later — without a
          stacking order the body's cards drew over the menu's tail. */}
      <header className="relative z-20 flex flex-none flex-wrap items-center gap-3 px-5 pt-4 md:px-8 md:pt-5">
        <div className="flex items-baseline gap-3">
          <Wordmark size={17} style={{ color: "var(--cream)" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-faint">Platform</span>
        </div>

        {/*
          The tabs, as the workspace's own pill (M106). One inverted chip
          says where you are; the rest carry a count when it is known.
        */}
        <nav
          role="tablist"
          aria-label="Console"
          className="scroll-thin order-last flex w-full items-center gap-[2px] overflow-x-auto rounded-full p-1 md:order-none md:mx-auto md:w-auto"
          style={{ background: "var(--owner-card)", border: "1px solid var(--owner-line)" }}
        >
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className="owner-tab flex flex-none items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] leading-none transition-colors"
            >
              {TAB_LABEL[t]}
              {badge[t] !== undefined && (
                <span
                  className="rounded-full px-1.5 py-[2px] font-mono text-[9.5px] leading-none"
                  style={{
                    background: tab === t ? "rgba(0,0,0,.12)" : "var(--owner-card-strong)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {badge[t]}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeMenu theme={theme} onChoose={chooseTheme} />
          {/* A way out (M68): the page is unlinked by design, which is about
              how you arrive; it must not leave its one user in a room with
              no door. */}
          <button
            type="button"
            onClick={() => navigate("/")}
            className="pressable flex h-[38px] items-center gap-2 rounded-full px-4 text-[13px] leading-none"
            style={{ border: "1px solid var(--owner-line)", background: "var(--owner-card)" }}
          >
            <LogOut size={14} strokeWidth={1.8} aria-hidden />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </header>

      {/* ── the body: one region scrolls, never the page ──────────────── */}
      <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 md:px-8">
        {tab === "overview" && (
          <div className="flex flex-col gap-4">
            {/*
              The figures the owner asked for by name — "the active families,
              how many memories are created, how many subscriptions" — then the
              database light, then errors as a quieter fifth.
            */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Tile label="FAMILIES" state={healthState} value={num(health?.families)} />
              <Tile label="MEMORIES" state={healthState} value={num(health?.memories)} />
              <Tile
                label="SUBSCRIPTIONS"
                state={healthState}
                value={num(health?.subscriptions)}
                // Zero is the truth, not a failure: no plan exists to subscribe
                // to yet. Said out loud so the number does not read as broken.
                note={health?.subscriptions === 0 ? "No plans yet" : null}
              />
              <Tile
                /*
                 * Four outcomes, and "still asking" is one of them (M68). A
                 * probe that never answered is grey, not red: red is reserved
                 * for a database that actually said something bad.
                 */
                label="DATABASE"
                state={
                  isLoadingHealth || healthUnavailable
                    ? "idle"
                    : health?.database === "up"
                      ? "ok"
                      : health?.database === "error"
                        ? "warn"
                        : "bad"
                }
                value={
                  isLoadingHealth
                    ? "Checking…"
                    : healthUnavailable
                      ? // "Could not check" — not "No answer" (M191): a load
                        // that did not arrive is not an answer.
                        "Could not check"
                      : health?.database === "up"
                        ? "Reachable"
                        : health?.database === "error"
                          ? "Errors"
                          : health
                            ? "Unreachable"
                            : "No answer"
                }
                note={health?.detail ?? null}
              />
              <Tile
                label="ERRORS · 24H"
                state={!health?.errors_24h ? healthState : health.errors_24h > 10 ? "bad" : "warn"}
                value={num(health?.errors_24h)}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <NeedsYou needs={needs} allRead={allRead} />
              <RecentEvents enabled={behindDoor} />
            </div>

            <p className="px-1 text-[12px] leading-[1.6] text-fg-faint">
              Information only — no archive's contents are reachable from this console (M55). Storage
              is not recorded yet. Plans are manual invoices: issue, mark paid, pause, close.
            </p>
          </div>
        )}

        {tab === "families" && (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <FamiliesPanel families={families} filter={filter} onFilter={setFilter} onOpen={(f) => setOpenId(f.family_id)} />
          </div>
        )}

        {tab === "door" && <Doorstep />}
        {tab === "fulfilment" && <Fulfilment />}
        {tab === "hardware" && <DeviceRequests />}
        {tab === "security" && <TwoStepSignIn />}
      </div>

      {opened && <FamilyDrawer family={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/**
 * What stands in for the console until the door is answered (M195).
 *
 * The waiting state was a bare "…", which is indistinguishable from a page
 * that has quietly broken — and it can genuinely persist: React Query pauses
 * a retry while the tab is unfocused (`retryer.js`, `canContinue` requires
 * `focusManager.isFocused()`), so a request that failed once and is waiting
 * to retry sits here until the owner comes back to the tab. That is the
 * library being sensible about background tabs; it is only cruel because the
 * screen said nothing about it.
 *
 * After a few seconds it offers a reload — and says nothing about *why*. The
 * refusal below stays deliberately identical for a stranger and for an
 * outage: a 404 is what both get, and inventing a friendlier explanation
 * here would leak exactly the distinction the backend refuses to make.
 */
function OwnerDoor({ waiting, outage }: { waiting: boolean; outage: boolean }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-fg-muted">
        {waiting ? "Checking…" : outage ? "The platform could not be read." : "Nothing here."}
      </p>
      {/*
        Only for the outage. A stranger gets the bare sentence above and
        nothing else, because anything else — a reason, a retry, a tone —
        confirms there is something here to come back to.
      */}
      {outage && (
        <>
          <p className="max-w-[340px] text-[13px] leading-[1.6] text-fg-faint">
            The families could not be loaded, so nothing on this page can be trusted to be
            complete. Nothing has been changed.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full px-5 py-2.5 text-[13px]"
            style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
          >
            Try again
          </button>
        </>
      )}
      {waiting && slow && (
        <>
          {/*
            This sentence used to name a cause: "a tab in the background waits
            before trying again". It was written *during* the investigation
            into why this screen stalls, which made it the expensive kind of
            wrong — the same class of mistake as "The screen has not been on"
            (M197), except invented while looking straight at it.

            Two things were wrong with it. It attributed the stall to a
            background tab, and this text is only ever read in a tab somebody
            is looking at. And it promised that waiting would resolve it,
            which is the one thing waiting does not do: a paused retry resumes
            on focus, so by the time these words are visible, the wait is
            already over and something else is slow.

            So it names no cause now. It says what is true — this is longer
            than it should be — and offers the act that actually changes the
            state, without claiming to know why.
          */}
          <p className="max-w-[320px] text-[13px] leading-[1.6] text-fg-faint">
            This is taking longer than it should. Reloading the page is the
            quickest way to find out whether it clears.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full px-5 py-2.5 text-[13px]"
            style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
          >
            Reload the page
          </button>
        </>
      )}
    </div>
  );
}
