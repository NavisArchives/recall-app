import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageFrame, PageHeader } from "@/components/admin/kit";
import { useDisplay } from "@/lib/DisplayContext";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { SuccessScreen } from "@/components/admin/SuccessScreen";
import type { Author } from "@/types";
import { IMAGE_ACCEPT } from "@/lib/mediaTypes";

const FIELD =
  "w-full rounded-[12px] border border-input bg-[rgba(var(--ink),0.04)] px-4 py-2.5 text-[15px] outline-none focus:border-accent";

/** Edits a contributor's own details — attribution and roles live elsewhere. */
export function ContributorEditPage() {
  /*
   * Whose archive this is. "Margaret" was written into these sentences when
   * there was only ever one family; every other family read somebody else's
   * mother's name on their own screens. Falls back to a neutral word rather
   * than a wrong one.
   */
  const { subjectName } = useDisplay();
  const who = subjectName ?? "she";

  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { setStatus } = useDisplay();

  const [form, setForm] = useState({
    name: "",
    relationship: "",
    email: "",
    contact_number: "",
    birthday: "",
    description: "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /*
    Which person's values are in the form — not merely whether some person's
    are (M222).

    `useRef(false)` flipped once and never reset, so a component that
    survived an `:id` change would keep person A's values in state while Save
    wrote to person B's id: not a blanked record but a plausible, filled-in
    one containing somebody else's truth, which is harder to notice and
    harder to undo. Latent today — `contributors/:id/edit` is a sibling
    route and every link out of this page goes to the same person's profile,
    so no A-to-B path exists — but the guard costs one string and the trap
    is one careless link away.
  */
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    setStatus({ hint: "EDIT CONTRIBUTOR" });
    return () => setStatus(null);
  }, [setStatus]);

  const {
    data: person,
    isPending: personPending,
    isError: personFailed,
    refetch: refetchPerson,
  } = useQuery({
    queryKey: ["person", id],
    queryFn: () => api.get<Author>(`/people/${id}`),
    enabled: !!id,
  });

  /*
    What the archive actually held when this form opened (M203).

    Kept so `save` can send only what changed. Without a baseline there is
    no way to tell "the person cleared this field" from "this field was
    never populated", and the second is what turned a failed read into a
    deletion.
  */
  const baseline = useRef<typeof form | null>(null);

  useEffect(() => {
    if (person && loadedFor.current !== id) {
      loadedFor.current = id ?? null;
      const fields = {
        name: person.name,
        relationship: person.relationship ?? "",
        email: person.email ?? "",
        contact_number: person.contact_number ?? "",
        birthday: person.birthday ?? "",
        description: person.description ?? "",
      };
      baseline.current = fields;
      setForm(fields);
    }
  }, [person, id]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (done) {
    return <SuccessScreen title="Contributor updated" to={`/admin/contributors/${id}`} />;
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("The name cannot be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      /*
        Only what changed (M203).

        This used to send all six fields on every save. On its own that is
        harmless — but combined with a form that rendered before the person
        had loaded, it meant an admin could open a contributor after a failed
        read, see six empty boxes, type the one thing they knew for certain,
        press Save, and silently erase the email, phone, relationship,
        birthday and description that were already in the archive. No error,
        no undo, and those are the admin-only fields the product guards most
        carefully.

        The door below is the fix for that. This is the fix for the *class*:
        with a baseline, a field that was never populated is distinguishable
        from a field somebody deliberately cleared, so no future path can
        turn "we did not read it" into "delete it". Both are cheap; only one
        of them survives the next page written this way.
      */
      const before = baseline.current;
      const body = new FormData();
      const send = (key: keyof typeof form, value: string) => {
        if (!before || before[key] !== value) body.set(key, value);
      };

      // The name is the one field the backend requires, so it always goes.
      body.set("name", form.name.trim());
      send("relationship", form.relationship);
      send("email", form.email);
      send("contact_number", form.contact_number);
      send("birthday", form.birthday);
      send("description", form.description);
      if (photo) body.set("profile_picture", photo);

      await api.patch(`/people/${id}`, body);
      await queryClient.invalidateQueries({ queryKey: ["person", id] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      setDone(true);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "The changes could not be saved.");
    }
  }

  /*
    No form until the person has been read (M203).

    A blank form is an invitation to fill it in. This page rendered seven
    empty, enabled inputs and an enabled Save whether or not the contributor
    had loaded — and Save PATCHes the real id from the URL. Nothing on the
    screen said anything had gone wrong.

    So the refusal is a door, not a banner over a live form: the same shape
    as `/admin/create-channel` (M196), and for the same reason — a warning
    beside a working control is a warning people save through. It names the
    cause *and* the consequence, because "could not load" alone does not
    explain why the page will not simply let them get on with it.
  */
  if (personPending || personFailed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[17px]">
          {personPending ? "Opening…" : "This person's details could not be loaded"}
        </p>
        {personFailed && (
          <>
            <p className="max-w-[400px] text-[13px] leading-[1.6] text-fg-muted">
              Editing now would save an empty form over whatever is already there — their email,
              phone and relationship among it. Nothing has been changed.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void refetchPerson()}
                className="pressable rounded-full px-5 py-2.5 text-[13px]"
                style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
              >
                Try again
              </button>
              <Link
                to={`/admin/contributors/${id}`}
                className="pressable rounded-full border border-line px-5 py-2.5 text-[13px]"
              >
                Back to their profile
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  const currentPhoto = preview ?? person?.profile_picture_url ?? null;

  return (
    /*
      On the shared frame (M119), so this page's title and its form begin on
      the same two lines as the six core pages. The `mt-[3vh]` it used to
      carry was a viewport-relative guess at exactly the line the frame now
      fixes — the offset that made every page's rhythm its own opinion.
    */
    <PageFrame
      header={
        <div>
          <Link to={`/admin/contributors/${id}`} className="font-mono text-xs text-fg-faint hover:text-fg">
            ← {person?.name ?? "Profile"}
          </Link>
          <PageHeader title="Edit contributor" />
        </div>
      }
    >
      <form
        onSubmit={save}
        className="scroll-thin grid min-h-0 flex-1 grid-cols-[minmax(220px,1fr)_2fr] gap-[4vw] md:overflow-y-auto pr-2"
      >
        {/* Photo */}
        <div className="flex flex-col items-center gap-4">
          {currentPhoto ? (
            <img src={currentPhoto} alt="" className="h-40 w-40 rounded-full object-cover" />
          ) : (
            <InitialsAvatar name={form.name || "?"} size={160} />
          )}
          <label className="cursor-pointer rounded-full border border-line px-5 py-2.5 text-sm transition-colors hover:border-accent">
            Change photo
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {/* Fields */}
        <div className="max-w-2xl">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label-caps" htmlFor="c-name">Name</label>
              <input id="c-name" className={`${FIELD} mt-1.5`} value={form.name} onChange={set("name")} required />
            </div>
            <div>
              <label className="label-caps" htmlFor="c-rel">Relationship</label>
              <input
                id="c-rel"
                className={`${FIELD} mt-1.5`}
                value={form.relationship}
                onChange={set("relationship")}
                placeholder="Grandson, neighbour, nurse…"
              />
            </div>
            <div>
              <label className="label-caps" htmlFor="c-email">Email</label>
              <input id="c-email" type="email" className={`${FIELD} mt-1.5`} value={form.email} onChange={set("email")} />
            </div>
            <div>
              <label className="label-caps" htmlFor="c-phone">Phone</label>
              <input id="c-phone" className={`${FIELD} mt-1.5`} value={form.contact_number} onChange={set("contact_number")} />
            </div>
            <div>
              <label className="label-caps" htmlFor="c-birthday">Birthday</label>
              <input
                id="c-birthday"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                className={`${FIELD} mt-1.5`}
                value={form.birthday}
                onChange={set("birthday")}
              />
            </div>
          </div>

          <div className="mt-5">
            <label className="label-caps" htmlFor="c-about">About</label>
            <textarea
              id="c-about"
              rows={3}
              className={`${FIELD} mt-1.5 resize-none`}
              value={form.description}
              onChange={set("description")}
              placeholder={`A line ${who}'s screen can show about them.`}
            />
          </div>

          {/* Reserved error line — the buttons never move. */}
          <p
            role="alert"
            className="mt-4 h-6 text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>

          <div className="mt-2 flex gap-4">
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] rounded-full px-8 py-3 text-[14px] font-medium disabled:opacity-50 sm:min-h-0"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <Link
              to={`/admin/contributors/${id}`}
              className="min-h-[44px] rounded-full border border-line px-8 py-3 text-[14px] transition-colors hover:border-fg sm:min-h-0"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </PageFrame>
  );
}
