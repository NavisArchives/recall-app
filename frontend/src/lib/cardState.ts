import type { CardState, NfcCard } from "@/hooks/useAdminData";

/**
 * What a card's state is called, to whom.
 *
 * One row, two readerships. The fulfilment queue (18j) needs `queued`,
 * `printing` and `shipped` apart, because an operator does something
 * different with each. A family does not: from the moment it leaves us until
 * it lands, the honest word is that it is on its way — 18g says "preparing
 * for delivery", 18a's pill says "sent".
 *
 * Both live here so the two vocabularies cannot drift apart in two files, the
 * way the nav label did across three.
 */

/** 18a's pill: draft grey, sent amber, delivered and active green. */
export type PillTone = "grey" | "amber" | "green" | "alarm";

export function cardPill(card: Pick<NfcCard, "kind" | "state">): { label: string; tone: PillTone } {
  // A tag has no send lifecycle (047), so its word describes what it IS.
  if (card.kind === "nfc") return { label: "active", tone: "green" };

  switch (card.state) {
    case "draft":
      return { label: "draft", tone: "grey" };
    case "ready":
      return { label: "ready to send", tone: "grey" };
    case "queued":
    case "printing":
    case "shipped":
    case "sent":
      return { label: "sent", tone: "amber" };
    case "delivered":
      return { label: "delivered", tone: "green" };
    case "returned":
      // The one state a family must not have to decode: it came back.
      return { label: "came back", tone: "alarm" };
    default:
      return { label: "draft", tone: "grey" };
  }
}

/** The operator's word — 18j lists these apart on purpose. */
export function queueLabel(state: CardState | null): string {
  return state ?? "—";
}

export const PILL_STYLE: Record<PillTone, { background: string; color: string }> = {
  grey: { background: "rgba(var(--ink),.08)", color: "var(--fgw-soft)" },
  amber: { background: "var(--accent-tint)", color: "var(--accent-soft)" },
  green: { background: "var(--live-fill)", color: "var(--on-live)" },
  alarm: { background: "transparent", color: "var(--destructive-soft)" },
};

/**
 * Is this card still being made?
 *
 * 18a's tile action is "Continue" for a draft and "View" for everything else,
 * which is the difference between a thing you owe something to and a thing
 * that is out of your hands.
 */
export function isUnfinished(card: Pick<NfcCard, "kind" | "state">): boolean {
  return card.kind === "postcard" && (card.state === "draft" || card.state === "ready");
}
