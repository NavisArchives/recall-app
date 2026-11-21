import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { Select } from "@/components/admin/Select";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import type { Author } from "@/types";

/**
 * Invite someone to help — one list, one flow (M41).
 *
 * The order the family actually works in is: put a face on the shelf, then
 * ask that person to come and fill it. So the faces come first here, and
 * "Someone new" is the last card rather than the default — inviting a person
 * who is already on the shelf is the common case, and it used to be the one
 * that produced two of her.
 *
 * Choosing a face sends the profile's id with the invitation, and accepting
 * it updates that profile instead of inserting a second. Faces that have
 * already joined are not offered: they can sign in, so an invitation would
 * be asking them to do something they have done.
 */

const LABEL = "block font-mono text-[10px] tracking-[0.16em] text-fg-faint";
const INPUT =
  "mt-2 h-[50px] w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent";
const BORDER = { borderColor: "rgba(var(--ink),.22)" };

const RELATIONS = [
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

/** The one value that means "nobody on the shelf — make a new profile". */
const SOMEONE_NEW = "";

interface InviteResult {
  email: string;
  sent: boolean;
  code?: string;
  error?: string;
  reason?: string;
}

export function InvitePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { setStatus } = useDisplay();

  // Arriving from a contributor's own page preselects them, so "Invite" there
  // means what it says rather than dropping you at a list to find them again.
  const preselected = (location.state as { personId?: string } | null)?.personId ?? SOMEONE_NEW;

  const [personId, setPersonId] = useState<string>(preselected);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStatus({ hint: "INVITE" });
    return () => setStatus(null);
  }, [setStatus]);

  const {
    data: people,
    isLoading,
    isError: peopleFailed,
  } = useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Author[]>("/people"),
  });

  // Her profile is never in this list: it opens on one screen without a code,
  // and an invitation would hand out both (M42).
  const waiting = useMemo(
    () => (people ?? []).filter((p) => p.role !== "user" && !p.joined_at),
    [people]
  );

  const chosen = waiting.find((p) => p.id === personId) ?? null;

  // The chosen face fills the form in. Typing over it is allowed — the
  // invitee corrects their own name at the far end anyway.
  useEffect(() => {
    if (!chosen) return;
    setName(chosen.name);
    setRelationship(chosen.relationship ?? "");
    setEmail(chosen.email ?? "");
  }, [chosen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { results } = await api.post<{ results: InviteResult[] }>("/onboarding/invites", {
        invites: [
          {
            name: name.trim(),
            email: email.trim(),
            relationship: relationship.trim() || null,
            // Absent for someone new, which is what makes the far end insert.
            person_id: personId || undefined,
          },
        ],
      });

      const one = results[0];
      if (one?.error) setError(one.error);
      else {
        setResult(one);
        // A pending face changes state the moment this succeeds.
        void queryClient.invalidateQueries({ queryKey: ["people"] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-xl font-semibold">
          {result.sent ? `${name.split(" ")[0]} has been invited` : `${name.split(" ")[0]}'s code`}
        </h1>

        <p className="max-w-lg text-fg-muted">
          {result.sent
            ? "The link is in their inbox and works once. It expires in 14 days."
            : "The email could not be sent, so hand this code over yourself. It works once, and expires in two days."}
        </p>

        {result.code && (
          <>
            <p className="font-mono text-5xl tracking-[0.3em] text-accent">{result.code}</p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(result.code!);
                setCopied(true);
              }}
              className="pressable rounded-md border border-line px-5 py-2.5"
            >
              {copied ? "Copied" : "Copy the code"}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => navigate("/admin/contributors")}
          className="pressable mt-4 rounded-full bg-accent px-[22px] py-[11px] text-sm font-medium text-white"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-[900px] max-w-full min-h-0 flex-col md:h-full">
      <h1 className="flex-none text-[26px] font-bold tracking-[-0.01em]">Invite someone</h1>
      <p className="mt-2 flex-none text-[13px] leading-[1.6] text-fg-muted">
        They choose their own code when they arrive. Nobody needs a password.
      </p>

      {/* The page never scrolls; the list of faces does. */}
      <div className="scroll-thin mt-6 min-h-0 flex-1 md:overflow-y-auto pr-1">
        <span className={LABEL}>WHO</span>

        {isLoading && <p className="mt-3 text-sm text-fg-muted">Loading…</p>}

        <div className="mt-3 grid grid-cols-3 gap-3 xl:grid-cols-4">
          {waiting.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setPersonId(person.id)}
              className="pressable flex items-center gap-3 rounded-[12px] border p-3 text-left"
              style={{
                borderColor: personId === person.id ? "var(--accent)" : "var(--line-soft)",
                background: personId === person.id ? "rgba(var(--accent-channels),.10)" : undefined,
              }}
            >
              {person.profile_picture_url ? (
                <img
                  src={person.profile_picture_url}
                  alt=""
                  className="h-10 w-10 flex-none rounded-full object-cover"
                />
              ) : (
                <InitialsAvatar name={person.name} size={40} />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{person.name}</span>
                <span className="block truncate text-xs text-fg-faint">
                  {person.relationship || "On the shelf"}
                </span>
              </span>
            </button>
          ))}

          {/*
            A failed read is not an empty shelf (M222).

            This query had no `isError`, so when it failed the picker rendered
            exactly one option — "Someone new" — and an admin who had arrived
            from a contributor's own profile to invite THAT person found them
            missing, with nothing on screen suggesting anything had gone
            wrong. Creating a duplicate of somebody who is already on the
            shelf is the specific harm (M41), and it looks like the correct
            action from here.
          */}
          {peopleFailed && (
            <p
              role="alert"
              className="rounded-[12px] border border-dashed p-3 text-sm"
              style={{ borderColor: "var(--line-soft)", color: "var(--destructive-soft)" }}
            >
              The people already on your shelf could not be loaded, so this list is
              incomplete. Try again before adding someone new — they may already be here.
            </p>
          )}

          {/* Last, deliberately: the shelf is where the answer usually is. */}
          <button
            type="button"
            onClick={() => {
              setPersonId(SOMEONE_NEW);
              setName("");
              setEmail("");
              setRelationship("");
            }}
            className="pressable flex items-center gap-3 rounded-[12px] border p-3 text-left"
            style={{
              borderColor: personId === SOMEONE_NEW ? "var(--accent)" : "var(--line-soft)",
              background: personId === SOMEONE_NEW ? "rgba(var(--accent-channels),.10)" : undefined,
              borderStyle: personId === SOMEONE_NEW ? "solid" : "dashed",
            }}
          >
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[rgba(var(--ink),0.08)]">
              <UserPlus className="h-4 w-4 text-[color:rgba(var(--ink),0.55)]" strokeWidth={1.8} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">Someone new</span>
              <span className="block truncate text-xs text-fg-faint">Not on the shelf yet</span>
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} id="invite-form" className="mt-8 flex flex-col gap-[22px]">
          <div className="grid gap-x-7 gap-y-[22px] sm:grid-cols-2">
            <label>
              <span className={LABEL}>FULL NAME *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={INPUT}
                style={BORDER}
              />
            </label>

            <label>
              <span className={LABEL}>EMAIL *</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                className={INPUT}
                style={BORDER}
              />
            </label>

            <div>
              <span className={LABEL}>RELATION</span>
              <Select
                value={relationship}
                options={RELATIONS}
                onChange={setRelationship}
                allowOther
                placeholder="Choose…"
              />
            </div>
          </div>

          <p className="text-[13px] leading-[1.6] text-fg-muted">
            {chosen
              ? `The invitation fills in ${chosen.name.split(" ")[0]}'s profile — everything already on it stays.`
              : "A new profile appears on the shelf when they accept."}
          </p>

          <p
            role="alert"
            className="h-5 text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>
        </form>
      </div>

      <div className="flex flex-none items-center justify-end gap-[18px] py-5">
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-fg-muted">
          Cancel
        </button>
        <button
          type="submit"
          form="invite-form"
          disabled={busy}
          className="pressable rounded-full px-[22px] py-[11px] text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "Sending…" : "Send the invitation"}
        </button>
      </div>
    </div>
  );
}
