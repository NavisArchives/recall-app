import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, CreditCard, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { PageFrame, PageHeader } from "@/components/admin/kit";
import { ScreensBlock, type Screen } from "@/components/admin/ScreensBlock";
import { listState } from "@/lib/listState";

/**
 * Devices — the physical half of Recall (owner-directed).
 *
 * Two lists that must never blur into each other:
 *
 *   MY DEVICES — the machines this family already has, live from the same
 *   route Settings used to show them on. Real state: paired, last used,
 *   retirable.
 *
 *   THE EQUIPMENT — what Recall can send. Each piece opens to an explanation
 *   of how it works and one button that asks for one. There is no shop and
 *   no card number here: the button files a request the platform owner reads,
 *   which is the truth of how hardware moves today, and the page says so
 *   rather than dressing a request up as a checkout.
 */

interface DeviceRequest {
  id: string;
  device_kind: "screen" | "reader_dock" | "hub";
  note: string | null;
  created_at: string;
  handled_at: string | null;
}

const CATALOGUE = [
  {
    kind: "screen" as const,
    Icon: Monitor,
    name: "The screen",
    line: "The television by her chair — always on, never asks anything.",
    how: [
      "It sits on the network and signs itself in once; after that it needs nobody.",
      "It wakes to her channels and goes home on its own when she stops.",
      "If the internet drops it keeps showing what it already holds.",
    ],
  },
  {
    kind: "reader_dock" as const,
    Icon: CreditCard,
    name: "The card reader & keyboard dock",
    line: "The wooden dock the cards rest on — a tap opens the channel.",
    how: [
      "A card laid on it types that card's number, exactly as the keypad would.",
      "No pairing, no batteries in the cards, nothing to configure.",
      "The big-keyed keyboard slots into the same dock for typed numbers.",
    ],
  },
  {
    kind: "hub" as const,
    Icon: Radio,
    name: "The hub",
    line: "The little box that keeps the room connected.",
    how: [
      "It carries the screen and reader on their own small network.",
      "The family plugs it in once; it looks after itself from there.",
      "If it ever loses the house Wi-Fi it says so on the workspace, not on her screen.",
    ],
  },
];

export function DevicesPage() {
  const { subjectName } = useDisplay();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);

  const { data: screens } = useQuery({
    queryKey: ["settings-screens"],
    queryFn: () => api.get<Screen[]>("/settings/screens"),
  });

  const {
    data: requests,
    isPending: requestsPending,
    isError: requestsFailed,
  } = useQuery({
    queryKey: ["device-requests"],
    queryFn: () => api.get<DeviceRequest[]>("/settings/device-requests"),
  });
  const requestsState = listState({
    isPending: requestsPending,
    isError: requestsFailed,
    count: requests?.length ?? 0,
  });

  const ask = useMutation({
    mutationFn: (device_kind: DeviceRequest["device_kind"]) =>
      api.post<DeviceRequest>("/settings/device-requests", { device_kind }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["device-requests"] }),
  });

  /* An open request per kind, so the catalogue can say "asked for" instead of
     offering the same button twice. Only a successful read can claim one —
     a failed read shows the buttons, and the server's own duplicate guard
     (409) is what actually protects the queue. */
  const openRequestFor = (kind: DeviceRequest["device_kind"]) =>
    requestsState === "ready" || requestsState === "empty"
      ? (requests ?? []).find((r) => r.device_kind === kind && !r.handled_at) ?? null
      : null;

  return (
    <PageFrame
      type="roster"
      scroll
      /* The header rides IN the band. An empty band above an in-body header
         was 116px of nothing — the "page starts very low" the owner saw. */
      header={
        <PageHeader
          title="Devices"
          subtitle={`The machines in ${subjectName ? `${subjectName}'s` : "her"} room, and the ones Recall can send.`}
        />
      }
    >
      <div className="max-w-[980px]">

        {/* ── What the family already has ─────────────────────────────── */}
        <ScreensBlock subject={subjectName?.trim() || null} />

        {/* ── The equipment ───────────────────────────────────────────── */}
        <section className="mt-10">
          <p className="font-mono text-[11px] tracking-[0.16em] text-fg-muted">DEVICES TO ORDER</p>
          <p className="mt-2 max-w-[62ch] text-[14px] leading-[1.6] text-fg-muted">
            Open one to see how it works. Asking for one sends a note to Recall — a person
            replies; nothing is charged here.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {CATALOGUE.map(({ kind, Icon, name, line, how }) => {
              const opened = open === kind;
              const standing = openRequestFor(kind);
              const hasOne =
                kind === "screen" && (screens ?? []).some((s) => !!s.trusted_at);
              return (
                <div
                  key={kind}
                  className="flex flex-col rounded-[18px] p-5"
                  style={{
                    border: opened ? "1px solid var(--accent-soft)" : "1px solid var(--line-soft)",
                    background: "rgba(var(--ink),.03)",
                  }}
                >
                  <Icon size={22} strokeWidth={1.6} style={{ color: "var(--accent-soft)" }} aria-hidden />
                  <h3 className="mt-3 text-[16px] font-medium leading-[1.3]">{name}</h3>
                  <p className="mt-1.5 text-[13px] leading-[1.55] text-fg-faint">{line}</p>

                  {opened && (
                    <ul className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-4">
                      {how.map((sentence) => (
                        <li key={sentence} className="flex gap-2.5 text-[13px] leading-[1.55] text-fg-muted">
                          <span
                            className="mt-[7px] size-1 flex-none rounded-full"
                            style={{ background: "var(--accent-soft)" }}
                            aria-hidden
                          />
                          {sentence}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-4 flex flex-1 flex-wrap items-end gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(opened ? null : kind)}
                      className="min-h-[44px] rounded-full border border-line px-4 py-2 text-[13px] sm:min-h-0"
                    >
                      {opened ? "Close" : "How it works"}
                    </button>
                    {standing ? (
                      <span
                        className="rounded-full px-3.5 py-2 text-[12.5px] leading-none"
                        style={{ background: "var(--accent-tint)", color: "var(--accent-soft)" }}
                      >
                        Asked for — we&apos;ll be in touch
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={ask.isPending}
                        onClick={() => ask.mutate(kind)}
                        className="min-h-[44px] rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50 sm:min-h-0"
                        style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
                      >
                        {hasOne ? "Order another" : "Order one"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {ask.isError && (
            <p className="mt-3 text-[13px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
              {ask.error instanceof Error ? ask.error.message : "The request could not be sent."}
            </p>
          )}
          {requestsState === "error" && (
            <p className="mt-3 text-[13px] text-fg-faint" role="alert">
              Your earlier requests could not be loaded — asking again is safe; a duplicate is
              refused rather than doubled.
            </p>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
