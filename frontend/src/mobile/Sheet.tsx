import { useEffect } from "react";

/**
 * The bottom sheet — the phone's one modal shape (wireframes-mobile.md).
 *
 * Slides up from the bottom because that is where a thumb lives; nothing
 * important ever appears at the top of a phone screen. The grab handle and
 * the dimmed page behind are the whole affordance: tap outside or Escape to
 * leave, exactly like putting a card back on the table.
 */
export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ background: "rgba(0,0,0,.6)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 rounded-t-[28px] px-[22px] pt-3.5"
        style={{
          background: "var(--panel-menu)",
          borderTop: "1px solid rgba(var(--ink),.14)",
          paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
          maxHeight: "88vh",
          overflowY: "auto",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-[18px] h-1 w-9 rounded-sm"
          style={{ background: "rgba(var(--ink),.25)" }}
        />
        {children}
      </div>
    </div>
  );
}

/** A sheet's quiet closing row — every sheet ends the same way. */
export function SheetCancel({ onClose, label = "Cancel" }: { onClose: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="flex h-12 w-full items-center justify-center text-[14px] text-fg-faint"
    >
      {label}
    </button>
  );
}
