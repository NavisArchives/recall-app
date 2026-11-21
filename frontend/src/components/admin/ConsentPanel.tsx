import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LockedNotice } from "@/components/admin/LockedNotice";
import {
  CONSENT_BASES,
  CONSENT_COPY,
  type ConsentBasis,
  type ConsentLang,
  type ConsentRecord,
} from "@/lib/consent";
import { SELLER } from "@/lib/seller";

const LABEL = "font-mono text-[11px] tracking-[0.16em] text-fg-muted";
const PANEL = "mt-4 rounded-[18px] p-6";
const PANEL_STYLE = { border: "1px solid var(--line-soft)", background: "rgba(var(--ink),.03)" };
const FIELD =
  "mt-1.5 w-full rounded-[12px] bg-[rgba(var(--ink),0.04)] px-4 py-2.5 text-[15px] outline-none focus:border-accent";
const BORDER = { border: "1px solid var(--input)" };

interface ConsentAnswer {
  current: ConsentRecord | null;
  declarations: number;
  text_version: string;
}

/**
 * Her word, on the Settings page (054).
 *
 * Shows the standing declaration — who agrees, who signed, when, in which
 * wording — with three doors: print it (for a kitchen-table signature or a
 * folder), record it again (a new row; the old one stays as history), and
 * withdraw it. A family whose sign-up predates 054, or whose sign-up write
 * failed, sees the gap named and the form to close it.
 */
export function ConsentPanel({ isAdmin, subjectName }: { isAdmin: boolean; subjectName: string }) {
  const queryClient = useQueryClient();
  const lang: ConsentLang = "en";
  const t = CONSENT_COPY[lang];
  const { data, isPending, isError } = useQuery({
    queryKey: ["settings", "consent"],
    queryFn: () => api.get<ConsentAnswer>("/settings/consent"),
    enabled: isAdmin,
  });
  const [recording, setRecording] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [basis, setBasis] = useState<ConsentBasis | null>(null);
  const [signer, setSigner] = useState("");
  const [agreed, setAgreed] = useState(false);

  const record = useMutation({
    mutationFn: () => api.post("/settings/consent", { basis, signer_name: signer.trim(), lang }),
    onSuccess: async () => {
      setRecording(false);
      setBasis(null);
      setSigner("");
      setAgreed(false);
      await queryClient.invalidateQueries({ queryKey: ["settings", "consent"] });
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api.post("/settings/consent/withdraw", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings", "consent"] }),
  });

  if (!isAdmin) {
    return (
      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>{t.title.toUpperCase()}</p>
        <div className="mt-4">
          <LockedNotice what="Who agreed to this archive is recorded here. Reading and changing it is an administrator's to do." />
        </div>
      </section>
    );
  }

  const current = data?.current ?? null;

  return (
    <section className={PANEL} style={PANEL_STYLE}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className={LABEL}>{t.title.toUpperCase()}</p>
        {current && (
          <div className="flex gap-2">
            <SmallButton onClick={() => setPrinting(true)}>Print</SmallButton>
            <SmallButton onClick={() => setRecording((v) => !v)}>Record again</SmallButton>
            <SmallButton
              onClick={() => {
                if (window.confirm("Withdraw the declaration? Her screen should then go dark until a new one is recorded.")) {
                  withdraw.mutate();
                }
              }}
              busy={withdraw.isPending}
            >
              Withdraw
            </SmallButton>
          </div>
        )}
      </div>

      <p className="mt-3 max-w-[62ch] text-[14px] leading-[1.6] text-fg-muted">{t.why}</p>

      {isPending && <p className="mt-4 text-[14px] text-fg-faint">Reading…</p>}
      {isError && (
        <p className="mt-4 text-[14px]" style={{ color: "var(--destructive-soft)" }}>
          The declaration could not be read. Nothing has changed.
        </p>
      )}

      {data && current && (
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className={LABEL}>WHO AGREES</dt>
            <dd className="mt-1.5 text-[15px]">{t.bases[current.basis].label}</dd>
          </div>
          <div>
            <dt className={LABEL}>SIGNED BY</dt>
            <dd className="mt-1.5 text-[15px]">
              {current.signer_name}
              {current.signer_relationship ? (
                <span className="text-fg-faint"> · {current.signer_relationship}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className={LABEL}>ON</dt>
            <dd className="mt-1.5 text-[15px]">
              {new Date(current.declared_at).toLocaleDateString("en-GB", { dateStyle: "long" })}
            </dd>
          </div>
          <div>
            <dt className={LABEL}>WORDING</dt>
            <dd className="mt-1.5 font-mono text-[13px] text-fg-muted">
              v{current.text_version} · {current.lang.toUpperCase()}
              {data.declarations > 1 ? ` · ${data.declarations} declarations on file` : ""}
            </dd>
          </div>
        </dl>
      )}

      {data && !current && !recording && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] p-4" style={{ border: "1px solid rgba(var(--accent-channels),.4)", background: "rgba(var(--accent-channels),.08)" }}>
          <p className="text-[14px] leading-[1.5]" style={{ color: "var(--accent-soft)" }}>
            No declaration is on file for {subjectName || "this archive"}. Record who agrees before her screen shows anything new.
          </p>
          <SmallButton onClick={() => setRecording(true)}>Record it</SmallButton>
        </div>
      )}

      {recording && (
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (basis && signer.trim() && agreed) record.mutate();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className={LABEL}>WHO AGREES</legend>
            {CONSENT_BASES.map((b) => (
              <label key={b} className="flex cursor-pointer items-start gap-3 rounded-[12px] px-4 py-3" style={BORDER}>
                <input type="radio" name="basis" className="mt-1" checked={basis === b} onChange={() => setBasis(b)} />
                <span>
                  <span className="block text-[15px]">{t.bases[b].label}</span>
                  <span className="block text-[13px] text-fg-faint">{t.bases[b].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            <span className={LABEL}>{t.signer.toUpperCase()}</span>
            <input className={FIELD} style={BORDER} value={signer} onChange={(e) => setSigner(e.target.value)} required />
          </label>
          <label className="flex items-start gap-3 text-[14px] leading-[1.6] text-fg-muted">
            <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>{basis === "self" ? t.agreeSelf : t.agree}</span>
          </label>
          {record.isError && (
            <p className="text-[14px]" style={{ color: "var(--destructive-soft)" }}>
              The declaration could not be recorded. Nothing has changed.
            </p>
          )}
          <div className="flex gap-2">
            <SmallButton type="submit" busy={record.isPending} disabled={!basis || !signer.trim() || !agreed}>
              Record
            </SmallButton>
            <SmallButton onClick={() => setRecording(false)}>Cancel</SmallButton>
          </div>
        </form>
      )}

      {printing && current && <ConsentSheet record={current} onClose={() => setPrinting(false)} />}
    </section>
  );
}

function SmallButton({
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
      className="rounded-full px-4 py-2 text-[13px] leading-none transition-colors hover:border-accent disabled:opacity-50"
      style={{ border: "1px solid var(--line)" }}
    >
      {busy ? "…" : children}
    </button>
  );
}

/**
 * The declaration on paper: for a kitchen-table signature, for a folder at
 * the care home, for a lawyer. Both languages on one sheet, because the
 * person signing and the person filing it are often not the same reader.
 */
function ConsentSheet({ record, onClose }: { record: ConsentRecord; onClose: () => void }) {
  const en = CONSENT_COPY.en;
  const nl = CONSENT_COPY.nl;
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-6 print:static print:overflow-visible print:p-0"
      style={{ background: "rgba(11,11,12,.92)" }}
      role="dialog"
      aria-label="Print the declaration"
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .consent-sheet, .consent-sheet * { visibility: visible; }
          .consent-sheet { position: absolute; inset: 0; background: white; }
        }
      `}</style>
      <div className="mx-auto flex max-w-[720px] flex-col gap-6">
        <div className="flex w-full items-center justify-between print:hidden">
          <p className="font-mono text-[11px] tracking-[0.16em] text-fg-faint">PRINT — ONE SHEET, TWO LANGUAGES</p>
          <div className="flex gap-2">
            <SmallButton onClick={() => window.print()}>Print</SmallButton>
            <SmallButton onClick={onClose}>Close</SmallButton>
          </div>
        </div>
        <div className="consent-sheet bg-white p-12 text-black" style={{ font: "400 14px/1.6 Roboto, Helvetica, Arial, sans-serif" }}>
          {[en, nl].map((t, i) => {
            const basis = t.bases[record.basis];
            const agree = record.basis === "self" ? t.agreeSelf : t.agree;
            return (
              <section key={i} style={{ paddingTop: i ? 28 : 0, borderTop: i ? "1px solid #ccc" : undefined, marginTop: i ? 28 : 0 }}>
                <p style={{ font: "700 11px/1 Archivo, sans-serif", letterSpacing: ".16em", textTransform: "uppercase", color: "#666" }}>
                  Recall · {t.printTitle}
                </p>
                <h1 style={{ font: "700 22px/1.2 Archivo, sans-serif", margin: "10px 0 14px" }}>
                  {record.subject_name}
                </h1>
                <p style={{ margin: "0 0 10px" }}>{t.lead}</p>
                <p style={{ margin: "0 0 4px" }}>
                  <strong>☑ {basis.label}</strong>
                </p>
                <p style={{ margin: "0 0 14px", color: "#444" }}>{basis.hint}</p>
                <p style={{ margin: "0 0 18px" }}>{agree}</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, marginTop: 24 }}>
                  <div>
                    <div style={{ borderBottom: "1px solid #000", height: 40 }} />
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#444" }}>
                      {t.signer}: {record.signer_name}
                      {record.signer_relationship ? ` (${record.signer_relationship})` : ""}
                    </p>
                  </div>
                  <div>
                    <div style={{ borderBottom: "1px solid #000", height: 40 }} />
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#444" }}>{t.signature}</p>
                  </div>
                  <div>
                    <div style={{ borderBottom: "1px solid #000", height: 40 }} />
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#444" }}>
                      {t.date}: {new Date(record.declared_at).toLocaleDateString(i ? "nl-BE" : "en-GB", { dateStyle: "long" })}
                    </p>
                  </div>
                </div>
                <p style={{ margin: "18px 0 0", fontSize: 11, color: "#666" }}>
                  {t.why} · v{record.text_version} · {SELLER.tradeName}, {SELLER.email}
                </p>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
