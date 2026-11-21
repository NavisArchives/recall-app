import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { IMAGE_ACCEPT } from "@/lib/mediaTypes";
import type { Author } from "@/types";

/**
 * My Info — the one page a helper owns outright.
 *
 * Everywhere else in the workspace a co-author reads and cannot write. Here
 * it is the other way round: exactly one person's details, their own, and
 * nobody else's anything. The backend has always allowed this — PATCH
 * /people/:id refuses any id but your own unless you are an admin — and no
 * screen ever reached it, so a contributor could not fix their own phone
 * number without asking an administrator to do it for them.
 *
 * An admin gets the same page for themselves, rather than editing their own
 * row through the tool they use on everyone else.
 */

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";
const FIELD =
  "mt-1.5 w-full rounded-[10px] border bg-transparent px-4 py-2.5 text-[15px] outline-none focus:border-accent";
const BORDER = { borderColor: "rgba(var(--ink),.22)" };

export function MyInfoPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    birthday: "",
    relationship: "",
    address: "",
    contact_number: "",
    email: "",
    description: "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState(false);
  const loaded = useRef(false);
  const originalEmail = useRef("");

  const {
    data: me,
    isPending: mePending,
    isError: meFailed,
    refetch: refetchMe,
  } = useQuery({
    queryKey: ["me", profile?.id],
    queryFn: () => api.get<Author>(`/people/${profile!.id}`),
    enabled: !!profile?.id,
  });

  useEffect(() => {
    if (!me || loaded.current) return;
    loaded.current = true;
    originalEmail.current = me.email ?? "";
    setForm({
      name: me.name ?? "",
      birthday: me.birthday ?? "",
      relationship: me.relationship ?? "",
      address: (me as Author & { address?: string }).address ?? "",
      contact_number: me.contact_number ?? "",
      email: me.email ?? "",
      description: me.description ?? "",
    });
  }, [me]);

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

  const emailChanged = form.email.trim() !== originalEmail.current.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.id) return;
    if (!form.name.trim()) {
      setError("Your name cannot be empty.");
      return;
    }
    // Changing where your codes arrive deserves a pause, not a surprise.
    if (emailChanged && !confirmEmail) {
      setConfirmEmail(true);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      /*
       * One request, whichever shape it needs.
       *
       * The endpoint takes the photograph on the same PATCH, as multipart —
       * so a separate upload call would be a second round trip that could
       * half-succeed. When there is no new photograph, plain JSON.
       */
      const fields = {
        name: form.name.trim(),
        birthday: form.birthday || "",
        relationship: form.relationship.trim(),
        address: form.address.trim(),
        contact_number: form.contact_number.trim(),
        email: form.email.trim(),
        description: form.description.trim(),
      };

      if (photo) {
        const body = new FormData();
        for (const [key, value] of Object.entries(fields)) body.set(key, value);
        body.set("profile_picture", photo);
        await api.patch(`/people/${profile.id}`, body);
      } else {
        await api.patch(`/people/${profile.id}`, fields);
      }
      originalEmail.current = form.email.trim();
      setConfirmEmail(false);
      setPhoto(null);
      await queryClient.invalidateQueries({ queryKey: ["me", profile.id] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  /*
    No form until your own details have been read (M203, second fork).

    Identical to `ContributorEditPage`: the form rendered from
    `useQuery`'s data alone, so a failed read left seven empty enabled
    boxes and an enabled Save, and Save PATCHes the signed-in person's id.

    It is arguably the worse of the two. This page holds the address
    invitations and PIN resets are sent to — the page says so itself, two
    inches below: "a typo locks you out of your own way back in". Wiping it
    silently locks a person out of their own archive, and they did nothing
    but open a page and press the button it offered.
  */
  if (mePending || meFailed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[17px]">
          {mePending ? "Opening…" : "Your details could not be loaded"}
        </p>
        {meFailed && (
          <>
            <p className="max-w-[400px] text-[13px] leading-[1.6] text-fg-muted">
              Saving now would write an empty form over what is already there — including the email
              your PIN resets are sent to. Nothing has been changed.
            </p>
            <button
              type="button"
              onClick={() => void refetchMe()}
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

  const currentPhoto = preview ?? me?.profile_picture_url ?? null;

  return (
    /*
      The same shape as a contributor's profile (12a), because it is the same
      thing seen from the inside — the owner's words: "if it's my info that
      I'm clicking on contributors, the same design and layout".

      Identity on the left with the portrait and the name under it, the facts
      on the right in hairline-separated blocks. Nothing about what this page
      DOES changed: same form, same fields, same save, same route. Only the
      arrangement, so the page stops looking like a different product from
      the one next to it.
    */
    <div className="scroll-thin md:h-full md:overflow-y-auto md:pb-10 md:pr-2">
      {/*
        A form is not a record, and the read layout does not transfer whole.

        The first pass put the name under the portrait the way a contributor's
        page does — but there it IS the heading, and here it duplicates the
        FULL NAME field two inches to its right, updating as you type, which
        reads as a bug. The portrait keeps the left column; the heading goes
        back to the top where a form's heading belongs.

        And the measure is capped. Stretched across a 1900px window the fields
        ran the full width with nothing to stop the eye, which is most of why
        this looked thin — a text input a metre wide is harder to read, not
        more generous.
      */}
      <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.01em]">My Info</h1>
      <p className="mt-2 text-[15px] text-fg-muted">
        Your own details. Nobody else&apos;s — and nobody else has to change them for you.
      </p>

      <form
        onSubmit={save}
        className="mt-8 grid max-w-[980px] grid-cols-1 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10"
      >
        <div className="flex flex-none flex-col items-center gap-4 text-center">
          {currentPhoto ? (
            <img src={currentPhoto} alt="" className="h-32 w-32 rounded-full object-cover" />
          ) : (
            <InitialsAvatar name={form.name || "?"} size={128} />
          )}
          <label
            className="cursor-pointer rounded-md px-4 py-2 text-sm transition-colors hover:border-accent"
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

        <div className="min-w-0">
          <p className="label-caps">Details</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={LABEL}>FULL NAME</span>
              <input className={FIELD} style={BORDER} value={form.name} onChange={set("name")} required />
            </label>
            <label>
              <span className={LABEL}>BORN</span>
              <input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                className={FIELD}
                style={BORDER}
                value={form.birthday}
                onChange={set("birthday")}
              />
            </label>
            <label>
              <span className={LABEL}>LOCATION</span>
              <input className={FIELD} style={BORDER} value={form.address} onChange={set("address")} />
            </label>
            <label>
              <span className={LABEL}>PHONE</span>
              <input className={FIELD} style={BORDER} value={form.contact_number} onChange={set("contact_number")} />
            </label>
          </div>

          <div className="mt-8 border-t border-line-soft pt-6">
          <label className="block">
            <span className={LABEL}>EMAIL</span>
            <input
              type="email"
              className={FIELD}
              style={BORDER}
              value={form.email}
              onChange={set("email")}
            />
            <span className="mt-1.5 block text-[12px] leading-[1.5] text-fg-faint">
              Invitations and PIN resets are sent here — a typo locks you out of your own
              way back in.
            </span>
          </label>
          </div>

          <div className="mt-8 border-t border-line-soft pt-6">
          <label className="block">
            <span className={LABEL}>NOTES</span>
            <textarea
              rows={3}
              className={`${FIELD} resize-none`}
              style={BORDER}
              value={form.description}
              onChange={set("description")}
            />
          </label>

          {confirmEmail && (
            <div
              className="mt-4 rounded-[10px] p-3.5 text-sm leading-[1.55]"
              style={{ border: "1px solid var(--accent)", color: "var(--fg-muted)" }}
            >
              You are changing your email from{" "}
              <span style={{ color: "var(--fg)" }}>{originalEmail.current || "nothing"}</span> to{" "}
              <span style={{ color: "var(--fg)" }}>{form.email.trim()}</span>. Everything sent to
              you goes there from now on. Press Save again to confirm.
            </div>
          )}

          </div>

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
            className="pressable rounded-md px-7 py-2.5 font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "Saving…" : confirmEmail ? "Save and change my email" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
