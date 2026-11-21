import { Lock } from "lucide-react";

/**
 * "You can see this; you cannot change it."
 *
 * The owner's rule for helpers: everything is visible, and only changing and
 * deleting are held back. Hiding a page said the product was smaller than it
 * is; dimming one said it was broken. A lock says the true thing — this
 * belongs to somebody else — and says it the same way everywhere, which is
 * why it lives in one component rather than five.
 */
export function LockedNotice({ what }: { what: string }) {
  return (
    <p
      className="flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[13px] leading-[1.5]"
      style={{
        border: "1px solid rgba(var(--ink),.18)",
        background: "rgba(var(--ink),.03)",
        color: "var(--fg-muted)",
      }}
    >
      <Lock className="h-3.5 w-3.5 flex-none" aria-hidden />
      <span>{what}</span>
    </p>
  );
}
