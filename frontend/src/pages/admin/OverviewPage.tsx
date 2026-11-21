import { PageFrame } from "@/components/admin/kit";
import { OverviewMasthead } from "@/components/admin/OverviewMasthead";
import { OverviewBento } from "@/components/admin/OverviewBento";
import { MobileOverview } from "@/mobile/MobileOverview";
import { useIsMobile } from "@/mobile/useIsMobile";

/**
 * The homepage of the management area, in the 20a system.
 *
 * Two pieces: the masthead — who is back, whose archive, how far along —
 * and the bento, which answers what her screen is doing, how long she sat
 * with it, and what the family could do next.
 *
 * The page's own data preparation is gone. Each card in the bento reads what
 * it needs, so a card can be moved or dropped without unpicking a shared
 * block of derived values at the top of the file.
 */
export function OverviewPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileOverview /> : <OverviewDesktop />;
}

function OverviewDesktop() {
  return (
    /*
      The masthead is this page's sub-nav, not part of its content (M114).

      That is the owner's model rather than a rearrangement: the welcome line,
      the counts, the ask bar and the stat pills are all *about* the archive,
      and the bento is where things actually happen. Handing the masthead to
      the frame's header slot is what puts the Overview's first card on the
      same line as every other page's first card.

      The Overview does not scroll (M113). It is the page you glance at, and
      a glance does not include finding a scrollbar — anything below the fold
      is, for this page's purpose, not there.

      An earlier pass answered "the bottom row is off screen" by adding
      scroll. That was the wrong direction: it made the page longer instead
      of making it fit, and below the grid's floors it still clipped, leaving
      the black bar at the foot. The bento fits by construction now (see the
      grid note in OverviewBento), so there is nothing to scroll to.
    */
    <PageFrame header={<OverviewMasthead />}>
      <OverviewBento />
    </PageFrame>
  );
}
