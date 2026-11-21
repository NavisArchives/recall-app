import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Camera } from "lucide-react";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { Select } from "@/components/admin/Select";
import { IMAGE_ACCEPT } from "@/lib/mediaTypes";

/**
 * Add a contributor, frame 13c: no native control anywhere. The relation is
 * a Recall select with an "Other…" that turns into free text, the photo is
 * a drop zone rather than a Choose File button, and the role is a segment.
 */

const LABEL = "block font-mono text-[10px] tracking-[0.16em] text-fg-faint";
const INPUT =
  "mt-2 h-[50px] w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent";
const BORDER = { borderColor: "rgba(var(--ink),.22)" };

const RELATIONS = ["Daughter", "Son", "Sister", "Brother", "Grandchild", "Friend", "Neighbour", "Caregiver", "Nurse"];

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

interface CreatedPerson {
  id: string;
  name: string;
  /** Returned once at creation and never again. */
  pin: string | null;
}

export function CreateAuthor() {
  const navigate = useNavigate();
  const { setStatus } = useDisplay();

  const [relationship, setRelationship] = useState("");
  const [role, setRole] = useState<"co_author" | "user">("co_author");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPerson | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStatus({ hint: "NEW CONTRIBUTOR" });
    return () => setStatus(null);
  }, [setStatus]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function acceptPhoto(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(`${file.name} is not an image.`);
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError(`${file.name} is too large — 10 MB max.`);
      return;
    }
    setError(null);
    setPhoto(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.set("role", role);
    formData.set("relationship", relationship);
    if (photo) formData.set("profile_picture", photo);

    try {
      setCreated(await api.post<CreatedPerson>("/people", formData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // The PIN exists in readable form exactly once, here. After this it is only
  // a hash, so it has to be written down now.
  if (created) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-xl font-semibold">{created.name} has been added</h1>

        {created.pin ? (
          <>
            <p className="max-w-lg">
              Here is their personal code. Write it down now — it cannot be shown again.
            </p>
            <p className="font-mono text-6xl tracking-[0.3em] text-accent">{created.pin}</p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(created.pin!);
                setCopied(true);
              }}
              className="pressable rounded-md border border-line px-5 py-2.5"
            >
              {copied ? "Copied" : "Copy the code"}
            </button>
          </>
        ) : (
          <p className="max-w-lg">This profile opens without a code.</p>
        )}

        <button
          type="button"
          onClick={() => navigate("/admin")}
          className="pressable mt-4 rounded-md bg-accent px-6 py-3 font-medium text-accent-foreground"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="scroll-thin mx-auto w-[900px] max-w-full md:h-full md:overflow-y-auto md:pb-10">
      <h1 className="text-[26px] font-bold tracking-[-0.01em]">Add a contributor</h1>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-[22px]">
        <div className="grid gap-x-7 gap-y-[22px] sm:grid-cols-2">
          <label>
            <span className={LABEL}>FULL NAME *</span>
            <input name="name" required className={INPUT} style={BORDER} />
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

          <label>
            <span className={LABEL}>EMAIL</span>
            <input name="email" type="email" className={INPUT} style={BORDER} />
          </label>

          <label>
            <span className={LABEL}>PHONE</span>
            <input name="contact_number" placeholder="+32 …" className={INPUT} style={BORDER} />
          </label>

          <label>
            <span className={LABEL}>BIRTH DATE</span>
            <input
              name="birthday"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              className={INPUT}
              style={BORDER}
            />
          </label>

          <div>
            <span className={LABEL}>ROLE</span>
            <div
              className="mt-2 flex h-[50px] gap-1 rounded-[10px] p-1"
              style={{ background: "rgba(var(--ink),.06)", border: "1px solid rgba(var(--ink),.12)" }}
            >
              {(
                [
                  ["co_author", "Co-author"],
                  ["user", "User"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  className="pressable flex-1 rounded-[7px] text-sm"
                  style={
                    role === value
                      ? { background: "var(--accent)", color: "#fff", fontWeight: 500 }
                      : { color: "var(--fg-muted)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[13px] leading-[1.6] text-fg-muted">
          A co-author adds memories and edits their own. They can't delete anything.
          Administrators are set in Settings, never from this form.
        </p>

        <div className="grid gap-x-7 gap-y-[22px] sm:grid-cols-2">
          <label>
            <span className={LABEL}>DESCRIPTION</span>
            <textarea
              name="description"
              rows={3}
              placeholder="Who are they to her? A line of context…"
              className="mt-2 min-h-[84px] w-full resize-none rounded-[10px] border bg-transparent px-4 py-3 text-sm leading-[1.55] outline-none placeholder:italic placeholder:text-white/35 focus:border-accent"
              style={BORDER}
            />
          </label>

          <div>
            <span className={LABEL}>PHOTO</span>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                acceptPhoto(e.dataTransfer.files?.[0]);
              }}
              className="pressable mt-2 flex min-h-[84px] cursor-pointer items-center gap-3.5 rounded-[10px] px-4 py-3"
              style={{
                border: `1px dashed rgba(var(--ink),${dragOver ? ".6" : ".3"})`,
                background: dragOver ? "rgba(var(--accent-channels),.08)" : undefined,
              }}
            >
              {preview ? (
                <img src={preview} alt="" className="h-14 w-14 flex-none rounded-full object-cover" />
              ) : (
                <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-white/[0.08]">
                  <Camera className="h-5 w-5 text-white/55" strokeWidth={1.8} aria-hidden />
                </span>
              )}
              <span>
                <span className="block text-sm text-white/75">
                  {photo ? photo.name : "Drop a photo here"}
                </span>
                <span className="mt-0.5 block text-xs text-white/40">
                  or <span style={{ color: "var(--accent)" }}>browse</span> · JPG or PNG, 10 MB max
                </span>
              </span>
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  acceptPhoto(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        </div>

        <p
          role="alert"
          className="h-5 text-sm text-destructive-soft"
          style={{ visibility: error ? "visible" : "hidden" }}
        >
          {error || " "}
        </p>

        <div className="flex items-center justify-end gap-[18px] pb-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm text-fg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="pressable rounded-[10px] px-7 py-3.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {submitting ? "Adding…" : "Add contributor"}
          </button>
        </div>
      </form>
    </div>
  );
}
