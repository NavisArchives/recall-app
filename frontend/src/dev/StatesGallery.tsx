import { useState } from "react";
import { PinCard } from "@/components/login/PinCard";
import { PinInput } from "@/components/login/PinInput";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { ScreenRow } from "@/components/admin/ScreensBlock";
import { Sheet, SheetCancel } from "@/mobile/Sheet";
import {
  BentoCard,
  CreamInset,
  PageHeader,
  PrimaryPill,
  GhostPill,
  SearchField,
  StatPill,
} from "@/components/admin/kit";

/*
 * The states the live sweep cannot reach (M190, half 1).
 *
 * Feedback signs in on production and walks the real pages, which is the
 * better instrument for anything reachable that way — and it is the thing I
 * could not do, which is exactly why the PIN regression shipped. This page
 * covers the remainder: states that need a failed request, an empty table, a
 * specific role, or a sheet that only opens mid-flow. Reaching those live
 * means breaking production on purpose.
 *
 * These are the **real components**, not markup replicas. That distinction
 * cost me a wasted measurement earlier today: a hand-copied replica in an
 * app-context harness reported 0px where arithmetic said 30, and I had to
 * throw the reading away. A replica tests the replica.
 *
 * Dev only — the route is registered behind `import.meta.env.DEV`, so this
 * never reaches a family. Open it at a phone width with the console visible:
 * the collapse guard (M190 half 2) watches this page like any other, so a
 * collapsed row announces itself with its ancestor chain instead of waiting
 * to be noticed.
 */

const WIDTHS = [320, 360, 390, 430];

function Case({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="mb-1 font-mono text-[10px] tracking-[0.16em] text-fg-faint">{label}</p>
      {note && <p className="mb-3 text-[12px] text-fg-muted">{note}</p>}
      <div style={{ border: "1px dashed rgba(var(--ink),.14)", borderRadius: 12, padding: 12 }}>
        {children}
      </div>
    </section>
  );
}

const SCREEN_FIXTURE = {
  id: "fixture",
  name: "Living-room display",
  is_recall_device: false,
  trusted_at: "2026-02-01T00:00:00.000Z",
  last_used_at: null as string | null,
  software_version: null as string | null,
  session_expires_at: null as string | null,
};

export function StatesGallery() {
  const [pin, setPin] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[560px] px-5 py-8" style={{ background: "#0a0a0a", minHeight: "100dvh" }}>
      <h1 className="text-[22px] font-bold">Component states</h1>
      <p className="mb-2 mt-1 text-[13px] text-fg-muted">
        The states production cannot show without breaking it. Resize to{" "}
        {WIDTHS.join(" / ")} and watch the console.
      </p>
      <p className="mb-8 text-[12px] text-fg-faint">
        Current width: <span className="font-mono">{window.innerWidth}px</span> — reload after
        resizing to re-run the first-paint scan.
      </p>

      {/*
        ── The screens list, in the states a fetch cannot reach (047) ────

        `ScreensBlock` asks `/settings/screens`, which needs an administrator's
        session, so the page gallery can only ever show it empty, pending or
        failed. These are the populated rows — and they carry the whole point
        of 047, which is that two kinds of row look and behave differently.
      */}
      <Case
        label="SCREEN — A RECALL DEVICE"
        note="Hardware we ship: a shield, a mark, and NO retire control — the family may not retire it. If a Retire button appears here, that is the bug."
      >
        <ul className="flex flex-col gap-2.5">
          <ScreenRow
            screen={{
              ...SCREEN_FIXTURE,
              id: "hw",
              is_recall_device: true,
              last_used_at: new Date(Date.now() - 86_400_000).toISOString(),
              software_version: "1.4.0",
            }}
            confirming={false}
            busy={false}
            onAsk={() => {}}
            onCancel={() => {}}
            onRetire={() => {}}
          />
        </ul>
      </Case>

      <Case
        label="SCREEN — A BROWSER THE FAMILY PAIRED"
        note="Theirs to retire, so the control is here. This is the way out that did not exist before — the alternative was a link to an inbox nobody could receive."
      >
        <ul className="flex flex-col gap-2.5">
          <ScreenRow
            screen={{
              ...SCREEN_FIXTURE,
              id: "browser",
              name: "The family screen",
              last_used_at: new Date(Date.now() - 9 * 86_400_000).toISOString(),
              software_version: "1.4.0",
            }}
            confirming={false}
            busy={false}
            onAsk={() => {}}
            onCancel={() => {}}
            onRetire={() => {}}
          />
        </ul>
      </Case>

      <Case
        label="SCREEN — MID-CONFIRM"
        note="Retiring is one press away from the display going dark, so it asks. The row must not reflow when the controls swap."
      >
        <ul className="flex flex-col gap-2.5">
          <ScreenRow
            screen={{ ...SCREEN_FIXTURE, id: "confirm" }}
            confirming
            busy={false}
            onAsk={() => {}}
            onCancel={() => {}}
            onRetire={() => {}}
          />
        </ul>
      </Case>

      <Case
        label="SCREEN — NEVER USED, NO VERSION"
        note="A machine paired and not yet opened. It must say 'Not used yet' and stay SILENT about the version — 'Version unknown' reads as a fault on a row that is fine."
      >
        <ul className="flex flex-col gap-2.5">
          <ScreenRow
            screen={{ ...SCREEN_FIXTURE, id: "fresh" }}
            confirming={false}
            busy={false}
            onAsk={() => {}}
            onCancel={() => {}}
            onRetire={() => {}}
          />
        </ul>
      </Case>

      <Case
        label="SCREEN — THE LONGEST PLAUSIBLE NAME"
        note="A name somebody typed, beside a badge and a control, on a narrow admin column."
      >
        <ul className="flex flex-col gap-2.5">
          <ScreenRow
            screen={{
              ...SCREEN_FIXTURE,
              id: "long",
              name: "Grandma's living-room television in the back room",
              is_recall_device: true,
              software_version: "1.4.0-beta.2",
            }}
            confirming={false}
            busy={false}
            onAsk={() => {}}
            onCancel={() => {}}
            onRetire={() => {}}
          />
        </ul>
      </Case>

      {/* ── The regression's own screen, in every state it has ─────────── */}
      <Case
        label="PIN — EMPTY"
        note="The state that shipped as six 3px hairlines. Cells should be even, tappable, and centred."
      >
        <PinCard
          avatar={<InitialsAvatar name="Sam Peeters" size={72} />}
          title="Hi Andy"
          subtitle="Enter your six-digit PIN"
          footer={null}
        >
          <PinInput value={pin} onChange={setPin} onComplete={() => {}} />
        </PinCard>
      </Case>

      <Case label="PIN — PARTIALLY FILLED" note="Dots and the caret share the row.">
        <PinCard
          avatar={<InitialsAvatar name="Hélène Fournier" size={72} />}
          title="Hi Hélène"
          subtitle="Enter your six-digit PIN"
          footer={null}
        >
          <PinInput value="123" onChange={() => {}} onComplete={() => {}} />
        </PinCard>
      </Case>

      <Case
        label="PIN — ERROR"
        note="Thicker borders plus the shake animation; the row must not reflow when the border grows."
      >
        <PinCard
          avatar={<InitialsAvatar name="Paul Scratch" size={72} />}
          title="Hi Paul"
          subtitle="Enter your six-digit PIN"
          footer={<span className="text-[13px] text-fg-faint">Forgotten it? Ask an administrator.</span>}
        >
          <PinInput value="1234" onChange={() => {}} onComplete={() => {}} state="error" />
        </PinCard>
      </Case>

      <Case label="PIN — LONGEST PLAUSIBLE NAME" note="A long name must not push the card wider than the phone.">
        <PinCard
          avatar={<InitialsAvatar name="Anne-Sophie Vandersteen" size={72} />}
          title="Hi Anne-Sophie"
          subtitle="Enter your six-digit PIN"
          footer={null}
        >
          <PinInput value="" onChange={() => {}} onComplete={() => {}} />
        </PinCard>
      </Case>

      {/* ── Rows of controls: the shape that collapses ─────────────────── */}
      <Case
        label="HEADER WITH ACTIONS"
        note="A title beside a control row — the pattern that squeezed Insights at phone width."
      >
        <PageHeader
          title="Memory Shelf"
          subtitle="Everything Margaret can open, in the order she meets it"
          actions={
            <div className="flex items-center gap-2">
              <GhostPill onClick={() => {}}>Filter</GhostPill>
              <PrimaryPill onClick={() => {}}>+ New memory</PrimaryPill>
            </div>
          }
        />
      </Case>

      <Case label="SEARCH FIELD + STAT PILLS" note="Fluid field next to fixed pills.">
        <div className="flex flex-col gap-3">
          <SearchField value="" onChange={() => {}} placeholder="Search memories…" />
          <div className="flex flex-wrap gap-2">
            <StatPill label="DESCRIBED" tone="accent">70%</StatPill>
            <StatPill label="NFC LINKED">0 of 1</StatPill>
            <StatPill label="THIS WEEK" tone="outline">+10 photos</StatPill>
          </div>
        </div>
      </Case>

      {/* ── The error branches: a failed load, which production won't show ── */}
      <Case
        label="ERROR BRANCH — the sentence a failed load renders"
        note="F70's class. These must never read as an empty archive."
      >
        <BentoCard className="flex flex-col p-6">
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            What Margaret returns to
          </span>
          <p className="mt-4 text-[13px]" style={{ color: "rgba(var(--ink-cream),.6)" }}>
            This could not be loaded, so we cannot say what she has opened.
          </p>
        </BentoCard>
      </Case>

      <Case label="EMPTY BRANCH" note="The same card with a genuine nothing.">
        <BentoCard className="flex flex-col p-6">
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            What Margaret returns to
          </span>
          <p className="mt-4 text-[13px]" style={{ color: "rgba(var(--ink-cream),.6)" }}>
            Nothing has been opened yet this week.
          </p>
        </BentoCard>
      </Case>

      <Case label="CREAM INSET — the nudge, with its action" note="Dark-on-cream, and a full-width button on a phone.">
        <CreamInset className="flex flex-col p-6">
          <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: "rgba(20,19,17,.55)" }}>
            THIS WEEK'S NUDGE
          </span>
          <p className="mt-4 text-[17px] font-light italic leading-[1.45]">
            New photos land best before lunch — this week's additions were on Margaret's screen the
            same day.
          </p>
        </CreamInset>
      </Case>

      {/* ── A sheet: only openable mid-flow on a real device ───────────── */}
      <Case label="SHEET" note="Opens over the page; check it clears the browser toolbar at the bottom.">
        <GhostPill onClick={() => setSheetOpen(true)}>Open the sheet</GhostPill>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
          <p className="text-[17px]">Remove this photograph?</p>
          <p className="mt-2 text-[13px] text-fg-muted">
            It moves to Recently deleted, and can be restored from there.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <PrimaryPill onClick={() => setSheetOpen(false)}>Remove</PrimaryPill>
            <SheetCancel onClose={() => setSheetOpen(false)} />
          </div>
        </Sheet>
      </Case>
    </div>
  );
}
