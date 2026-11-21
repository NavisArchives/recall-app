import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Select } from "@/components/admin/Select";
import { OnboardingChrome, PrimaryButton, CodeBoxes, LABEL, INPUT, INPUT_BORDER, SecondaryButton } from "@/components/onboarding/bits";
import { useLang, type Lang } from "@/lib/publicLang";
import { CONSENT_BASES, CONSENT_COPY, type ConsentBasis } from "@/lib/consent";

/**
 * Sign up, frames 11a–11c. One toggle decides the path: the person the
 * archive is about, or the person setting it up for them. Either way the
 * signer owns the archive and manages it — the first contributor is the
 * admin. The archive is created the moment its person is known; inviting
 * the others is the last step and can wait.
 */

type About = "me" | "someone";

/*
 * `subject` is gone (M46).
 *
 * It existed to ask the archive's person about themselves after the fact,
 * which is what made the first screen lurch: "about me" showed four fields
 * and "for someone" showed two, because two of them had been deferred to
 * here. Pulling them forward is what actually removes the jump — and once
 * they are forward this step had one question left, so it is folded into
 * the PIN step, where the signer's own profile is being made anyway, rather
 * than left as a screen with a single field on it.
 */
type Step = "who" | "verify" | "pin" | "invites";

// "She is my Mother" describes the subject; what the shelf shows under the
// signer's own name is the other direction of the same fact.
const RELATION_OPTIONS: [string, string][] = [
  ["Mother", "Child"],
  ["Father", "Child"],
  ["Grandmother", "Grandchild"],
  ["Grandfather", "Grandchild"],
  ["Wife", "Spouse"],
  ["Husband", "Spouse"],
  ["Partner", "Partner"],
  ["Sister", "Sibling"],
  ["Brother", "Sibling"],
  ["Friend", "Friend"],
  ["Someone I care for", "Caregiver"],
];

const INVITE_RELATIONS = [
  "Daughter",
  "Son",
  "Grandchild",
  "Sister",
  "Brother",
  "Wife",
  "Husband",
  "Partner",
  "Friend",
  "Neighbour",
  "Caregiver",
  "Nurse",
];

/*
 * When the mail limit held the code back (429 `too_many_sent`). Said in the
 * reader's language, because this page must not move on to "enter the code"
 * for a code that was never sent — somebody else may have spent this
 * address's hourly budget on purpose.
 */
const TOO_MANY_SENT: Record<Lang, string> = {
  fr: "Trop de codes ont été envoyés à cette adresse. Attendez une heure, puis réessayez.",
  nl: "Er zijn te veel codes naar dit adres gestuurd. Wacht een uur en probeer het opnieuw.",
  en: "Too many codes have been sent to this address. Wait an hour and try again.",
};

interface InviteRow {
  name: string;
  email: string;
  relationship: string;
}

interface InviteResult {
  email: string;
  sent: boolean;
  code?: string;
  error?: string;
}

export function SignUpPage() {
  const navigate = useNavigate();
  // `location` is already this page's residence field; the router's is its own.
  const arrivedFrom = useLocation();
  const { refresh } = useAuth();

  /*
   * The founding invitation this signup is spending (M44).
   *
   * Carried in router state from `/invite/<token>`, and mirrored into
   * sessionStorage so a reload part-way through the form does not throw
   * somebody back to the email they opened three steps ago. It is a
   * single-use token, not a credential for anything else, and it dies with
   * the tab.
   *
   * Whether it is real is not decided here or even by the sign-up route: it
   * is spent inside the same transaction that creates the family, so two
   * browsers holding one link cannot both win.
   */
  const founderToken =
    (arrivedFrom.state as { founderToken?: string } | null)?.founderToken ??
    sessionStorage.getItem("recall:founder") ??
    "";

  useEffect(() => {
    if (founderToken) sessionStorage.setItem("recall:founder", founderToken);
  }, [founderToken]);

  const [step, setStep] = useState<Step>("who");
  const [about, setAbout] = useState<About>("me");
  const [yourName, setYourName] = useState("");
  const [email, setEmail] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [location, setLocation] = useState("");
  const [relationship, setRelationship] = useState(RELATION_OPTIONS[0][0]);

  const [invites, setInvites] = useState<InviteRow[]>([
    { name: "", email: "", relationship: INVITE_RELATIONS[0] },
  ]);
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [checking, setChecking] = useState(false);
  // The proof that *this* browser answered the code. Held in memory only: it
  // is spent once, by the sign-up call, and never written anywhere.
  const [receipt, setReceipt] = useState("");
  const [pin, setPin] = useState("");
  // Her word (054): who agrees to her life on her screen, and that the
  // signer has read what that means. Asked on the first screen, sent with
  // the sign-up call, recorded with the archive.
  const [consentBasis, setConsentBasis] = useState<ConsentBasis | null>(null);
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [lang] = useLang();

  /*
   * One name field, one meaning: `subjectName` is always the person the
   * archive is about, in both branches. When the signer is also the subject
   * the same slot is simply theirs, and `signerName` says so — which is why
   * toggling loses nothing typed. The signer's own name is asked separately
   * only in the branch where it is a different person.
   */
  const signerName = about === "me" ? subjectName : yourName;
  const subjectFirst = subjectName.trim().split(/\s+/)[0] || "";

  // The founder proves the address before anything is created: a code goes
  // to the inbox, and only the inbox knows it.
  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      // The address alone. The code's mail greets nobody by name: nothing
      // typed here is proven until the code comes back (input-2).
      await api.post("/onboarding/verify-email/send", { email: email.trim() });
      setVerifyCode("");
      setStep("verify");
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "too_many_sent") {
        setError(TOO_MANY_SENT[lang]);
        return;
      }
      setError(err instanceof Error ? err.message : "The code could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(code: string) {
    setChecking(true);
    setError(null);
    try {
      const proof = await api.post<{ receipt: string }>("/onboarding/verify-email/check", {
        email: email.trim(),
        code,
      });
      setReceipt(proof.receipt);
      setStep("pin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "This code is not valid any more.");
      setVerifyCode("");
    } finally {
      setChecking(false);
    }
  }

  async function createArchive() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/onboarding/sign-up", {
        about,
        founder_token: founderToken,
        your_name: signerName.trim(),
        email: email.trim(),
        receipt,
        pin,
        subject: {
          full_name: subjectName.trim(),
          birth_date: birthDate || null,
          location: location.trim() || null,
        },
        relationship:
          about === "someone"
            ? (RELATION_OPTIONS.find(([label]) => label === relationship)?.[1] ?? null)
            : null,
        consent: {
          basis: about === "me" ? "self" : consentBasis,
          signer_name: signerName.trim(),
          lang,
        },
      });
      await refresh();
      setStep("invites");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The archive could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvites() {
    const rows = invites.filter((r) => r.name.trim() || r.email.trim());
    if (rows.length === 0) {
      navigate("/admin", { replace: true });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ results: InviteResult[] }>("/onboarding/invites", {
        invites: rows,
      });
      if (res.results.every((r) => r.sent)) {
        navigate("/admin", { replace: true });
      } else {
        // Some codes did not travel by mail; show them once so the admin can
        // pass them on in person, then continue.
        setResults(res.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitations could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const stepLabel =
    step === "who" || step === "verify"
      ? undefined
      : step === "pin"
        ? "STEP 2 OF 3 · YOUR PROFILE"
        : "STEP 3 OF 3 · CONTRIBUTORS";

  /*
   * No invitation, no form (M44).
   *
   * The route refuses without one anyway — this is so somebody who bookmarked
   * `/signup` is told why on the first screen, rather than filling everything
   * in and being refused in a way that cannot explain itself. The refusal is
   * deliberately shaped like the front door rather than like an error: this
   * is not a mistake they made.
   */
  if (!founderToken) {
    return (
      <OnboardingChrome>
        <div className="w-[460px] max-w-full text-center">
          <h1 className="text-[28px] font-bold leading-[1.2] tracking-[-0.01em]">
            Recall is invitation only
          </h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-fg-muted">
            Archives are started from an invitation, so that every family arrives with someone who
            knows what this is for.
          </p>
          <button
            type="button"
            onClick={() => navigate("/welcome")}
            className="mt-7 rounded-[12px] bg-accent px-8 py-[15px] text-[15px] font-medium leading-none text-accent-foreground transition-opacity hover:opacity-90"
          >
            Ask for an invitation
          </button>
        </div>
      </OnboardingChrome>
    );
  }

  return (
    <OnboardingChrome step={stepLabel}>
      {step === "who" && (
        <div className="flex w-[520px] flex-col gap-7">
          <div className="text-center">
            <h1 className="text-[34px] font-bold leading-[1.2] tracking-[-0.01em]">
              Welcome to Recall
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-fg-muted">
              Every archive is built around one person.
            </p>
          </div>

          <div
            className="flex gap-1 rounded-xl p-1"
            style={{ background: "rgba(var(--ink),.06)", border: "1px solid rgba(var(--ink),.12)" }}
          >
            {(
              [
                ["me", "This archive is about me"],
                ["someone", "I'm setting it up for someone"],
              ] as [About, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAbout(key)}
                className="flex-1 rounded-[9px] px-2.5 py-3.5 text-center text-sm transition-colors"
                style={
                  about === key
                    ? { background: "var(--accent)", color: "#fff", fontWeight: 500 }
                    : { color: "var(--fg-muted)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="flex flex-col gap-[18px]"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            {/*
              The same four fields in both branches, in the same order, with
              the same labels (M46).

              Choosing a branch changes only *whose* details these are, and
              the line under the heading already says which. Because both
              branches write to the same state, toggling by mistake costs
              nothing typed.
            */}
            <label>
              <span className={LABEL}>FULL NAME</span>
              <input
                autoFocus
                required
                maxLength={120}
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                className={INPUT}
                style={INPUT_BORDER}
              />
              {/* Reserved to one line, so the words may change but the
                  geometry may not. */}
              <span className="mt-1.5 block h-4 text-xs leading-4 text-fg-faint">
                {about === "me" ? "This archive is about you." : "The person this archive is for."}
              </span>
            </label>

            <label>
              <span className={LABEL}>YOUR EMAIL</span>
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
                style={INPUT_BORDER}
              />
            </label>

            <div className="flex gap-[18px]">
              <label className="w-[180px] flex-none">
                <span className={LABEL}>BIRTH DATE</span>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className={INPUT}
                  style={INPUT_BORDER}
                />
              </label>
              <label className="flex-1">
                <span className={LABEL}>LOCATION</span>
                <input
                  maxLength={200}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Brussels, Belgium"
                  className={INPUT}
                  style={INPUT_BORDER}
                />
              </label>
            </div>

            {/*
              Her word (054). Showing a person's life on her screen rests on
              her explicit agreement, or on that of whoever may lawfully
              decide for her. In the "about me" branch that is one sentence
              to tick; in the "for someone" branch it is a choice of three.
              Nothing is created without it — the backend refuses too.
            */}
            <fieldset
              className="flex flex-col gap-2.5 rounded-[12px] p-4"
              style={{ border: "1px solid rgba(var(--ink),.14)", background: "rgba(var(--ink),.03)" }}
            >
              <legend className={`${LABEL} px-1`}>{CONSENT_COPY[lang].title.toUpperCase()}</legend>
              {about === "someone" && (
                <>
                  <p className="text-[13px] leading-[1.55] text-fg-muted">{CONSENT_COPY[lang].lead}</p>
                  {CONSENT_BASES.map((b) => (
                    <label key={b} className="flex cursor-pointer items-start gap-3 text-left">
                      <input
                        type="radio"
                        name="consent-basis"
                        className="mt-1"
                        checked={consentBasis === b}
                        onChange={() => setConsentBasis(b)}
                      />
                      <span>
                        <span className="block text-[14px]">{CONSENT_COPY[lang].bases[b].label}</span>
                        <span className="block text-[12px] text-fg-faint">{CONSENT_COPY[lang].bases[b].hint}</span>
                      </span>
                    </label>
                  ))}
                </>
              )}
              <label className="flex cursor-pointer items-start gap-3 text-left text-[13px] leading-[1.55] text-fg-muted">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consentAgreed}
                  onChange={(e) => setConsentAgreed(e.target.checked)}
                />
                <span>
                  {about === "me" || consentBasis === "self"
                    ? CONSENT_COPY[lang].agreeSelf
                    : CONSENT_COPY[lang].agree}{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
                    Privacy
                  </a>
                </span>
              </label>
            </fieldset>

            <p
              role="alert"
              className="h-5 text-sm text-destructive-soft"
              style={{ visibility: error ? "visible" : "hidden" }}
            >
              {error || " "}
            </p>

            <div className="flex flex-col gap-3.5">
              <PrimaryButton
                type="submit"
                disabled={busy || !consentAgreed || (about === "someone" && !consentBasis)}
              >
                {busy ? "Sending code…" : "Continue"}
              </PrimaryButton>
              {/*
                One sentence for both branches. It used to end differently
                depending on the toggle, and because this container is
                vertically centred, a line that wrapped in one branch and not
                the other pushed the heading up — the switch with it. Both
                branches now go to the same next step, so there is nothing
                left to say differently.
              */}
              <p className="text-center text-xs leading-[1.5] text-fg-faint">
                We'll email you a code to confirm the address, then ask you to choose an admin PIN.
              </p>
            </div>
          </form>
        </div>
      )}

      {step === "verify" && (
        <div className="flex w-[560px] flex-col items-center gap-8 text-center">
          <div>
            <h1 className="text-[34px] font-bold leading-[1.2] tracking-[-0.01em]">
              Check your email
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.5] text-fg-muted">
              We sent a 6-character code to {email.trim()}.
            </p>
          </div>

          <CodeBoxes
            length={6}
            value={verifyCode}
            onValue={(next) => {
              setVerifyCode(next);
              if (next.length === 6 && !checking) void checkCode(next);
            }}
          />

          <p
            role="alert"
            className="h-5 text-sm"
            style={{
              visibility: error || checking || busy ? "visible" : "hidden",
              color: error ? "var(--destructive-soft)" : "var(--fg-faint)",
            }}
          >
            {checking || busy ? "Checking…" : error || " "}
          </p>

          {/* Two real controls. They were bare words with an arrow typed in
              front of one of them, which read as unfinished next to the
              primary button above. */}
          <div className="flex flex-wrap gap-3">
            <SecondaryButton onClick={() => setStep("who")}>Use a different address</SecondaryButton>
            <SecondaryButton onClick={() => void sendCode()}>Resend the code</SecondaryButton>
          </div>
        </div>
      )}

      {/*
        The founder's PIN.

        Passwordless is for the subject alone — the app exists because she
        cannot reliably recall things. An administrator has no such excuse,
        and their profile can delete every memory in the archive. On the
        family screen that stays signed in so her display is never
        interrupted, this PIN is what stands between a visitor and admin.
      */}
      {step === "pin" && (
        <div className="flex w-[560px] flex-col items-center gap-8 text-center">
          <div>
            <h1 className="text-[34px] font-bold leading-[1.2] tracking-[-0.01em]">
              {about === "me" ? "Choose your admin PIN" : "And you"}
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.5] text-fg-muted">
              {about === "me"
                ? "Six digits, entered when you manage the archive from the family screen. Your own display profile stays open without one."
                : `You'll manage ${subjectFirst || "the"}'s archive, and you get a profile on the shelf like everybody else.`}
            </p>
          </div>

          {/*
            The signer's own details, in the branch where they are a
            different person from the subject (M46).

            The mission left one question open — where the signer's name is
            asked once FULL NAME on the first screen belongs to the subject —
            and named this as the fallback if it had to be answered before
            the owner did: fold it in here, where their profile is being made
            anyway. The alternative, a fifth field in one branch only, would
            have rebuilt the exact jump the mission exists to remove.
          */}
          {about === "someone" && (
            <div className="flex w-full flex-col gap-[18px] text-left">
              <label>
                <span className={LABEL}>YOUR FULL NAME</span>
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={yourName}
                  onChange={(e) => setYourName(e.target.value)}
                  className={INPUT}
                  style={INPUT_BORDER}
                />
              </label>

              <div>
                <span className={LABEL}>
                  {subjectFirst ? `${subjectFirst.toUpperCase()} IS MY` : "THEY ARE MY"}
                </span>
                {/* allowOther: a neighbour, a carer, a friend of forty years —
                    the display already prints whatever it is given. */}
                <Select
                  value={relationship}
                  options={RELATION_OPTIONS.map(([label]) => label)}
                  onChange={setRelationship}
                  allowOther
                />
              </div>
            </div>
          )}

          <CodeBoxes
            length={6}
            value={pin}
            onValue={setPin}
            masked
            digitsOnly
            boxWidth={56}
            boxHeight={70}
          />

          <p
            role="alert"
            className="h-5 text-sm"
            style={{
              visibility: error || busy ? "visible" : "hidden",
              color: error ? "var(--destructive-soft)" : "var(--fg-faint)",
            }}
          >
            {busy ? "Creating…" : error || " "}
          </p>

          <div className="w-[320px]">
            <PrimaryButton
              type="button"
              disabled={busy || pin.length !== 6 || !signerName.trim()}
              onClick={() => void createArchive()}
            >
              {busy ? "Creating…" : `Create ${subjectFirst || "the"}'s archive`}
            </PrimaryButton>
          </div>

          <SecondaryButton onClick={() => setStep("verify")}>Back</SecondaryButton>
        </div>
      )}


      {step === "invites" && !results && (
        <div className="flex w-[760px] flex-col gap-7">
          <div className="text-center">
            <h1 className="text-[34px] font-bold leading-[1.2] tracking-[-0.01em]">
              Who will help build {subjectFirst}'s archive?
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-fg-muted">
              They'll get an email with a personal code, and choose a PIN when they arrive.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div
              className="grid gap-3 px-[18px] font-mono text-[10px] tracking-[0.16em] text-fg-faint"
              style={{ gridTemplateColumns: "1fr 1.3fr 150px" }}
            >
              <span>NAME</span>
              <span>EMAIL</span>
              <span>THEY ARE {subjectFirst.toUpperCase()}'S</span>
            </div>

            {invites.map((row, i) => (
              <div
                key={i}
                className="grid h-[56px] items-center gap-3 rounded-xl px-[18px]"
                style={{
                  gridTemplateColumns: "1fr 1.3fr 150px",
                  border: `1px ${row.name || row.email ? "solid rgba(var(--ink),.22)" : "dashed rgba(var(--ink),.25)"}`,
                }}
              >
                <input
                  value={row.name}
                  maxLength={120}
                  placeholder="Full name"
                  onChange={(e) =>
                    setInvites((list) =>
                      list.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))
                    )
                  }
                  className="bg-transparent text-[15px] outline-none placeholder:text-white/25"
                />
                <input
                  type="email"
                  maxLength={254}
                  value={row.email}
                  placeholder="email@example.com"
                  onChange={(e) =>
                    setInvites((list) =>
                      list.map((r, j) => (j === i ? { ...r, email: e.target.value } : r))
                    )
                  }
                  className="bg-transparent text-[15px] outline-none placeholder:text-white/25"
                />
                <div className="-mt-2 self-center">
                  <Select
                    value={row.relationship}
                    options={INVITE_RELATIONS}
                    onChange={(rel) =>
                      setInvites((list) =>
                        list.map((r, j) => (j === i ? { ...r, relationship: rel } : r))
                      )
                    }
                    allowOther
                  />
                </div>
              </div>
            ))}

            <div>
              <SecondaryButton
                onClick={() =>
                  setInvites((list) => [
                    ...list,
                    { name: "", email: "", relationship: INVITE_RELATIONS[0] },
                  ])
                }
              >
                + Add another person
              </SecondaryButton>
            </div>
          </div>

          <p
            role="alert"
            className="h-5 text-center text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>

          <div className="flex items-center gap-5">
            <div className="flex-1">
              <PrimaryButton onClick={() => void sendInvites()} disabled={busy}>
                {busy
                  ? "Sending…"
                  : (() => {
                      const n = invites.filter((r) => r.name.trim() && r.email.trim()).length;
                      return n > 0 ? `Send ${n} invite${n === 1 ? "" : "s"}` : "Send invites";
                    })()}
              </PrimaryButton>
            </div>
            <SecondaryButton onClick={() => navigate("/admin", { replace: true })}>
              Skip for now
            </SecondaryButton>
          </div>
        </div>
      )}

      {step === "invites" && results && (
        <div className="flex w-[560px] flex-col gap-6">
          <div className="text-center">
            <h1 className="text-[28px] font-bold leading-[1.2]">Some invitations need a hand</h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-fg-muted">
              These codes could not be emailed. Pass them on yourself — each works once.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            {results.map((r) => (
              <div
                key={r.email}
                className="flex items-center justify-between rounded-xl px-5 py-3.5"
                style={{ border: "1px solid rgba(var(--ink),.16)" }}
              >
                <span className="text-sm">{r.email}</span>
                {r.sent ? (
                  <span className="text-sm text-fg-faint">Sent ✓</span>
                ) : r.code ? (
                  <span className="font-mono text-lg tracking-[0.2em]">{r.code}</span>
                ) : (
                  <span className="text-sm text-destructive-soft">{r.error}</span>
                )}
              </div>
            ))}
          </div>
          <PrimaryButton onClick={() => navigate("/admin", { replace: true })}>
            Open the archive
          </PrimaryButton>
        </div>
      )}
    </OnboardingChrome>
  );
}
