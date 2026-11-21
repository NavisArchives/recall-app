import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useChannels, usePeople, type NfcCard } from "@/hooks/useAdminData";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { PageFrame } from "@/components/admin/kit";
import { listState } from "@/lib/listState";

/**
 * Frame 18i — the monthly ritual.
 *
 * Deliberately small: one segmented control, four known values, one date. The
 * automation that matters is "newest in the channel" — the card refreshes
 * itself as the family adds memories, so a ritual set up once in September
 * still shows something new in March.
 *
 * Nothing sends unseen. A scheduled card appears in the overview as a draft
 * before it prints, which is the promise the footer line makes and the reason
 * this screen can afford to be this small.
 */

const CADENCES = [
  { value: "once", label: "Once" },
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
] as const;

type Cadence = (typeof CADENCES)[number]["value"];

/** When the first card of a new ritual goes out. */
function firstSend(cadence: Cadence): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  if (cadence === "weekly") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  // Monthly rituals start on the 1st, which is what the frame draws and what
  // a person means by "every month" — not "the 27th of every month".
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 9, 0, 0, 0);
}

function Row({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-5">
      <div
        className="font-mono text-[12px] uppercase"
        style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
      >
        {label}
      </div>
      <div className="min-w-0 text-[14.5px] leading-[1.4]">{children}</div>
      <div>{action}</div>
    </div>
  );
}

function ChangePill({ onClick, children = "Change" }: { onClick: () => void; children?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-[13px] py-[7px] text-[12px] font-medium leading-none"
      style={{ border: "1px solid var(--line-soft)", color: "var(--fg-faint)" }}
    >
      {children}
    </button>
  );
}

export function SchedulePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const { subjectName } = useDisplay();

  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [channelId, setChannelId] = useState<string | null>(params.get("channel"));
  const [picking, setPicking] = useState(!params.get("channel"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<NfcCard | null>(null);

  const { data: channels, isPending, isError } = useChannels();
  const channelsState = listState({
    isPending,
    isError,
    count: channels?.length ?? 0,
  });
  const channel = (channels ?? []).find((c) => c.id === channelId) ?? null;

  /* FROM names a real person with their relationship — read out of the roster
     this workspace already holds, rather than a self route (there isn't one;
     `GET /people` is the only shape of this question). The signed-in profile
     is the sender the backend actually records either way. */
  const { data: people } = usePeople();
  const me = (people ?? []).find((p) => p.id === profile?.id) ?? null;

  const next = useMemo(() => firstSend(cadence), [cadence]);
  const nextLabel = next.toLocaleDateString("en-GB", { dateStyle: "long" });
  const who = subjectName?.trim() || "her";

  async function save() {
    if (!channelId) return;
    /*
      "Once" is not a schedule, it is the ordinary send — and an ordinary send
      needs a photograph, which this screen deliberately does not ask for. So
      it hands over to the send flow with the channel already chosen instead of
      posting a card the backend would (correctly) refuse for having no photo.
    */
    if (cadence === "once") {
      navigate(`/admin/cards/new?channel=${channelId}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /*
        A repeating card carries NO media id. "Newest in the channel" is a
        standing instruction, and pinning a photograph to it would freeze the
        ritual on its first picture — the backend refuses the combination for
        exactly that reason, so this cannot drift apart from it.
      */
      const card = await api.post<NfcCard>("/nfc-cards/postcards", {
        channel_id: channelId,
        photo_mode: "newest",
        recurrence: cadence,
        next_send_at: next.toISOString(),
        state: "draft",
      });
      await queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
      setDone(card);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The schedule could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <button
      type="button"
      onClick={() => navigate("/admin/cards")}
      className="-my-3.5 self-start py-3.5 font-mono text-xs text-fg-faint hover:text-fg sm:my-0 sm:py-0"
    >
      ← Cards
    </button>
  );

  if (done) {
    return (
      <PageFrame type="roster" header={back}>
        <div className="max-w-[52ch]">
          <h1 className="text-[22px] font-bold leading-[1.2]">That&apos;s the ritual set.</h1>
          <p className="mt-3 text-[14px] leading-[1.7] text-fg-muted">
            The first card goes out on {nextLabel}. It will show the newest photograph in{" "}
            {channel ? `${String(channel.number).padStart(2, "0")} ${channel.title}` : "the channel"}{" "}
            at the time, so it stays worth opening.
          </p>
          <p className="mt-3 text-[14px] leading-[1.7] text-fg-muted">
            You&apos;ll see it in Cards as a draft before it prints. Skip one or stop any time.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/admin/cards")}
              className="inline-flex items-center justify-center rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              Back to cards
            </button>
          </div>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame type="roster" header={back}>
      <div className="max-w-[760px]">
        {/* The frame's own words. The name goes in the sentences that carry
            a promise (18g's "on its way to Margaret"), not in the heading —
            a title that reads "Send Scratch a postcard every month" puts the
            fixture's name where the frame put none. */}
        <h1 className="text-[22px] font-bold leading-[1.2]">Send a postcard every month</h1>
        <p className="mt-2 max-w-[48ch] text-[13.5px] leading-[1.6] text-fg-muted">
          A small ritual — one card a month, made from what the family added lately.
        </p>

        <div className="mt-6 flex flex-col gap-[18px]">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-5">
            <div
              className="font-mono text-[12px] uppercase"
              style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
            >
              Send
            </div>
            <div
              className="inline-flex w-fit gap-0.5 rounded-full p-[3px]"
              style={{
                background: "rgba(var(--ink),.05)",
                border: "1px solid var(--line-soft)",
              }}
              role="radiogroup"
              aria-label="How often"
            >
              {CADENCES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={cadence === c.value}
                  onClick={() => setCadence(c.value)}
                  className="min-h-[44px] sm:min-h-0 rounded-full px-[14px] py-[7px] text-[12.5px] leading-none"
                  style={
                    cadence === c.value
                      ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                      : { color: "var(--fg-muted)" }
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <Row
            label="Channel"
            action={channel ? <ChangePill onClick={() => setPicking(true)} /> : undefined}
          >
            {channelsState === "loading" ? (
              <span className="text-fg-faint">Loading…</span>
            ) : channelsState === "error" ? (
              <span role="alert" className="text-fg-faint">
                The channels could not be loaded.
              </span>
            ) : channel ? (
              <>
                {String(channel.number).padStart(2, "0")} — {channel.title}
              </>
            ) : (
              <span className="text-fg-faint">Not chosen yet</span>
            )}
          </Row>

          {/* The picker sits inline rather than on its own screen: choosing a
              channel is the one decision here, and sending someone away to
              make it would be the larger interruption. */}
          {picking && channelsState === "ready" && (
            <div
              className="rounded-[16px] p-3"
              style={{ border: "1px solid var(--line-soft)" }}
            >
              <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                {(channels ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setChannelId(c.id);
                      setPicking(false);
                    }}
                    className="min-h-[44px] sm:min-h-0 flex items-baseline gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-[rgba(var(--ink),.05)]"
                  >
                    <span className="font-mono text-[13px] text-fg-faint">
                      {String(c.number).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {picking && channelsState === "empty" && (
            <p className="text-[13.5px] leading-[1.6] text-fg-faint">
              There are no channels yet, and a card has to open one.{" "}
              <button
                type="button"
                onClick={() => navigate("/admin/create-channel")}
                className="underline underline-offset-2"
              >
                Make the first channel
              </button>
              .
            </p>
          )}

          <Row
            label="Photo"
            action={
              cadence === "once" ? (
                <ChangePill onClick={() => navigate("/admin/cards/new")}>Choose myself</ChangePill>
              ) : undefined
            }
          >
            {cadence === "once" ? (
              <span className="text-fg-faint">Chosen by you, on the next screen</span>
            ) : (
              "Newest in the channel, chosen automatically"
            )}
          </Row>

          <Row label="To">{who}</Row>

          <Row label="From">
            {[profile?.name, me?.relationship?.toLowerCase()].filter(Boolean).join(", ") ||
              "You"}
          </Row>

          <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-5">
            <div
              className="font-mono text-[12px] uppercase"
              style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
            >
              Next card
            </div>
            <div className="text-[14.5px] leading-[1.4]" style={{ color: "var(--accent-soft)" }}>
              {nextLabel}
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-4 text-[13px]" role="alert" style={{ color: "var(--destructive)" }}>
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            disabled={!channelId || busy}
            onClick={save}
            className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none disabled:opacity-50"
            style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
          >
            {busy ? "Saving…" : cadence === "once" ? "Choose a photo" : "Set schedule"}
          </button>
          <p
            className="font-mono text-[13px] leading-[1.7]"
            style={{ letterSpacing: ".04em", color: "var(--fg-faint)" }}
          >
            {cadence === "once"
              ? "One card, sent when you're ready. The next screen asks which photo."
              : "Skip a month or stop any time. Each card still shows here before it prints."}
          </p>
        </div>
      </div>
    </PageFrame>
  );
}
