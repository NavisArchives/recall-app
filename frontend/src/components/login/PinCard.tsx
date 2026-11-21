import type { ReactNode } from "react";

/**
 * The frame a PIN is entered in, everywhere (owner-directed).
 *
 * The PIN screen used to be a face and six cells floating on the ground —
 * correct, but bare. This gives it the claim card's composure: one contained
 * panel, the face framed in a quiet ring at its head, the title and the line
 * beneath it, then the cells — a place, not an empty middle. Presentation
 * only; the entry itself is the shared `PinInput`, so the kiosk and the
 * remote chooser wear the same card.
 */
export function PinCard({
  avatar,
  title,
  subtitle,
  children,
  footer,
}: {
  avatar: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** The PinInput and its reserved error line. */
  children: ReactNode;
  /** The one quiet way out — "Forgot your PIN?", a reset pointer. */
  footer?: ReactNode;
}) {
  return (
    <div className="relative w-full max-w-[500px]">
      {/* A soft warmth pooled behind the card, so it sits in light rather
          than on a void — the accent, scarce, as the system asks. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 22%, rgba(var(--accent-channels),.10), transparent 70%)",
        }}
      />
      <div
        className="box-border w-full rounded-[28px] px-4 pb-8 pt-9 text-center sm:px-9"
        style={{
          background: "rgba(var(--ink),.035)",
          border: "1px solid rgba(var(--ink),.09)",
          boxShadow: "0 30px 80px rgba(0,0,0,.45)",
        }}
      >
        {/* The face, framed — a thin ring with a little air, echoing the
            claim card's headpiece. */}
        <div
          className="mx-auto flex w-fit items-center justify-center rounded-full p-1.5"
          style={{ border: "1px solid rgba(var(--ink),.12)" }}
        >
          {avatar}
        </div>

        <p
          className="mt-5 text-[26px] font-light md:text-[30px]"
          style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em", lineHeight: 1.15 }}
        >
          {title}
        </p>
        <p className="mt-2 text-[13px]" style={{ color: "var(--fg-soft)" }}>
          {subtitle}
        </p>

        {/*
          `items-stretch`, not `items-center` (M189, second pass): centring
          here shrink-wrapped this column to its content, which left the
          fluid PIN row with no width to divide. The row centres its own
          cells, so nothing moves visually — the column simply stops being
          the narrowest thing in the chain.
        */}
        <div className="mt-7 flex w-full flex-col items-stretch">{children}</div>

        {footer && (
          <div className="mt-6 text-[12px]" style={{ color: "var(--fg-hint)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
