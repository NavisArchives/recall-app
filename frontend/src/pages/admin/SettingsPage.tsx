import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LockedNotice } from "@/components/admin/LockedNotice";
import { ConsentPanel } from "@/components/admin/ConsentPanel";
import { PageFrame, PageHeader } from "@/components/admin/kit";
import { useNavigate } from "react-router-dom";
import { useAuth, isSubjectDevice } from "@/context/AuthContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import type { SubjectProfile } from "@/types";
import { IMAGE_ACCEPT } from "@/lib/mediaTypes";
import { useDisplay } from "@/lib/DisplayContext";
import {
  THEME_SWATCH,
  WORKSPACE_THEMES,
  cacheWorkspaceTheme,
  cachedWorkspaceTheme,
  isWorkspaceTheme,
  type WorkspaceTheme,
} from "@/lib/workspaceTheme";

const FIELD =
  "mt-1.5 w-full rounded-[12px] bg-[rgba(var(--ink),0.04)] px-4 py-2.5 text-[15px] outline-none focus:border-accent";
const LABEL = "font-mono text-[11px] tracking-[0.16em] text-fg-muted";
const BORDER = { border: "1px solid var(--input)" };
/* The workspace's panel: every section is a card, not a slab between
   hairlines — the same surface Contributors and Devices stand on. */
const PANEL = "mt-4 rounded-[18px] p-6";
const PANEL_STYLE = { border: "1px solid var(--line-soft)", background: "rgba(var(--ink),.03)" };

/**
 * Everything about the installation itself: who the archive is for, and how
 * it reaches the family by mail. The subject's profile is edited here rather
 * than on her own page, so there is one place where settings live.
 */
export function SettingsPage() {
  /*
   * Whose archive this is. "Margaret" was written into these sentences when
   * there was only ever one family; every other family read somebody else's
   * mother's name on their own screens. Falls back to a neutral word rather
   * than a wrong one.
   */
  const { subjectName } = useDisplay();
  const who = subjectName ?? "she";

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin, signOut, profile, refresh: refreshSession } = useAuth();

  const [form, setForm] = useState({
    display_name: "",
    full_name: "",
    birth_date: "",
    residence: "",
    delivery_address: "",
    note: "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailResult, setMailResult] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [workspaceTheme, setWorkspaceThemeState] = useState<WorkspaceTheme>(
    () => (isWorkspaceTheme(profile?.workspace_theme) ? profile.workspace_theme : cachedWorkspaceTheme())
  );
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const loaded = useRef(false);

  /*
    Applies at once and then saves. The optimistic paint is what makes the
    swatches feel like a colour picker rather than a form; if the save fails
    the colour goes back to what the row still says, and the row is the
    record — nothing is left claiming a colour the server never took.
  */
  async function chooseWorkspaceTheme(next: WorkspaceTheme) {
    if (!profile?.id || next === workspaceTheme) return;
    const previous = workspaceTheme;
    setWorkspaceThemeState(next);
    cacheWorkspaceTheme(next);
    setSavingTheme(true);
    setThemeError(null);
    try {
      await api.patch(`/people/${profile.id}/theme`, { workspace_theme: next });
      await refreshSession();
    } catch (err) {
      setWorkspaceThemeState(previous);
      cacheWorkspaceTheme(previous);
      setThemeError(err instanceof Error ? err.message : "That colour could not be saved.");
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleInstallationSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  const {
    data: subject,
    isPending: subjectPending,
    isError: subjectFailed,
    refetch: refetchSubject,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });

  const { data: mail, isError: mailFailed } = useQuery({
    queryKey: ["settings-email"],
    queryFn: () => api.get<{ from: string | null; configured: boolean }>("/settings/email"),
  });

  useEffect(() => {
    if (subject && !loaded.current) {
      loaded.current = true;
      setForm({
        display_name: subject.display_name,
        full_name: subject.full_name ?? "",
        birth_date: subject.birth_date ?? "",
        residence: subject.residence ?? "",
        delivery_address: subject.delivery_address ?? "",
        note: subject.note ?? "",
      });
    }
  }, [subject]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.display_name.trim()) {
      setError("The display name cannot be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // The photo first, so a photo failure never half-saves the text.
      if (photo) {
        const body = new FormData();
        body.set("photo", photo);
        await api.post("/settings/photo", body);
        setPhoto(null);
      }
      await api.put("/settings", form);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["activity"] });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The changes could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setMailResult("Sending…");
    try {
      const result = await api.post<{ to: string; success: boolean; reason?: string }>(
        "/people/test-email"
      );
      setMailResult(
        result.success ? `Sent to ${result.to}.` : (result.reason ?? "The email was not sent.")
      );
    } catch (err) {
      setMailResult(err instanceof Error ? err.message : "The email was not sent.");
    }
  }

  /*
    No form until her profile has been read (M203, third fork).

    The same defect as `ContributorEditPage` and `MyInfoPage`, and this one
    writes with `PUT /settings` — a whole-object replace, not a patch. A
    failed read left five empty enabled fields and an enabled Save, so one
    press would have replaced the subject's display name, full name, birth
    date, where she lives and the note for contributors with nothing.

    That is Margaret's own profile: the name her display greets her by and
    the sentence her family reads before they add anything. Of the three
    forks it is the smallest form and by some distance the worst thing to
    lose.
  */
  if (subjectPending || subjectFailed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[17px]">
          {subjectPending ? "Opening…" : "This profile could not be loaded"}
        </p>
        {subjectFailed && (
          <>
            <p className="max-w-[400px] text-[13px] leading-[1.6] text-fg-muted">
              Saving now would replace the profile with an empty one — the name her screen greets
              her by among it. Nothing has been changed.
            </p>
            <button
              type="button"
              onClick={() => void refetchSubject()}
              className="pressable rounded-full px-5 py-2.5 text-[13px]"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              Try again
            </button>
          </>
        )}
      </div>
    );
  }

  const currentPhoto = preview ?? subject?.photo_url ?? null;

  return (
    /*
      Settings joins the shared frame (M129).

      It was the one page M114 never took in: its own wrapper, its own 26px
      heading, its own top padding — so moving between it and any other page
      moved the title. It takes the 44px title standard now, and the compact
      start line, because the rule that picks the line asks one question —
      does this page carry a control row? Settings does not; its controls
      live inside its sections. ("Roster" names the class, and the graduation
      clause is about collections, so the word is a stretch here — flagged
      rather than papered over with a third redundant value.)
    */
    <PageFrame
      type="roster"
      scroll
      header={<PageHeader title="Settings" subtitle={`Who this archive is for, and how it reaches the family`} />}
    >
      {/*
        One measure across the management pages (owner, 21 Aug). Settings was
        max-w-4xl while My Info ran the full window, so two pages that do the
        same kind of work — a portrait, some fields, a save — did not line up
        with each other. Both are 980px now, and every section here is
        separated by the same hairline the contributor profile uses rather
        than a hand-rolled border at its own alpha.
      */}
      <div className="max-w-[980px]">

      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>SUBJECT PROFILE</p>

        {!isAdmin && (
          <div className="mt-4">
            <LockedNotice what="You can read everything here. Changing the family's details is an administrator's to do." />
          </div>
        )}

        {/*
          A helper reads this as content, not as a form with its controls
          switched off — greyed inputs say "broken" where the truth is
          "somebody else's" (the same reasoning as the locked shelf, M49).
        */}
        {!isAdmin ? (
          <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
            <div className="flex flex-none flex-col items-center gap-3">
              {currentPhoto ? (
                <img src={currentPhoto} alt="" className="h-32 w-32 rounded-full object-cover" />
              ) : (
                <InitialsAvatar name={form.full_name || form.display_name || "?"} size={128} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["DISPLAY NAME", form.display_name],
                  ["FULL NAME", form.full_name],
                  [
                    "BORN",
                    form.birth_date
                      ? new Date(form.birth_date).toLocaleDateString("en-GB", { dateStyle: "long" })
                      : "",
                  ],
                  ["LIVING PLACE", form.residence],
                  ["POSTCARDS GO TO", form.delivery_address],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className={LABEL}>{label}</span>
                    <p className="mt-1.5 text-[15px]" style={{ color: value ? "var(--fg)" : "var(--fg-faint)" }}>
                      {value || "—"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <span className={LABEL}>NOTES FOR CONTRIBUTORS</span>
                <p
                  className="mt-1.5 text-[15px] leading-[1.6]"
                  style={{ color: form.note ? "var(--fg)" : "var(--fg-faint)" }}
                >
                  {form.note || "Nothing noted yet."}
                </p>
              </div>
            </div>
          </div>
        ) : (
        <form onSubmit={save} className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
          <div className="flex flex-none flex-col items-center gap-3">
            {currentPhoto ? (
              <img src={currentPhoto} alt="" className="h-32 w-32 rounded-full object-cover" />
            ) : (
              <InitialsAvatar name={form.full_name || form.display_name || "?"} size={128} />
            )}
            <label
              className="cursor-pointer rounded-full px-4 py-2 text-sm transition-colors hover:border-accent"
              style={{ border: "1px solid var(--line)" }}
            >
              Change photo
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className={LABEL}>DISPLAY NAME</span>
                <input className={FIELD} style={BORDER} value={form.display_name} onChange={set("display_name")} required />
              </label>
              <label>
                <span className={LABEL}>FULL NAME</span>
                <input className={FIELD} style={BORDER} value={form.full_name} onChange={set("full_name")} />
              </label>
              <label>
                <span className={LABEL}>BORN</span>
                <input
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  className={FIELD}
                  style={BORDER}
                  value={form.birth_date}
                  onChange={set("birth_date")}
                />
              </label>
              <label>
                <span className={LABEL}>LIVING PLACE</span>
                <input className={FIELD} style={BORDER} value={form.residence} onChange={set("residence")} />
              </label>
            </div>

            {/*
              The POSTAL address (053) — deliberately its own field, not the
              living place. "Bruges" answers where she lives; an envelope
              needs street, number, postcode, exactly as it should be
              printed. Multi-line, because that is what an address is.
            */}
            <label className="mt-4 block">
              <span className={LABEL}>POSTCARDS GO TO — POSTAL ADDRESS</span>
              <textarea
                rows={3}
                className={`${FIELD} resize-none`}
                style={BORDER}
                placeholder={"Full name\nStreet and number\nPostcode and town"}
                value={form.delivery_address}
                onChange={set("delivery_address")}
              />
              <span className="mt-1 block text-[12px] text-fg-faint">
                As it should appear on the envelope. Change it once and every card follows.
              </span>
            </label>

            <label className="mt-4 block">
              <span className={LABEL}>NOTES FOR CONTRIBUTORS</span>
              <textarea
                rows={3}
                className={`${FIELD} resize-none`}
                style={BORDER}
                value={form.note}
                onChange={set("note")}
              />
            </label>

            {/* One reserved line, so the button never moves. */}
            <p
              className="mt-3 h-5 text-sm"
              style={{
                visibility: error || message ? "visible" : "hidden",
                color: error ? "var(--destructive-soft)" : "oklch(0.8 0.13 150)",
              }}
              role={error ? "alert" : "status"}
            >
              {error || message || " "}
            </p>

            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] rounded-full px-7 py-2.5 text-[14px] font-medium disabled:opacity-50 sm:min-h-0"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        )}
      </section>

      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>EMAIL</p>
        <p className="mt-2.5 text-[15px]">
          {mail?.configured ? (
            <>
              Sent from <span className="font-mono text-sm">{mail.from}</span>
            </>
          ) : (
            <span className="text-fg-muted">
              {/* M182: not knowing is not the same as none configured — this
                  line changes what an admin believes about how PINs reach
                  people, so it must not be guessed at. */}
              {mailFailed
                ? "The mail setting could not be loaded."
                : "No mail service is configured — PINs are shown on screen only."}
            </span>
          )}
        </p>

        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={sendTest}
            disabled={!mail?.configured}
            className="min-h-[44px] rounded-full px-5 py-2.5 text-sm transition-colors hover:border-accent disabled:opacity-40 sm:min-h-0"
            style={{ border: "1px solid var(--line)" }}
          >
            Send test email
          </button>
          <span className="text-sm text-fg-muted" role="status">
            {mailResult}
          </span>
        </div>
      </section>

      {/*
        The colour this person works in (058, owner 17 Sep 2026).

        Not admin-gated — it is a personal preference, and a co-author has as
        much right to it as an admin. It is stored on the person's own row
        rather than on this device, so it follows them from laptop to phone,
        and one person choosing blue never repaints a colleague's workspace.

        Dark is the default and is unchanged: choosing it removes the theme
        attribute entirely rather than painting a fourth palette over the
        original. Margaret's display is dark unconditionally and reads none
        of this.
      */}
      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>WORKSPACE COLOUR</p>
        <p className="mt-2.5 text-[15px] text-fg-muted">
          How the workspace looks for you, on every device you sign in from.
          It changes nothing for anyone else in the family, and nothing on{" "}
          {who === "she" ? "her" : `${who}'s`} screen.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Workspace colour">
          {WORKSPACE_THEMES.map((t) => {
            const swatch = THEME_SWATCH[t];
            const active = workspaceTheme === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseWorkspaceTheme(t)}
                disabled={savingTheme}
                className="flex min-h-[44px] items-center gap-3 rounded-[12px] px-4 py-2.5 text-[14px] transition-colors disabled:opacity-60"
                style={{
                  border: active ? "1px solid var(--accent)" : "1px solid var(--line)",
                  background: active ? "var(--accent-tint)" : "transparent",
                }}
              >
                {/* Two-tone: the ground it paints, and the accent on it. The
                    word is always there — never colour alone. */}
                <span
                  aria-hidden
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full"
                  style={{ background: swatch.ground, border: "1px solid var(--line)" }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: swatch.accent }} />
                </span>
                {swatch.label}
              </button>
            );
          })}
        </div>
        {themeError && (
          <p role="alert" className="mt-2.5 text-sm" style={{ color: "var(--destructive-soft)" }}>
            {themeError}
          </p>
        )}
      </section>

      {/* The machines moved to their own page (owner-directed): Devices is
          where the family's screens live now, beside the equipment Recall
          can send. Settings keeps the door, not the list. */}
      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>DEVICES</p>
        <p className="mt-2.5 text-[15px] text-fg-muted">
          {who === "she" ? "Her" : `${who}'s`} screens, the card reader and the hub have their
          own page now.
        </p>
        <button
          type="button"
          onClick={() => navigate("/admin/devices")}
          className="mt-3 min-h-[44px] rounded-full px-5 py-2.5 text-sm transition-colors hover:border-accent sm:min-h-0"
          style={{ border: "1px solid var(--line)" }}
        >
          Open Devices
        </button>
      </section>

      {/* The one deliberate way to untrust this machine. The switcher never
          signs the installation out on her screen — decommissioning a device
          is a Settings decision, named for exactly what it does. */}
      <section className={PANEL} style={PANEL_STYLE}>
        <p className={LABEL}>THIS SCREEN</p>
        {confirmingSignOut ? (
          <div className="mt-3 flex items-center gap-4 text-sm">
            <span className="text-fg-muted">
              Sign this screen out of the archive? It will need the family
              password to come back{isSubjectDevice() ? ` — ${who}'s display stops until then` : ""}.
            </span>
            <button
              type="button"
              onClick={() => setConfirmingSignOut(false)}
              className="text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleInstallationSignOut()}
              style={{ color: "var(--destructive-soft)" }}
            >
              Sign out this screen
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingSignOut(true)}
            className="mt-3 min-h-[44px] rounded-full px-5 py-2.5 text-sm transition-colors hover:border-accent sm:min-h-0"
            style={{ border: "1px solid var(--line)" }}
          >
            Sign this screen out of the archive
          </button>
        )}
        <p className="mt-2 text-xs text-fg-faint">
          It will ask for the family email and password the next time anyone
          uses it.
        </p>
      </section>

      {/* Her word (054): who agreed to this archive, printable, withdrawable. */}
      <ConsentPanel isAdmin={isAdmin} subjectName={form.full_name || form.display_name} />
      </div>
    </PageFrame>
  );
}
