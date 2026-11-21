import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { SELLER, sellerIsRegistered } from "@/lib/seller";

/**
 * The first euro, on the owner dashboard (055).
 *
 * The PLAN column used to read "—" for every family. It now carries the
 * manual-invoice state machine the 27 August decision promised: Invoice…
 * (pick the configuration, the price fills itself incl. 21% VAT, the
 * database mints the number), then Paid / Pause / Resume / Close, each a
 * conditional move the backend refuses when the family is elsewhere. The
 * printed invoice is the same sheet machinery the postcards use.
 */
export interface FamilyPayment {
  state: "none" | "invoiced" | "active" | "paused" | "closed";
  tier: string | null;
  invoice_number: string | null;
  invoice_amount_cents: number | null;
  invoiced_at: string | null;
  paid_at: string | null;
  activated_at: string | null;
  paused_at: string | null;
  billing_period?: "monthly" | "yearly" | null;
}

/*
 * Two configurations (owner, 17 Sep 2026): the same €25/month or €275/year
 * subscription for both; only the Dock adds a one-time device charge, and
 * that has no settled price yet, so it is typed by hand on the invoice.
 * Mirrors TIER_PRICES in backend/src/routes/owner.ts.
 */
const TIERS: { key: string; label: string; once: number | null; monthly: number; yearly: number }[] = [
  { key: "digital", label: "Recall", once: 0, monthly: 2500, yearly: 27500 },
  { key: "dock", label: "Recall Dock", once: null, monthly: 2500, yearly: 27500 },
];
type Period = "monthly" | "yearly";

export function euros(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const whole = cents % 100 === 0;
  return `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function day(at: string | null): string {
  return at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
}

const STATE_LABEL: Record<FamilyPayment["state"], string> = {
  none: "Not invoiced",
  invoiced: "Invoiced",
  active: "Active",
  paused: "Paused",
  closed: "Closed",
};

export function PaymentCell({
  familyId,
  payment,
  isPlatformRow,
}: {
  familyId: string;
  payment: FamilyPayment;
  isPlatformRow: boolean;
}) {
  const queryClient = useQueryClient();
  const [invoicing, setInvoicing] = useState(false);
  const [tier, setTier] = useState("digital");
  const [period, setPeriod] = useState<Period>("monthly");
  // The one-time device charge only — the subscription is added by the server.
  const [device, setDevice] = useState("0");
  const [printing, setPrinting] = useState(false);

  const move = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: object }) =>
      api.post(`/owner/families/${familyId}/${action}`, body ?? {}),
    onSuccess: async () => {
      setInvoicing(false);
      await queryClient.invalidateQueries({ queryKey: ["owner"] });
    },
  });

  if (isPlatformRow) return <span className="text-fg-faint">—</span>;

  const chosen = TIERS.find((t) => t.key === tier) ?? TIERS[0];
  const deviceCents = Math.round(Number(device.replace(",", ".")) * 100);
  const deviceOk = Number.isFinite(deviceCents) && deviceCents >= 0 && (chosen.once !== null || device.trim() !== "");
  const subscriptionCents = period === "yearly" ? chosen.yearly : chosen.monthly;
  const totalCents = (Number.isFinite(deviceCents) ? deviceCents : 0) + subscriptionCents;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2">
        <Pill state={payment.state} />
        {payment.invoice_number && (
          <span className="font-mono text-[11px] text-fg-faint">
            {payment.invoice_number} · {euros(payment.invoice_amount_cents)}
          </span>
        )}
      </span>
      {payment.state === "invoiced" && payment.invoiced_at && (
        <span className="text-[11px] text-fg-faint">sent {day(payment.invoiced_at)} · due {day(new Date(Date.parse(payment.invoiced_at) + 14 * 86_400_000).toISOString())}</span>
      )}
      {payment.state === "active" && payment.paid_at && (
        <span className="text-[11px] text-fg-faint">
          {TIERS.find((t) => t.key === payment.tier)?.label ?? payment.tier}
          {payment.billing_period ? ` · ${payment.billing_period}` : ""} · paid {day(payment.paid_at)}
        </span>
      )}

      {!invoicing && (
        <div className="flex flex-wrap gap-1.5">
          {(payment.state === "none" || payment.state === "closed") && (
            <Btn onClick={() => setInvoicing(true)}>Invoice…</Btn>
          )}
          {(payment.state === "invoiced" || payment.state === "paused") && (
            <Btn onClick={() => move.mutate({ action: "paid" })} busy={move.isPending}>
              Paid
            </Btn>
          )}
          {(payment.state === "invoiced" || payment.state === "active") && (
            <Btn onClick={() => move.mutate({ action: "pause" })} busy={move.isPending}>
              Pause
            </Btn>
          )}
          {payment.state === "paused" && (
            <Btn onClick={() => move.mutate({ action: "resume" })} busy={move.isPending}>
              Resume
            </Btn>
          )}
          {payment.invoice_number && <Btn onClick={() => setPrinting(true)}>Print invoice</Btn>}
          {payment.state !== "none" && payment.state !== "closed" && (
            <Btn
              onClick={() => {
                if (window.confirm("Close this family's plan? Billing ends; export and retention follow the terms.")) {
                  move.mutate({ action: "close" });
                }
              }}
              busy={move.isPending}
            >
              Close
            </Btn>
          )}
        </div>
      )}

      {invoicing && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[10px] p-2.5"
          style={{ border: "1px solid rgba(var(--ink),.14)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!deviceOk) return;
            move.mutate({ action: "invoice", body: { tier, billing_period: period, amount_cents: deviceCents } });
          }}
        >
          <label className="flex flex-col gap-1 text-[11px] text-fg-faint">
            CONFIGURATION
            <select
              value={tier}
              onChange={(e) => {
                const next = TIERS.find((t) => t.key === e.target.value);
                setTier(e.target.value);
                setDevice(next?.once === null ? "" : String((next?.once ?? 0) / 100));
              }}
              className="rounded-[8px] bg-transparent px-2 py-1.5 text-[13px]"
              style={{ border: "1px solid var(--line)" }}
            >
              {TIERS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-fg-faint">
            BILLING
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-[8px] bg-transparent px-2 py-1.5 text-[13px]"
              style={{ border: "1px solid var(--line)" }}
            >
              <option value="monthly">Monthly · {euros(chosen.monthly)}</option>
              <option value="yearly">Yearly · {euros(chosen.yearly)}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-fg-faint">
            DEVICE, ONE-TIME
            <input
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              inputMode="decimal"
              placeholder={chosen.once === null ? "agreed price" : "0"}
              className="w-24 rounded-[8px] bg-transparent px-2 py-1.5 font-mono text-[13px]"
              style={{ border: "1px solid var(--line)" }}
            />
          </label>
          <span className="font-mono text-[11px] text-fg-faint">= {euros(totalCents)} incl. VAT</span>
          <Btn type="submit" busy={move.isPending} disabled={!deviceOk}>
            Issue invoice
          </Btn>
          <Btn onClick={() => setInvoicing(false)}>Cancel</Btn>
          {chosen.once === null && (
            <span className="basis-full text-[11px]" style={{ color: "var(--accent-soft)" }}>
              The Dock has no settled price; type the device amount you agreed. The subscription is added on top.
            </span>
          )}
        </form>
      )}

      {move.isError && (
        <span role="alert" className="text-[11px]" style={{ color: "var(--destructive-soft)" }}>
          {(move.error as Error)?.message || "That did not go through."}
        </span>
      )}

      {printing && <InvoiceSheet familyId={familyId} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function Pill({ state }: { state: FamilyPayment["state"] }) {
  const tone =
    state === "active"
      ? { background: "rgba(90,160,110,.18)", color: "#8fd3a3" }
      : state === "invoiced"
        ? { background: "rgba(var(--accent-channels),.16)", color: "var(--accent-soft)" }
        : state === "paused"
          ? { background: "rgba(220,90,80,.16)", color: "#f0a094" }
          : { background: "rgba(255,255,255,.06)", color: "var(--fg-faint)" };
  return (
    <span className="rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.14em]" style={tone}>
      {STATE_LABEL[state].toUpperCase()}
    </span>
  );
}

function Btn({
  children,
  onClick,
  busy,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="rounded-full px-3 py-1.5 text-[12px] leading-none transition-colors hover:border-accent disabled:opacity-50"
      style={{ border: "1px solid var(--line)" }}
    >
      {busy ? "…" : children}
    </button>
  );
}

interface InvoicePayload {
  invoice_number: string;
  invoiced_at: string | null;
  due_at: string | null;
  state: FamilyPayment["state"];
  paid_at: string | null;
  tier: string | null;
  tier_label: string | null;
  amount_cents: number | null;
  billing_period: "monthly" | "yearly";
  monthly_cents: number | null;
  yearly_cents: number | null;
  buyer: { family_name: string; email: string; admin_name: string | null; address: string | null };
  for_whom: string | null;
}

/**
 * EPC QR ("GiroCode"): the payload every Belgian bank app reads to prefill a
 * transfer. Only when the seller has a EUR IBAN on file — an empty IBAN
 * prints no code rather than a code that cannot be paid.
 */
function epcPayload(inv: InvoicePayload): string | null {
  if (!SELLER.iban || inv.amount_cents === null) return null;
  const amount = (inv.amount_cents / 100).toFixed(2);
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    SELLER.bic || "",
    (SELLER.accountHolder || SELLER.legalName || SELLER.tradeName).slice(0, 70),
    SELLER.iban.replace(/\s+/g, ""),
    `EUR${amount}`,
    "",
    "",
    `Recall ${inv.invoice_number}`.slice(0, 140),
    "",
  ].join("\n");
}

function InvoiceSheet({ familyId, onClose }: { familyId: string; onClose: () => void }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["owner", "invoice", familyId],
    queryFn: () => api.get<InvoicePayload>(`/owner/families/${familyId}/invoice`),
    staleTime: 0,
  });
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const payload = epcPayload(data);
    if (!payload) {
      setQr(null);
      return;
    }
    let live = true;
    QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width: 180 })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [data]);

  const vatIncluded = data?.amount_cents !== null && data?.amount_cents !== undefined ? Math.round(data.amount_cents - data.amount_cents / 1.21) : null;
  const registered = sellerIsRegistered();

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-6 print:static print:overflow-visible print:p-0"
      style={{ background: "rgba(11,11,12,.92)" }}
      role="dialog"
      aria-label="Print this invoice"
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .invoice-sheet, .invoice-sheet * { visibility: visible; }
          .invoice-sheet { position: absolute; inset: 0; background: white; }
        }
      `}</style>
      <div className="mx-auto flex max-w-[720px] flex-col gap-6">
        <div className="flex w-full items-center justify-between print:hidden">
          <p className="font-mono text-[11px] tracking-[0.16em] text-fg-faint">PRINT — OR SAVE AS PDF AND EMAIL IT</p>
          <div className="flex gap-2">
            <Btn onClick={() => window.print()}>Print</Btn>
            <Btn onClick={onClose}>Close</Btn>
          </div>
        </div>

        {isPending && <p className="text-fg-muted">Preparing the invoice…</p>}
        {isError && (
          <p role="alert" style={{ color: "var(--destructive-soft)" }}>
            The invoice could not be read.
          </p>
        )}

        {data && (
          <div className="invoice-sheet bg-white p-12 text-black" style={{ font: "400 14px/1.6 Roboto, Helvetica, Arial, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
              <div>
                <p style={{ font: "800 28px/1 Archivo, sans-serif", letterSpacing: "-.02em", margin: 0 }}>Recall</p>
                <p style={{ margin: "6px 0 0", color: "#555", fontSize: 12 }}>A living archive · recall.family</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ font: "700 11px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666", margin: 0 }}>
                  Invoice · Factuur
                </p>
                <p style={{ font: "500 20px/1.2 'Roboto Mono', monospace", margin: "6px 0 0" }}>{data.invoice_number}</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#555" }}>
                  {data.invoiced_at ? new Date(data.invoiced_at).toLocaleDateString("en-GB", { dateStyle: "long" }) : ""}
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 32, fontSize: 13 }}>
              <div>
                <p style={{ font: "700 10px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666", margin: "0 0 6px" }}>Seller · Verkoper</p>
                <p style={{ margin: 0, whiteSpace: "pre-line" }}>
                  {registered
                    ? `${SELLER.legalName}\n${SELLER.address}${SELLER.registration ? `\n${SELLER.registration}` : ""}${SELLER.vat ? `\nVAT ${SELLER.vat}` : ""}`
                    : `${SELLER.tradeName}\n${SELLER.region}\n[registered seller details pending]`}
                  {"\n"}
                  {SELLER.email}
                  {SELLER.phone ? `\n${SELLER.phone}` : ""}
                </p>
              </div>
              <div>
                <p style={{ font: "700 10px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666", margin: "0 0 6px" }}>Billed to · Aan</p>
                <p style={{ margin: 0, whiteSpace: "pre-line" }}>
                  {data.buyer.admin_name ?? data.buyer.family_name}
                  {data.buyer.admin_name && data.buyer.admin_name !== data.buyer.family_name ? `\n${data.buyer.family_name}` : ""}
                  {data.buyer.address ? `\n${data.buyer.address}` : ""}
                  {"\n"}
                  {data.buyer.email}
                </p>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 32, fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #000" }}>
                  <th style={{ textAlign: "left", padding: "8px 0", font: "700 10px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666" }}>Description</th>
                  <th style={{ textAlign: "right", padding: "8px 0", font: "700 10px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "12px 0" }}>
                    {data.tier_label ?? "Recall"} — {data.billing_period === "yearly" ? "first year" : "first month"}
                    {data.tier === "dock" ? ", incl. the Recall Dock" : ""}
                    {data.for_whom ? `, for ${data.for_whom}` : ""}
                    <br />
                    <span style={{ color: "#555", fontSize: 12 }}>
                      {data.billing_period === "yearly"
                        ? `Then ${euros(data.yearly_cents)} a year incl. VAT (one month free), invoiced yearly, cancel any time.`
                        : `Then ${euros(data.monthly_cents)}/month incl. VAT, invoiced monthly, cancel any month.`}
                    </span>
                  </td>
                  <td style={{ padding: "12px 0", textAlign: "right", fontFamily: "'Roboto Mono', monospace" }}>{euros(data.amount_cents)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "10px 0 2px", textAlign: "right", color: "#555", fontSize: 12 }}>of which 21% VAT · waarvan 21% btw</td>
                  <td style={{ padding: "10px 0 2px", textAlign: "right", fontFamily: "'Roboto Mono', monospace", color: "#555", fontSize: 12 }}>{euros(vatIncluded)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "6px 0", textAlign: "right", font: "700 14px/1 Archivo, sans-serif" }}>Total · Totaal (incl. VAT)</td>
                  <td style={{ padding: "6px 0", textAlign: "right", font: "500 18px/1 'Roboto Mono', monospace" }}>{euros(data.amount_cents)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginTop: 32, fontSize: 13 }}>
              <div style={{ flex: 1 }}>
                <p style={{ font: "700 10px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666", margin: "0 0 6px" }}>How to pay · Betalen</p>
                <p style={{ margin: 0 }}>
                  Bank transfer · Overschrijving
                  {SELLER.iban ? (
                    <>
                      <br />
                      IBAN <span style={{ fontFamily: "'Roboto Mono', monospace" }}>{SELLER.iban}</span>
                      {SELLER.bic ? <> · BIC {SELLER.bic}</> : null}
                      <br />
                      Reference · Mededeling: <strong>Recall {data.invoice_number}</strong>
                    </>
                  ) : (
                    <>
                      <br />
                      <span style={{ color: "#a33" }}>[bank details pending — add SELLER.iban]</span>
                    </>
                  )}
                  <br />
                  Due · Vervaldag: {data.due_at ? new Date(data.due_at).toLocaleDateString("en-GB", { dateStyle: "long" }) : "14 days"}
                </p>
                <p style={{ margin: "14px 0 0", fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                  Prices include 21% VAT. 14-day right of withdrawal and a 30-day guarantee: recall.family/terms. On a
                  death, billing stops the day you tell us. · Prijzen inclusief 21% btw. Herroepingsrecht van 14 dagen en
                  30 dagen garantie: recall.family/terms.
                </p>
              </div>
              {qr && (
                <div style={{ textAlign: "center", fontSize: 10, color: "#555" }}>
                  <img src={qr} alt="Payment QR code" width={150} height={150} style={{ display: "block" }} />
                  Scan with your bank app
                </div>
              )}
            </div>

            {data.state === "active" && data.paid_at && (
              <p style={{ marginTop: 28, font: "700 12px/1 Archivo, sans-serif", letterSpacing: ".1em", textTransform: "uppercase", color: "#2b7a4b" }}>
                Paid · Betaald — {new Date(data.paid_at).toLocaleDateString("en-GB", { dateStyle: "long" })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
