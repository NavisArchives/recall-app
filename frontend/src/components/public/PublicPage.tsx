import type { ReactNode } from "react";
import "@/pages/onboarding/site.css";
import { PublicFooter } from "./PublicFooter";
import { BackCircle } from "@/components/BackCircle";
import { PublicHeader } from "./PublicHeader";

/**
 * The frame the secondary public pages share: an 84px header (wordmark and
 * the language switch), a readable column, the footer. Legal text and help
 * live here; the landing page keeps its own composition.
 *
 * THE WAY BACK SITS UNDER THE RULE, not in the top-right corner (owner,
 * 17 Sep 2026). In the corner it was a third thing competing with the
 * wordmark and the language switch, and it read as part of the language
 * control it sat beside. Under the line, aligned with the wordmark above it,
 * it is plainly "leave this page" — and it is the house circle now rather
 * than a "←" character in a string.
 */
export function PublicPage({
  eyebrow,
  title,
  lead,
  back,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  /** The accessible name of the back control — a word, not an arrow. */
  back: string;
  children: ReactNode;
}) {
  return (
    /* `.site` is the landing page's palette, and every public page wears it
       now — the ground, the ink and the red are the same object on all of
       them, and none of them reads a workspace token any more. */
    <div className="site scroll-thin flex h-full flex-col overflow-y-auto">
      <PublicHeader />

      <div className="flex-none px-6 pt-6 md:px-14">
        <BackCircle label={back} />
      </div>

      <div className="mx-auto w-full max-w-[760px] flex-1 px-6 pb-14 pt-8 md:px-10">
        <p className="font-mono text-[11px] leading-none tracking-[0.18em] text-accent">{eyebrow}</p>
        <h1
          className="mt-5 text-[32px] font-bold leading-[1.15] md:text-[40px]"
          style={{ letterSpacing: "-.015em", textWrap: "balance" }}
        >
          {title}
        </h1>
        {lead ? (
          <p className="mt-4 text-[16px] leading-[1.65] text-fg-muted" style={{ textWrap: "pretty" }}>
            {lead}
          </p>
        ) : null}
        <div className="legal mt-10">{children}</div>
      </div>

      <PublicFooter />
    </div>
  );
}

/** A titled block of running text; the legal pages are a list of these. */
export function Clause({ n, title, children }: { n?: string; title: string; children: ReactNode }) {
  return (
    <section className="py-6 first:pt-0" style={{ borderTop: "1px solid rgba(var(--ink),.10)" }}>
      <h2 className="flex items-baseline gap-3 text-[18px] font-semibold" style={{ letterSpacing: "-.01em" }}>
        {n ? (
          <span className="font-mono text-[11px] tracking-[0.14em]" style={{ color: "rgba(var(--ink),.4)" }}>
            {n}
          </span>
        ) : null}
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-[1.7] text-fg-muted" style={{ textWrap: "pretty" }}>
        {children}
      </div>
    </section>
  );
}
