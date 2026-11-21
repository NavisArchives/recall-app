import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { SELLER } from "@/lib/seller";

/**
 * What is owed, in the shell every member sees (055).
 *
 * Silent for a family with nothing invoiced and for one that is active: the
 * workspace must not nag a paying family. An invoiced family sees one line
 * with the number, the amount and the day it is due; a paused family sees
 * the same line, firmer. Her screen never sees either — the route refuses
 * the bare display, and this component lives in the workspace shells only.
 */
interface Payment {
  payment_state: "none" | "invoiced" | "active" | "paused" | "closed";
  tier: string | null;
  invoice_number: string | null;
  invoice_amount_cents: number | null;
  invoiced_at: string | null;
  due_at: string | null;
}

function euros(cents: number | null): string {
  if (cents === null) return "";
  return `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

export function PaymentNotice() {
  const { signedIn } = useAuth();
  const { data } = useQuery({
    queryKey: ["family", "payment"],
    queryFn: () => api.get<Payment | null>("/family/payment"),
    enabled: signedIn,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!data || (data.payment_state !== "invoiced" && data.payment_state !== "paused")) return null;

  const paused = data.payment_state === "paused";
  const due = data.due_at
    ? new Date(data.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;

  return (
    <div
      role="status"
      className="flex flex-none flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-2.5 text-[13px] leading-[1.5] md:px-8"
      style={{
        background: paused ? "rgba(var(--accent-channels),.18)" : "rgba(var(--accent-channels),.10)",
        borderBottom: "1px solid rgba(var(--accent-channels),.35)",
      }}
    >
      <span className="font-medium" style={{ color: "var(--accent-soft)" }}>
        {paused ? "The workspace is paused until the invoice is paid." : "An invoice is open."}
      </span>
      <span className="text-fg-muted">
        {data.invoice_number} · {euros(data.invoice_amount_cents)} incl. VAT
        {due ? ` · pay by ${due}` : ""}
        {SELLER.iban ? ` · transfer to ${SELLER.iban} with the invoice number as reference` : ""}
      </span>
      <a href={`mailto:${SELLER.email}`} className="text-fg-muted underline underline-offset-2 hover:text-fg">
        Questions? {SELLER.email}
      </a>
      {paused && <span className="text-fg-muted">Her screen keeps playing.</span>}
    </div>
  );
}
