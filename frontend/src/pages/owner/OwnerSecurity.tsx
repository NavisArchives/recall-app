import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api } from "@/lib/api";

/**
 * The platform owner's own keys (security review 29 Sep 2026, access-5).
 *
 * The owner's password alone used to open every family's archive. Two things
 * now stand beside it, and this file is their half on the page:
 *
 *   · **Two-step sign-in** — an authenticator app's six-digit code, asked at
 *     sign-in once it is on. Enrolled in two steps (scan, then type a code
 *     back), so a half-finished set-up changes nothing.
 *   · **The step-up** — before an export or a print sheet, the password again
 *     (and the code). The backend answers `step_up_required` when it wants
 *     one; `StepUpDialog` asks, and the caller retries.
 *
 * English only, like the rest of the owner console.
 */

const INPUT =
  "h-[44px] w-full rounded-[10px] border bg-transparent px-3.5 text-sm outline-none focus:border-accent";
const INPUT_STYLE = { borderColor: "rgba(var(--ink),.22)" } as const;
const PRIMARY =
  "pressable rounded-full px-[22px] py-[11px] text-sm font-medium text-white disabled:opacity-40";

type CodedError = Error & { code?: string; status?: number };

/** True when the backend refused because it wants the password again first. */
export function needsStepUp(error: unknown): boolean {
  return (error as CodedError | null)?.code === "step_up_required";
}

/** Five wrong answers end the session server-side; the page follows it out. */
function followSignOut(error: unknown) {
  if ((error as CodedError | null)?.code === "signed_out") window.location.assign("/owner");
}

interface StepUpState {
  active: boolean;
  expires_at: string | null;
  code_required: boolean;
}

/** Whether a step-up is live on this session right now. */
export function readStepUp(): Promise<StepUpState> {
  return api.get<StepUpState>("/owner/step-up");
}

/**
 * "Confirm it is you" — the password, and the code when two-step sign-in is
 * on. Calls `onDone` once the backend has set its ten-minute cookie.
 */
export function StepUpDialog({
  reason,
  onDone,
  onCancel,
}: {
  reason: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const state = useQuery({
    queryKey: ["owner", "step-up"],
    queryFn: readStepUp,
    staleTime: 0,
  });
  const codeRequired = state.data?.code_required === true;

  const confirm = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; expires_at: string }>("/owner/step-up", {
        password,
        ...(codeRequired ? { code: code.replace(/\s+/g, "") } : {}),
      }),
    onSuccess: () => {
      setPassword("");
      setCode("");
      onDone();
    },
    onError: (err: Error) => {
      followSignOut(err);
      setError(err.message);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    confirm.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 print:hidden"
      style={{ background: "rgba(11,11,12,.72)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
    >
      <form onSubmit={submit} className="owner-card flex w-full max-w-[380px] flex-col gap-3 p-6">
        <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">CONFIRM IT IS YOU</p>
        <h2 id="step-up-title" className="text-lg font-semibold leading-snug">
          {reason}
        </h2>
        <p className="text-[13px] leading-[1.6] text-fg-muted">
          Your password{codeRequired ? " and a code from your authenticator app" : ""}. It stays
          confirmed for ten minutes on this sign-in.
        </p>

        <label className="sr-only" htmlFor="step-up-password">
          Password
        </label>
        <input
          id="step-up-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={INPUT}
          style={INPUT_STYLE}
        />
        {codeRequired && (
          <>
            <label className="sr-only" htmlFor="step-up-code">
              Six-digit code
            </label>
            <input
              id="step-up-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Six-digit code"
              className={`${INPUT} font-mono tracking-[0.2em]`}
              style={INPUT_STYLE}
            />
          </>
        )}

        <p
          role="alert"
          className="min-h-5 text-sm text-destructive-soft"
          style={{ visibility: error || state.isError ? "visible" : "hidden" }}
        >
          {error || (state.isError ? "Could not check your sign-in. Try again." : " ")}
        </p>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2.5 text-sm"
            style={{ border: "1px solid rgba(var(--ink),.16)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={confirm.isPending || state.isPending}
            className={PRIMARY}
            style={{ background: "var(--accent)" }}
          >
            {confirm.isPending ? "Checking…" : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface TotpStatus {
  enrolled: boolean;
  enrolled_at: string | null;
  pending: boolean;
}

/**
 * Two-step sign-in, on the owner's own Security tab.
 *
 * Off → "Set it up" (behind a step-up) → a QR code and the same secret as
 * text, shown once → a code typed back turns it on. On → a code turns it off,
 * because turning it off should take the phone, not only the session.
 */
export function TwoStepSignIn() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [askStepUp, setAskStepUp] = useState(false);

  const status = useQuery({
    queryKey: ["owner", "totp"],
    queryFn: () => api.get<TotpStatus>("/owner/totp"),
    staleTime: 0,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["owner", "totp"] });

  const start = useMutation({
    mutationFn: () => api.post<{ uri: string; secret: string }>("/owner/totp/setup", {}),
    onSuccess: (data) => {
      setError("");
      setCode("");
      setSetup(data);
    },
    onError: (err: Error) => {
      if (needsStepUp(err)) {
        setAskStepUp(true);
        return;
      }
      setError(err.message);
    },
  });

  const confirm = useMutation({
    mutationFn: () => api.post("/owner/totp/confirm", { code: code.replace(/\s+/g, "") }),
    onSuccess: () => {
      setSetup(null);
      setCode("");
      setError("");
      refresh();
    },
    onError: (err: Error) => {
      followSignOut(err);
      setError(err.message);
    },
  });

  const disable = useMutation({
    mutationFn: () => api.post("/owner/totp/disable", { code: code.replace(/\s+/g, "") }),
    onSuccess: () => {
      setCode("");
      setError("");
      refresh();
    },
    onError: (err: Error) => {
      followSignOut(err);
      setError(err.message);
    },
  });

  // The QR is drawn locally from the otpauth URI; the secret never leaves
  // this tab for any other service.
  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    let live = true;
    QRCode.toDataURL(setup.uri, { errorCorrectionLevel: "M", margin: 1, width: 200 })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [setup]);

  const enrolled = status.data?.enrolled === true;

  return (
    <section className="owner-card max-w-[640px] p-5" aria-labelledby="two-step-title">
      <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">SECURITY</p>
      <h2 id="two-step-title" className="mt-1.5 text-[20px] font-semibold leading-tight">
        Two-step sign-in
      </h2>
      <p className="mt-2 text-[13px] leading-[1.6] text-fg-muted">
        A six-digit code from an authenticator app, asked for when you sign in to this console and
        before an archive or a print sheet leaves the platform. Your password alone then opens
        nothing.
      </p>

      {status.isPending && <p className="mt-4 text-sm text-fg-muted">Reading…</p>}
      {status.isError && (
        <p role="alert" className="mt-4 text-sm text-destructive-soft">
          Whether two-step sign-in is on could not be read.
        </p>
      )}

      {status.isSuccess && enrolled && (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            disable.mutate();
          }}
        >
          <p className="text-sm">
            <span className="font-medium">On</span>
            {status.data.enrolled_at && (
              <span className="text-fg-muted">
                {" "}
                since{" "}
                {new Date(status.data.enrolled_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            )}
            .
          </p>
          <label className="text-[13px] text-fg-muted" htmlFor="totp-disable-code">
            To turn it off, type a current code from the app.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="totp-disable-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Six-digit code"
              className={`${INPUT} max-w-[200px] font-mono tracking-[0.2em]`}
              style={INPUT_STYLE}
            />
            <button
              type="submit"
              disabled={disable.isPending}
              className="rounded-full px-4 py-2.5 text-sm disabled:opacity-40"
              style={{ border: "1px solid rgba(var(--ink),.22)" }}
            >
              {disable.isPending ? "Turning off…" : "Turn off two-step sign-in"}
            </button>
          </div>
        </form>
      )}

      {status.isSuccess && !enrolled && !setup && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-medium">Off.</span>{" "}
            <span className="text-fg-muted">
              {status.data.pending ? "A set-up was started and not finished." : "Only your password protects this console."}
            </span>
          </p>
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => {
              setError("");
              start.mutate();
            }}
            className={`${PRIMARY} self-start`}
            style={{ background: "var(--accent)" }}
          >
            {start.isPending ? "Preparing…" : status.data.pending ? "Start again" : "Set up two-step sign-in"}
          </button>
        </div>
      )}

      {setup && (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            confirm.mutate();
          }}
        >
          <p className="text-[13px] leading-[1.6] text-fg-muted">
            1. Scan this with your authenticator app, or type the key into it by hand. It is shown
            once — keep it nowhere else.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-[200px] w-[200px] items-center justify-center rounded-[10px] bg-white">
              {qr ? (
                <img src={qr} width={200} height={200} alt="QR code for your authenticator app" />
              ) : (
                <span className="text-xs text-black/60">Drawing…</span>
              )}
            </div>
            <p className="min-w-0 flex-1 break-all font-mono text-[13px] tracking-[0.12em]" aria-label="Setup key">
              {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
            </p>
          </div>
          <label className="text-[13px] leading-[1.6] text-fg-muted" htmlFor="totp-confirm-code">
            2. Type the code the app now shows.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="totp-confirm-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Six-digit code"
              className={`${INPUT} max-w-[200px] font-mono tracking-[0.2em]`}
              style={INPUT_STYLE}
            />
            <button type="submit" disabled={confirm.isPending} className={PRIMARY} style={{ background: "var(--accent)" }}>
              {confirm.isPending ? "Checking…" : "Turn it on"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode("");
                setError("");
                refresh();
              }}
              className="rounded-full px-4 py-2.5 text-sm"
              style={{ border: "1px solid rgba(var(--ink),.16)" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <p
        role="alert"
        className="mt-3 min-h-5 text-sm text-destructive-soft"
        style={{ visibility: error ? "visible" : "hidden" }}
      >
        {error || " "}
      </p>

      {askStepUp && (
        <StepUpDialog
          reason="Setting up two-step sign-in"
          onCancel={() => setAskStepUp(false)}
          onDone={() => {
            setAskStepUp(false);
            start.mutate();
          }}
        />
      )}
    </section>
  );
}
