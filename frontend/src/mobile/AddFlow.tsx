import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useChannels } from "@/hooks/useAdminData";
import { fileProblem, IMAGE_ACCEPT } from "@/lib/mediaTypes";
import { SuccessScreen } from "@/components/admin/SuccessScreen";
import { Sheet, SheetCancel } from "./Sheet";
import type { Channel } from "@/types";

/*
 * The Add flow — the centre of the product on mobile (wireframes-mobile.md,
 * Part 3; frames 16c–16f).
 *
 * One step, one screen, one sticky button. The birthday-cake scenario is the
 * whole brief: a daughter takes a photo at the party and it is on her
 * mother's screen the same evening — captioned, dated, in the right channel.
 */

export type AddTarget =
  | { kind: "channel"; channel: Channel }
  | { kind: "new" };

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";
const FIELD =
  "mt-2 w-full rounded-[12px] border bg-transparent px-4 text-[16px] outline-none focus:border-accent";
const EDGE = { borderColor: "rgba(var(--ink),.22)" };

/* 11 left this set with migration 045 — a guide is a channel like any
   other now. The backend's channelNumbers.ts is the authority; this copy
   only picks the next FREE number and must not skip a valid one. */
const RESERVED = new Set([0, 10, 98, 99]);
/* The owner's four (29 Aug): a story is one photo, a description, and a
   recorded voice — and the phone is the natural place to record one. */
const TYPES = ["album", "video", "instruction", "stories"] as const;
type ChannelType = (typeof TYPES)[number];

interface Pending {
  file: File;
  preview: string;
  caption: string;
  taken_on: string;
  uploaded: boolean;
}

type Step = "entry" | "pick" | "channel" | "memories" | "success";

export function AddFlow({
  target,
  onClose,
}: {
  target?: AddTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { isAdmin, profile } = useAuth();
  const {
    data: channels,
    isPending: channelsPending,
    isError: channelsFailed,
    refetch: refetchChannels,
  } = useChannels();

  const [step, setStep] = useState<Step>(
    target?.kind === "channel" ? "memories" : target?.kind === "new" ? "channel" : "entry"
  );
  const [channel, setChannel] = useState<Channel | null>(
    target?.kind === "channel" ? target.channel : null
  );

  // Screen A state — the new channel, when that path is taken.
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChannelType>("album");
  const [monthDate, setMonthDate] = useState("");
  const [privacy, setPrivacy] = useState<1 | 2 | 3>(3);
  const [description, setDescription] = useState("");

  // Screen B state.
  const [items, setItems] = useState<Pending[]>([]);
  const [captioning, setCaptioning] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  /*
    The story's voice (24b, on the phone). Recorded here — a phone is a
    microphone with a screen — or brought as a file. Optional, exactly as on
    the desktop: the channel can be made first and the voice added later.
    `voiceUploaded` mirrors the per-item `uploaded` flags so a failed save
    retries only what has not landed.
  */
  const [voice, setVoice] = useState<{ blob: Blob; url: string; uploaded: boolean } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micProblem, setMicProblem] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function startRecording() {
    setMicProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setVoice({ blob, url: URL.createObjectURL(blob), uploaded: false });
        setRecording(false);
        if (recordTimer.current) clearInterval(recordTimer.current);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setMicProblem("The microphone could not be used — you can upload a recording instead.");
    }
  }

  const editable = useMemo(
    () =>
      (channels ?? [])
        .filter((c) => isAdmin || c.created_by === profile?.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [channels, isAdmin, profile?.id]
  );

  /*
    No list, no number (M196).

    This read `channels ?? []`, so a failed load meant "no numbers are
    taken" and the flow confidently offered **Channel 01** to a family
    whose shelf is full. They would then choose photographs, type
    captions, and lose all of it to a 409 from a unique column that
    already held 1. A false claim became a wrong action the product
    recommended — which is worse than the claim.

    `null` is the honest answer when the shelf is unknown, and the guard
    below refuses to start rather than letting `null` surface later.
  */
  const nextNumber = useMemo(() => {
    if (!channels) return null;
    const taken = new Set(channels.map((c) => c.number));
    for (let n = 1; n <= 99; n++) if (!RESERVED.has(n) && !taken.has(n)) return n;
    return null;
  }, [channels]);

  const isVideo = type === "video";
  const isInstruction = type === "instruction";
  const isStory = type === "stories";
  const described = items.filter((i) => i.caption.trim()).length;

  function accept(list: FileList | null) {
    const incoming = Array.from(list ?? [])
      .filter((file) => {
        const problem = fileProblem(file, isVideo && step === "memories" && !channel ? "video" : "image");
        if (problem) setError(problem);
        return !problem;
      })
      .map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        caption: "",
        taken_on: "",
        uploaded: false,
      }));
    if (incoming.length) setError(null);
    /* A story carries ONE photograph — the room her screen shows while the
       voice plays. Choosing again replaces it. */
    if (isStory && !channel) {
      setItems(incoming.slice(0, 1));
      return;
    }
    setItems((prev) => [...prev, ...incoming]);
  }

  /**
   * Saving uploads one file per request, deliberately: each finished file is
   * real progress a slow connection can show, and a failure part-way keeps
   * every photo and every typed word — retry re-sends only what is left.
   */
  async function save() {
    setSaving(true);
    setError(null);
    try {
      let into = channel;
      if (!into) {
        into = await api.post<Channel>("/channels", {
          number: nextNumber,
          title: title.trim(),
          description: description.trim() || null,
          content_type: type,
          date: !isInstruction && monthDate ? `${monthDate}-01` : null,
          ...(isAdmin ? { privacy_level: privacy } : {}),
        });
        setChannel(into);
      }

      const pending = items.filter((i) => !i.uploaded);
      let done = items.length - pending.length;
      for (const item of pending) {
        const form = new FormData();
        form.set("channel_id", into.id);
        form.append("files", item.file);
        form.append("captions", item.caption);
        form.append("taken_on", item.taken_on ? `${item.taken_on}-01` : "");
        /* A month picker writes a month (059) — the "-01" is padding. */
        form.append("taken_precision", "month");
        await api.post("/media-files", form);
        item.uploaded = true;
        done += 1;
        setProgress(done / items.length);
      }

      /* The story's voice, last, with its own uploaded flag so a retry
         after a failure sends only what has not landed. */
      if (isStory && voice && !voice.uploaded) {
        const ext = voice.blob.type.includes("ogg") ? "ogg" : voice.blob.type.includes("mp4") ? "m4a" : "webm";
        const form = new FormData();
        form.set("channel_id", into.id);
        form.append("files", new File([voice.blob], `voice-message.${ext}`, { type: voice.blob.type }));
        form.append("captions", "");
        form.append("taken_on", "");
        await api.post("/media-files", form);
        setVoice({ ...voice, uploaded: true });
      }

      items.forEach((i) => URL.revokeObjectURL(i.preview));
      setSavedCount(items.length);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({ queryKey: ["suggestions"] });
      setStep("success");
    } catch (err) {
      // Everything chosen and typed survives; the retry costs only the tap.
      setError(err instanceof Error ? err.message : "Saving failed — try again.");

      /*
        A genuine race, where the number really was free when this sheet
        opened and somebody else took it first (M196).

        The photographs and captions are already safe — they live in
        component state and the upload loop marks each file as it lands —
        but a retry would post the *same* number again and 409 forever,
        because `nextNumber` was computed from the shelf as it was. So the
        shelf is re-read, which recomputes a free number, and the next tap
        can actually succeed.
      */
      void refetchChannels();
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------ success
  if (step === "success") {
    const n = savedCount;
    return (
      <SuccessScreen
        title={
          n > 0
            ? `${n} memor${n === 1 ? "y" : "ies"} saved for ${channel?.title ?? "the shelf"}`
            : `${title.trim() || channel?.title || "The channel"} is on the shelf`
        }
        to="/admin/shelf"
      />
    );
  }

  // ------------------------------------------------------------ entry
  /*
    The flow does not open on a shelf it could not read (M196).

    Every screen after this asks the family to *do* work — choose
    photographs, write captions, name a memory — and all of it is thrown
    away if the shelf turns out to be different from what this sheet
    assumed. So the refusal belongs at the door, before anything is
    invested, not as a graceful 409 at the end. A graceful failure at the
    end still costs them the captions.

    This is the F70 rule where it matters most: a load that did not arrive
    is not an empty shelf, and here the difference is not a sentence on a
    card but somebody's afternoon.
  */
  if (channelsPending || channelsFailed) {
    return (
      <Sheet open onClose={onClose}>
        <p className="text-[17px] font-medium">
          {channelsPending ? "Opening…" : "Your memories could not be loaded"}
        </p>
        {channelsFailed && (
          <p className="mt-2 text-[13px] leading-[1.5] text-fg-muted">
            Adding now could clash with a memory that is already there, so this
            waits until the shelf can be read. Nothing has been changed.
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          {channelsFailed && (
            <button
              type="button"
              onClick={() => void refetchChannels()}
              className="rounded-full py-3 text-center text-[14px] font-medium"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              Try again
            </button>
          )}
          <SheetCancel onClose={onClose} />
        </div>
      </Sheet>
    );
  }

  if (step === "entry" || step === "pick") {
    return (
      <Sheet open onClose={onClose}>
        {step === "entry" ? (
          <>
            <p className="mb-[18px] text-[17px] font-medium">What would you like to add?</p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="flex items-center gap-3.5 rounded-[16px] border p-[18px] text-left"
                style={EDGE}
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-[rgba(var(--ink),.08)]">
                  <ImageIcon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[15px] font-medium">Add to a channel</span>
                  <span className="mt-0.5 block text-[12px] text-fg-faint">
                    Photos into a memory that already exists
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStep("channel")}
                className="flex items-center gap-3.5 rounded-[16px] border-[1.5px] border-accent p-[18px] text-left"
                style={{ background: "var(--accent-tint)" }}
              >
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-accent text-[22px] font-light text-accent-foreground">
                  +
                </span>
                <span>
                  <span className="block text-[15px] font-medium">Start a new channel</span>
                  <span className="mt-0.5 block text-[12px] text-fg-faint">
                    A new memory for the shelf
                  </span>
                </span>
              </button>
              <SheetCancel onClose={onClose} />
            </div>
          </>
        ) : (
          <>
            <p className="mb-[18px] text-[17px] font-medium">Which channel?</p>
            <div className="flex max-h-[55vh] flex-col overflow-y-auto">
              {editable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setChannel(c);
                    setStep("memories");
                  }}
                  className="flex min-h-[54px] items-center gap-3.5 text-left"
                  style={{ borderBottom: "1px solid rgba(var(--ink),.08)" }}
                >
                  <span className="h-10 w-10 flex-none overflow-hidden rounded-[10px] bg-[rgba(var(--ink),.06)]">
                    {c.cover_url && (
                      <img src={c.cover_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{c.title}</span>
                  <span className="font-mono text-[10px] text-fg-faint">
                    {String(c.number).padStart(2, "0")}
                  </span>
                </button>
              ))}
              {editable.length === 0 && (
                <p className="py-6 text-center text-[13px] text-fg-faint">
                  No channels you can add to yet — start a new one.
                </p>
              )}
            </div>
            <SheetCancel onClose={onClose} />
          </>
        )}
      </Sheet>
    );
  }

  // ------------------------------------------------------------ Screen A
  if (step === "channel") {
    const ready = title.trim().length > 0 && (isInstruction || monthDate);
    return (
      <FullScreen>
        <header className="flex-none px-[22px] pt-4">
          <button type="button" onClick={onClose} className="text-[13px] text-fg-muted">
            ← Cancel
          </button>
          <div className="mt-4 flex items-baseline justify-between">
            <h1 className="text-[24px] font-bold tracking-[-0.01em]">Create a channel</h1>
            <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint">
              CHANNEL {nextNumber != null ? String(nextNumber).padStart(2, "0") : "—"}
            </span>
          </div>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-5">
          <label className="block">
            <span className="flex justify-between">
              <span className={LABEL}>TITLE *</span>
              <span className="font-mono text-[10px] text-[color:rgba(var(--ink),0.3)]">{title.length}/80</span>
            </span>
            <input
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className={`${FIELD} h-[52px]`}
              style={EDGE}
            />
          </label>

          <div className="mt-[18px]">
            <span className={LABEL}>TYPE</span>
            <div
              className="mt-2 flex h-[52px] gap-1 rounded-[12px] border p-1"
              style={{ ...EDGE, background: "rgba(var(--ink),.06)" }}
            >
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="flex-1 rounded-[9px] text-[14px] capitalize"
                  style={
                    type === t
                      ? { background: "var(--accent)", color: "var(--accent-foreground)", fontWeight: 500 }
                      : { color: "var(--fgw-soft)" }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* An instruction is not from a month; the date row simply leaves. */}
          {!isInstruction && (
            <label className="mt-[18px] block">
              <span className={LABEL}>DATE *</span>
              <input
                type="month"
                value={monthDate}
                max={new Date().toISOString().slice(0, 7)}
                onChange={(e) => setMonthDate(e.target.value)}
                className={`${FIELD} h-[52px]`}
                style={EDGE}
              />
              <span className="mt-1.5 block text-[12px] text-fg-faint">
                A month or a year is enough.
              </span>
            </label>
          )}

          {isAdmin && (
            <div className="mt-[18px]">
              <span className={LABEL}>WHO CAN SEE THIS MEMORY</span>
              <div
                className="mt-2 flex h-[52px] gap-1 rounded-[12px] border p-1"
                style={{ ...EDGE, background: "rgba(var(--ink),.06)" }}
              >
                {([1, 2, 3] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPrivacy(level)}
                    className="flex-1 rounded-[9px] text-[13px]"
                    style={
                      privacy === level
                        ? { background: "var(--accent)", color: "var(--accent-foreground)", fontWeight: 500 }
                        : { color: "var(--fgw-soft)" }
                    }
                  >
                    {level === 1 ? "Private" : level === 2 ? "Chosen" : "Everyone"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="mt-[18px] block">
            <span className={LABEL}>CHANNEL DESCRIPTION</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${FIELD} py-3 leading-[1.5]`}
              style={EDGE}
            />
          </label>
        </div>

        <StickyButton disabled={!ready} onClick={() => setStep("memories")}>
          Continue to memories →
        </StickyButton>
      </FullScreen>
    );
  }

  // ------------------------------------------------------------ Screen B
  const heading = channel?.title ?? (title.trim() || "New channel");
  const number = channel?.number ?? nextNumber;
  const noun = isVideo && !channel ? "video" : "memor";
  const saveLabel = isStory && !channel
    ? `Create the story${voice ? " · photo + voice" : ""}`
    : items.length === 0
      ? channel
        ? "Choose photos to save"
        : "Create the channel"
      : `Save ${items.length} ${noun === "video" ? "video" : items.length === 1 ? "memory" : "memories"}`;

  return (
    <FullScreen>
      <header className="flex-none px-[22px] pt-4">
        <button
          type="button"
          onClick={() => (channel && target?.kind !== "new" ? onClose() : setStep("channel"))}
          className="text-[13px] text-fg-muted"
        >
          ← Back
        </button>
        <div className="mt-4 flex items-baseline justify-between gap-3">
          <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-[-0.01em]">
            {heading}
          </h1>
          <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint">
            CHANNEL {number != null ? String(number).padStart(2, "0") : "—"}
          </span>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[22px] pb-4 pt-5">
        <div className="flex flex-col gap-2.5">
          <BigButton onClick={() => fileInput.current?.click()}>
            <ImageIcon className="h-[18px] w-[18px]" /> Choose from photos
          </BigButton>
          <BigButton onClick={() => cameraInput.current?.click()}>
            <Camera className="h-[18px] w-[18px]" /> Take a photo
          </BigButton>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple={!isVideo}
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 && (
          <>
            {/*
              Two counts on one line, and neither may wrap. They are mono
              and tracked, so they are wider than they look and the em dash
              is a break opportunity the browser will take at 375px — which
              turns "PHOTOS — 3" into two lines and makes a tidy row look
              broken. `whitespace-nowrap` on both, and a gap so they cannot
              collide instead.
            */}
            <div className="mt-5 flex items-baseline justify-between gap-3">
              <span className={`${LABEL} whitespace-nowrap`}>PHOTOS — {items.length}</span>
              <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-accent-soft">
                {described} DESCRIBED
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {items.map((item, i) => (
                <div key={item.preview} className="relative min-w-0">
                  <button
                    type="button"
                    onClick={() => setCaptioning(i)}
                    className="block h-[104px] w-full overflow-hidden rounded-[14px]"
                  >
                    <img src={item.preview} alt="" className="h-full w-full object-cover" />
                  </button>
                  {item.caption.trim() && (
                    <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() =>
                      setItems((prev) => {
                        URL.revokeObjectURL(item.preview);
                        return prev.filter((_, j) => j !== i);
                      })
                    }
                    /*
                      A 44px target wearing a 20px badge (M70).
                      
                      This was 20×20 — a thumb-sized miss on the one control
                      that undoes a mistake. The charter asks that a wrong
                      upload be recoverable, and a control you cannot reliably
                      hit is a weak kind of recoverable. The dark circle stays
                      the size it was; the button around it grew, with the
                      padding pulled back by the offset so nothing moves.
                    */
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60">
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12px] leading-[1.5] text-fg-faint">
              Descriptions are optional — you can add them later as a mission
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-destructive-soft">
            {error}
          </p>
        )}
      </div>

      {isStory && !channel && (
        <div className="mx-[22px] mb-3 flex-none rounded-[14px] border p-4" style={EDGE}>
          <span className={LABEL}>THE VOICE</span>
          {voice ? (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <audio controls src={voice.url} className="h-10 w-full max-w-[240px]" />
              <button
                type="button"
                onClick={() => setVoice(null)}
                className="min-h-[44px] rounded-full border px-4 text-[13px]"
                style={EDGE}
              >
                Record again
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={recording ? () => recorder.current?.stop() : () => void startRecording()}
                className="flex min-h-[48px] items-center gap-2.5 rounded-full px-5 text-[14px] font-medium"
                style={
                  recording
                    ? { background: "var(--destructive)", color: "#fff" }
                    : { background: "var(--accent)", color: "var(--accent-foreground)" }
                }
              >
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: recording ? "#fff" : "rgba(0,0,0,.4)" }}
                />
                {recording
                  ? `Stop — ${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`
                  : "Record the voice"}
              </button>
              <label className="min-h-[44px] cursor-pointer content-center rounded-full border px-4 text-[13px]" style={EDGE}>
                or upload one
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setVoice({ blob: file, url: URL.createObjectURL(file), uploaded: false });
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          )}
          {micProblem && (
            <p className="mt-2 text-[12.5px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
              {micProblem}
            </p>
          )}
          <p className="mt-2 text-[12px] text-fg-faint">
            Her screen shows the photo while the voice plays. You can add it later too.
          </p>
        </div>
      )}

      <StickyButton
        disabled={saving || (channel != null && items.length === 0)}
        onClick={save}
        progress={saving ? progress : null}
      >
        {saving ? `Saving — ${Math.round(progress * 100)}%` : saveLabel}
      </StickyButton>

      {captioning != null && items[captioning] && (
        <CaptionSheet
          item={items[captioning]}
          index={captioning}
          count={items.length}
          heading={heading}
          onChange={(patch) =>
            setItems((prev) =>
              prev.map((it, j) => (j === captioning ? { ...it, ...patch } : it))
            )
          }
          onStep={(delta) =>
            setCaptioning((i) => {
              const n = (i! + delta + items.length) % items.length;
              return n;
            })
          }
          onDone={() => setCaptioning(null)}
        />
      )}
    </FullScreen>
  );
}

/* ------------------------------------------------------------ pieces */

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      style={{
        background: "var(--bg-deep)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {children}
    </div>
  );
}

function BigButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[58px] items-center justify-center gap-3 rounded-[16px] border text-[15px]"
      style={EDGE}
    >
      {children}
    </button>
  );
}

function StickyButton({
  disabled,
  onClick,
  progress,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  progress?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex-none px-[22px] pt-3"
      style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="relative h-[54px] w-full overflow-hidden rounded-[14px] bg-accent text-[15px] font-medium text-accent-foreground disabled:opacity-40"
      >
        {progress != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-black/20 transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        )}
        <span className="relative">{children}</span>
      </button>
    </div>
  );
}

/** Frame 16f — caption one photo, then ‹ › to the next without closing. */
function CaptionSheet({
  item,
  index,
  count,
  heading,
  onChange,
  onStep,
  onDone,
}: {
  item: Pending;
  index: number;
  count: number;
  heading: string;
  onChange: (patch: Partial<Pending>) => void;
  onStep: (delta: number) => void;
  onDone: () => void;
}) {
  return (
    <Sheet open onClose={onDone}>
      <p className="mb-2 font-mono text-[10px] tracking-[0.14em] text-accent">
        ADDING TO {heading.toUpperCase()}
      </p>
      <div className="h-[240px] w-full overflow-hidden rounded-[16px]">
        <img src={item.preview} alt="" className="h-full w-full object-cover" />
      </div>

      <label className="mt-4 block">
        <span className="flex justify-between">
          <span className={LABEL}>DESCRIPTION</span>
          <span className="font-mono text-[10px] text-[color:rgba(var(--ink),0.3)]">{item.caption.length}/200</span>
        </span>
        <textarea
          value={item.caption}
          maxLength={200}
          rows={2}
          placeholder="Where, when, who is in it…"
          onChange={(e) => onChange({ caption: e.target.value })}
          className={`${FIELD} py-3 leading-[1.5]`}
          style={EDGE}
          autoFocus
        />
      </label>

      <label className="mt-3.5 block">
        <span className={LABEL}>DATE</span>
        <input
          type="month"
          value={item.taken_on}
          max={new Date().toISOString().slice(0, 7)}
          onChange={(e) => onChange({ taken_on: e.target.value })}
          className={`${FIELD} h-[50px]`}
          style={EDGE}
        />
      </label>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowButton label="Previous photo" onClick={() => onStep(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </ArrowButton>
          <span className="font-mono text-[11px] text-fg-muted">
            {index + 1} of {count}
          </span>
          <ArrowButton label="Next photo" onClick={() => onStep(1)}>
            <ChevronRight className="h-5 w-5" />
          </ArrowButton>
        </div>
        <button type="button" onClick={onDone} className="h-11 px-3 text-[15px] font-medium text-accent-soft">
          Done
        </button>
      </div>
    </Sheet>
  );
}

function ArrowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full border"
      style={{ borderColor: "rgba(var(--ink),.22)" }}
    >
      {children}
    </button>
  );
}
