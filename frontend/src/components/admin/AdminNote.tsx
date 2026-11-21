import { useEffect, useState } from "react";

/**
 * PRIVATE — ADMINS ONLY (frames 12c, 12i, 12l).
 *
 * "Doesn't read email — call her instead." "Paused after the row about the
 * house. Revisit in September."
 *
 * The note exists because the alternative is an administrator keeping it in
 * their head, or in a WhatsApp thread with one other person — and the second
 * admin who picks up the phone at a bad moment is the one who needs it.
 *
 * ── Why it is not part of Edit profile ───────────────────────────────────
 *
 * The edit form is *their details*: their name, their photograph, the phone
 * number they gave. This is written about them, for somebody else, and it
 * can be delicate in a way none of those are. Keeping it on its own route
 * (044) means a careless Save on the edit form can never carry it, and its
 * column never rides in the member or display sets — checked in the backend
 * suite rather than trusted to a comment.
 *
 * The line under the box is not decoration. An admin is about to write
 * something about a person's illness or a family row, and "only admins see
 * this, it never reaches the display" is the sentence that makes that safe
 * to do — or tells them not to.
 */
export function AdminNote({
  note,
  onSave,
  busy,
  failed,
}: {
  note: string | null | undefined;
  onSave: (next: string) => void;
  busy: boolean;
  failed: boolean;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const [editing, setEditing] = useState(false);

  /*
    Follow the server, but never under the writer's hands. A refetch landing
    mid-sentence used to be the classic way to lose a paragraph somebody was
    part-way through typing.
  */
  useEffect(() => {
    if (!editing) setDraft(note ?? "");
  }, [note, editing]);

  const dirty = draft.trim() !== (note ?? "").trim();

  return (
    /*
      A section of the record, not a panel sitting on top of it.

      This was a bordered card with 20px corners and its own padding, which
      at full width read as a floating slab — the heaviest thing on a page
      whose other blocks are just a label and their contents. 12a separates
      every block on this column with a hairline and nothing else, so this
      one does the same: same rhythm, same left edge, and the border moves to
      the textarea where it means "you can type here".
    */
    <section className="mt-8 border-t border-line-soft pt-6">
      <p className="label-caps" style={{ color: "var(--fgw-dim)" }}>
        Private — admins only
      </p>

      <textarea
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Add a note for the other admins — how to reach them, what they prefer."
        className="mt-3 w-full resize-y rounded-[12px] border bg-transparent px-3.5 py-2.5 text-[14px] leading-[1.6] outline-none focus:border-accent"
        style={{ borderColor: "rgba(var(--ink),.22)", color: "var(--fg)" }}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px]" style={{ color: "var(--fgw-dim)" }}>
          Only admins see this. It never reaches the display.
        </p>

        {/*
          The row keeps its height whether or not there is anything to save
          (12o's rule, applied to the quietest control on the page).
        */}
        <div className="flex min-h-[32px] items-center gap-3">
          {failed && (
            <span className="text-[12px]" style={{ color: "var(--destructive-soft)" }}>
              Not saved — the note on screen is still only here.
            </span>
          )}
          {(dirty || busy) && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(note ?? "");
                }}
                className="text-[12px]"
                style={{ color: "var(--fg-faint)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  onSave(draft.trim());
                }}
                className="rounded-full px-4 py-1.5 text-[12px] font-medium leading-none disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
              >
                {busy ? "Saving…" : "Save note"}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
