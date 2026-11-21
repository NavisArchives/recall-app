import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Camera, Check, ImageIcon, Maximize2, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fileProblem, IMAGE_ACCEPT, VIDEO_ACCEPT } from "@/lib/mediaTypes";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { MissionBanner } from "@/components/admin/MissionBanner";
import { PageFrame, PrimaryPill, CAPS } from "@/components/admin/kit";
import { Dictate } from "@/components/admin/Dictate";
import { BackCircle } from "@/components/BackCircle";
import {
  PhotoDetailModal,
  detailSummary,
  appendPhrase,
  dateIsWhole,
  usePlaceSuggestions,
  wholeDate,
  type PhotoDraft,
} from "@/components/admin/PhotoDetail";
import { useMissions, usePeople } from "@/hooks/useAdminData";
import type { Channel } from "@/types";

/**
 * Creating a channel, frames 2c–2e (M108, absorbing 14a–14b's mechanics).
 *
 * Step one is the channel — title, type, a date that may be as loose as a
 * month, who may see it — beside a live shelf preview, so the admin sees
 * exactly what lands on the shelf while they type it. Step two is the
 * photographs, as the same describe rows the editor uses: no filenames
 * anywhere; you describe what you see, and empty descriptions surface later
 * as a suggested mission. The confirmation is the cream moment: what just
 * happened, in plain words, with the real new tile standing beside it.
 */

const LABEL = "block font-mono text-[9px] tracking-[0.16em]";
const LABEL_COLOR = { color: "var(--fg-hint)" };
const COUNTER = "font-mono text-[9px] text-[color:rgba(var(--ink),0.3)]";
const FIELD =
  "mt-2 h-12 w-full rounded-[12px] px-4 text-[15px] outline-none focus:border-accent";
const FIELD_STYLE = {
  background: "rgba(var(--ink),.05)",
  border: "1px solid rgba(var(--ink),.14)",
  color: "var(--cream, #F2F1EE)",
};

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;

/*
  The app's real content types, in the frame's order.

  The type's NAME is "Stories" (owner, 29 Aug — "it's not voice message,
  it's stories"): a picture, a description and a recorded voice. And
  documentary is retired from creation entirely — the display has rendered
  it as a film since spec 24d, and offering a segment nobody should pick
  taught a distinction the product no longer makes. Old documentary rows
  keep working; they simply cannot be made any more.
  An earlier note here said there was no voice type because audio was a
  product + backend decision (M104) — that decision has now been made, by the
  owner, and migration 051 + the upload route's voice mode are the backend
  half. The caveat would otherwise have kept guarding against a thing that
  now exists.
*/
const TYPES = [
  ["album", "Album"],
  ["video", "Video"],
  ["instruction", "Instruction"],
  ["stories", "Stories"],
] as const;
type ChannelType = (typeof TYPES)[number][0];

/* Only `video` now — documentary left the segment; existing documentary
   channels are edited elsewhere and render as films either way. */
const VIDEO_TYPES: ChannelType[] = ["video"];

/**
 * Whether a typed month will actually be stored. Safari and Firefox fall
 * back to a plain text box for type="month", and the server silently drops
 * what does not parse — so the shape is checked here, in words.
 */
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

function badMonth(value: string): boolean {
  return value !== "" && !MONTH_SHAPE.test(value);
}

/** "2026-08" → "August 2026", the way the shelf says it. */
function monthLabel(value: string): string | null {
  if (!MONTH_SHAPE.test(value)) return null;
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Channel numbers the display reserves for its own screens. */
/* 11 left this set with migration 045 — a guide is a channel like any
   other now. The backend's channelNumbers.ts is the authority; this copy
   only picks the next FREE number and must not skip a valid one. */
const RESERVED = new Set([0, 10, 98, 99]);

const PRIVACY = [
  { value: 1, label: "Private" },
  { value: 2, label: "Chosen" },
  { value: 3, label: "Everyone" },
] as const;

function privacyWord(value: 1 | 2 | 3): string {
  return value === 1 ? "only you" : value === 2 ? "chosen people" : "everyone";
}

/*
  A photograph on its way in. The shape lives with the panel that edits it
  (components/admin/PhotoDetail) rather than here, because the detail view and
  this page have to agree about it exactly — the thing they disagree about is
  always the field one of them forgot.
*/
type PendingItem = PhotoDraft;

/** What the cream moment reports — the real post-create state, held before
 *  the form's own state is torn down. */
interface Created {
  id: string;
  number: string;
  title: string;
  typeLabel: string;
  isVideo: boolean;
  count: number;
  undescribed: number;
  privacy: string;
  monthText: string | null;
  cover: string | null;
  /** What the upload could not save, when it saved the photographs anyway. */
  detailProblem: string | null;
}

/**
 * The three-step marker, in the frame's vocabulary: cream for the step you
 * are on, an orange check for the ones behind it. Local on purpose — the
 * shared StepIndicator serves four other pages and M124's conversion.
 *
 * It grew a third step on 17 Sep 2026 because the work did: the channel, then
 * the photographs, then the descriptions — "so you have three steps each
 * time". A step you have already finished is a button back to it; one you
 * have not reached is not, because arriving at the details with no
 * photographs in hand is a dead room.
 */
const STEP_NAMES = ["The channel", "The photographs", "The details"] as const;

function Steps({
  current,
  onGo,
  reachable,
}: {
  current: 1 | 2 | 3;
  onGo: (step: 1 | 2 | 3) => void;
  /** The highest step this channel has enough in it to stand on. */
  reachable: 1 | 2 | 3;
}) {
  return (
    <div className="flex flex-none items-center gap-3">
      {STEP_NAMES.map((name, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < current;
        const here = n === current;
        return (
          <div key={name} className="flex items-center gap-3">
            {i > 0 && (
              <span
                className="h-px w-10"
                style={{
                  background: n <= current ? "rgba(var(--accent-channels),.65)" : "rgba(var(--ink),.2)",
                }}
              />
            )}
            <button
              type="button"
              disabled={here || n > reachable}
              onClick={() => onGo(n)}
              className="flex items-center gap-2.5 disabled:cursor-default"
            >
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full font-mono text-[13px]"
                style={
                  here
                    ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                    : done
                      ? { border: "1px solid rgba(var(--accent-channels),.65)" }
                      : { border: "1px solid rgba(var(--ink),.3)", color: "var(--fg-quiet)" }
                }
              >
                {done ? (
                  <Check size={13} strokeWidth={2.5} style={{ color: "var(--accent-soft)" }} aria-hidden />
                ) : (
                  n
                )}
              </span>
              <span
                className="hidden text-[13px] md:inline"
                style={{
                  color: here
                    ? "var(--cream, #F2F1EE)"
                    : done
                      ? "var(--fg-soft)"
                      : "var(--fg-quiet)",
                }}
              >
                {name}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AdminUpload() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const { setStatus, subjectName } = useDisplay();
  const subject = subjectName?.trim() || null;

  const arrival = location.state as { missionId?: string; presetType?: ChannelType } | null;
  const { data: allMissions } = useMissions();
  const mission = arrival?.missionId
    ? (allMissions ?? []).find((m) => m.id === arrival.missionId && m.status !== "completed")
    : undefined;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChannelType>(arrival?.presetType ?? "album");
  const [monthDate, setMonthDate] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<1 | 2 | 3>(3);

  const [items, setItems] = useState<PendingItem[]>([]);
  /*
    The voice (spec 24b). Recorded in this browser, or brought as a file —
    the owner's brief says the recording is an OPTION, so a stories channel
    can be created without one and the voice added later. Held as a blob
    until Create; nothing is uploaded before the channel exists.
  */
  const [voice, setVoice] = useState<{ blob: Blob; url: string } | null>(null);
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
        setVoice({ blob, url: URL.createObjectURL(blob) });
        setRecording(false);
        if (recordTimer.current) clearInterval(recordTimer.current);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      /* The browser said no — usually permission. Said plainly, with the
         upload path still standing right beside it. */
      setMicProblem("The microphone could not be used. You can upload a recording instead.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
  }

  const [dragOver, setDragOver] = useState(false);

  /*
    Which photograph the detail run is standing on (owner, 17 Sep 2026).

    ONE NUMBER NOW, WHERE THERE WERE THREE. There used to be a `view`
    ("grid" or "one"), a `popup` index and a separate `oneIndex`, because
    there were two ways to describe a photograph and a pop-up that could open
    over one of them. The owner's verdict on that arrangement was "there's
    too much jumping happening between if I go to all to one by one — it's
    not my kind of interface", so the toggle and the second view are gone and
    step 3 IS the pop-up, walked in order.

    It is clamped rather than trusted: removing the last photograph must not
    leave the run pointing past the end of the list.
  */
  const [detailIndex, setDetailIndex] = useState(0);

  /* Continue names the field it is waiting for and puts the cursor in it,
     so the answer arrives where the fix has to be made. */
  const titleField = useRef<HTMLInputElement | null>(null);
  const dateField = useRef<HTMLInputElement | null>(null);

  /** What this channel is about, in the family's own words (059). */
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  const { data: people } = usePeople();
  const { data: knownPlaces } = useQuery({
    queryKey: ["places"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/places"),
  });
  const { data: knownTags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/tags"),
  });

  const placeSuggestions = usePlaceSuggestions(
    (knownPlaces ?? []).map((place) => place.name),
    items
  );

  const current = items.length ? Math.min(detailIndex, items.length - 1) : 0;

  /*
    Has anything been said about THIS photograph?

    Any one of the four counts, not all of them: the panel's whole argument is
    that every field is optional, and a sheet that only ticked a photograph
    once all four were filled would quietly contradict it.

    THE INHERITED DATE DOES NOT COUNT, and leaving it in was a real bug caught
    on the first run — every photograph arrives carrying the channel's month
    (`acceptFiles` seeds `taken_on` from it so nobody has to retype the same
    date twenty times), so a freshly dropped set of six reported "6 of 6
    described" and offered to "Carry on" before anyone had typed a word. A
    date that is still exactly the channel's is the channel speaking, not the
    family describing a photograph.
  */
  function hasDetail(item: PendingItem): boolean {
    const ownDate = !!item.taken_on && item.taken_on !== monthDate;
    return !!(item.caption.trim() || item.place.trim() || item.people.length || ownDate);
  }

  const described = items.filter((item) => !item.error && hasDetail(item)).length;
  /* "Carry on" resumes where the work stopped rather than starting the run
     again at a photograph that is already done. */
  const firstUndescribed = Math.max(
    0,
    /* -1 means every one is done; the run then starts at the beginning
       rather than at index -1. */
    items.findIndex((item) => !item.error && !hasDetail(item))
  );

  /** One photograph changed, the rest untouched. */
  function patchItem(index: number, patch: Partial<PendingItem>) {
    setItems((prev) => prev.map((item, j) => (j === index ? { ...item, ...patch } : item)));
  }

  /** Where ‹ › lands from here, wrapping at both ends. */
  function stepped(from: number, delta: number): number {
    return items.length ? (from + delta + items.length) % items.length : 0;
  }

  /*
    A starter set for a family whose archive has no tags yet. The owner's own
    examples, and they stay examples: anything typed becomes a tag, and what
    this archive has already used always sorts above these.
  */
  const TAG_STARTERS = [
    "childhood",
    "holiday",
    "travel",
    "hometown",
    "family",
    "school",
    "work",
    "wedding",
    "summer",
  ];

  const tagSuggestions = useMemo(() => {
    const chosen = new Set(tags.map((t) => t.toLowerCase()));
    const out: string[] = [];
    for (const name of [...(knownTags ?? []).map((t) => t.name), ...TAG_STARTERS]) {
      const key = name.trim().toLowerCase();
      if (!key || chosen.has(key) || out.some((o) => o.toLowerCase() === key)) continue;
      out.push(name.trim());
      if (out.length === 8) break;
    }
    return out;
  }, [knownTags, tags]);

  function addTag(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === name.toLowerCase()) || prev.length >= 8
        ? prev
        : [...prev, name]
    );
    setTagDraft("");
  }

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Percent of the media upload that has left the device, or null outside one.
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  /*
    What the Create pill says while it is working.

    Every button on this page is one word (owner, 17 Sep 2026: "change all the
    buttons, always to maximum one word"). A percentage is not a word, which
    is the point: it is the only thing worth saying during an upload, and
    saying it as a bare figure keeps the label from becoming a sentence.
  */
  const busyLabel =
    uploadPercent !== null && uploadPercent < 100 ? `${uploadPercent}%` : "Creating…";


  useEffect(() => {
    setStatus({ hint: "NEW CHANNEL" });
    return () => setStatus(null);
  }, [setStatus]);

  // Anything already typed or chosen deserves the same care the editor gives
  // it: Cancel asks first, and closing the tab warns.
  const dirty =
    !!title.trim() || !!description.trim() || !!monthDate || items.length > 0 || tags.length > 0;

  useEffect(() => {
    if (!dirty || created || creating) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, created, creating]);

  function requestCancel() {
    if (dirty) setConfirmDiscard(true);
    else navigate("/admin/shelf");
  }

  const {
    data: channels,
    isPending: channelsPending,
    isError: channelsFailed,
    refetch: refetchChannels,
  } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<Channel[]>("/channels"),
  });

  /*
    The same chain M196 closed on the phone, found here by /dev/pages (M199).

    `(channels ?? [])` treats a shelf that failed to load as a shelf with
    nothing on it, so the lowest free number comes out as 1 — the number most
    likely to be taken already. The page then shows "01" with every
    confidence, the family names the memory, drops twenty photographs, writes
    captions for them, and the create is refused. The captions are gone.

    M196 fixed `mobile/AddFlow`, which is the same flow on a phone. This is
    the desktop half, and it went on doing it: proof that fixing one surface
    of a chain is not fixing the chain.

    `null` is the honest answer when the shelf is unknown; the guard below
    refuses to open on it.
  */
  const nextNumber = useMemo(() => {
    if (!channels) return null;
    const taken = new Set(channels.map((c) => c.number));
    for (let n = 1; n <= 99; n++) {
      if (!RESERVED.has(n) && !taken.has(n)) return n;
    }
    return null;
  }, [channels]);

  const isVideo = VIDEO_TYPES.includes(type);
  const number = nextNumber ? String(nextNumber).padStart(2, "0") : "—";
  const mediaWord = type === "stories" ? "one photo" : isVideo ? "videos" : "photos";
  const typeLabel = TYPES.find(([v]) => v === type)?.[1] ?? type;

  function acceptFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []).map((file) => {
      let problem: string | null = null;
      if (isVideo && !file.type.startsWith("video/")) problem = `${file.name} is not a video.`;
      if (!isVideo) problem = fileProblem(file, "image");
      return {
        file,
        preview: URL.createObjectURL(file),
        caption: "",
        // A step in an instruction has no "when" — only memories do.
        taken_on: type === "instruction" ? "" : monthDate,
        /* The channel's own date is a month picker, so a photograph that
           inherits it inherits month precision too (059). Anyone who knows
           the day can say so in the detail panel. */
        precision: "month" as const,
        place: "",
        people: [],
        error: problem,
      };
    });
    /* A voice message carries ONE picture (spec 24b) — it is the room her
       screen shows while the voice plays, not a gallery. Choosing again
       replaces it rather than queueing a second. */
    if (type === "stories") {
      setItems(incoming.slice(0, 1));
      return;
    }
    setItems((prev) => [...prev, ...incoming]);
  }

  async function create() {
    if (!nextNumber) {
      setError("Every number is taken.");
      return;
    }
    if (items.some((i) => i.error)) {
      setError("Remove the rejected files before creating.");
      return;
    }
    if (badMonth(monthDate)) {
      setError("Fix the red date first — year, then month, like 2026-08.");
      return;
    }
    if (items.some((i) => !dateIsWhole(i))) {
      setError("One of the photographs has a half-finished date. Open it and complete it.");
      return;
    }
    setCreating(true);
    setError(null);
    let detailProblem: string | null = null;

    try {
      const channel = await api.post<{ id: string }>("/channels", {
        number: nextNumber,
        title: title.trim(),
        description: description.trim() || null,
        content_type: type,
        date: monthDate ? `${monthDate}-01` : null,
        // The family's own words for what this is about (059). Names, not
        // ids — a tag exists because somebody used it.
        ...(tags.length ? { tags } : {}),
        ...(isAdmin ? { privacy_level: privacy } : {}),
      });

      if (items.length > 0 || (type === "stories" && voice)) {
        const form = new FormData();
        form.set("channel_id", channel.id);
        items.forEach((item) => {
          form.append("files", item.file);
          form.append("captions", item.caption);
          /*
            The date and its precision travel together, always (059). The
            stored value is padded to a whole date because the column holds
            one; `taken_precision` is what stops the display reading the
            padding aloud as though the family had chosen it.
          */
          const when = type !== "instruction" ? wholeDate(item) : "";
          form.append("taken_on", when);
          form.append("taken_precision", when ? item.precision : "");
          form.append("places", type !== "instruction" ? item.place.trim() : "");
          form.append("people", JSON.stringify(type !== "instruction" ? item.people : []));
        });
        /*
          The voice rides in the same request as the picture, so a mid-way
          failure cannot leave the channel half-made. The extension follows
          the blob's own container; the server re-derives the truth from
          magic bytes either way (voice mode, 051).
        */
        if (type === "stories" && voice) {
          const ext = voice.blob.type.includes("ogg") ? "ogg" : voice.blob.type.includes("mp4") ? "m4a" : "webm";
          form.append("files", new File([voice.blob], `voice-message.${ext}`, { type: voice.blob.type }));
          form.append("captions", "");
          form.append("taken_on", "");
          // Every per-file list stays the same length as `files`, or the
          // server lines the wrong caption up with the wrong photograph.
          form.append("taken_precision", "");
          form.append("places", "");
          form.append("people", "[]");
        }
        /*
          The upload answers with what did NOT stick, if anything (059). The
          photographs are never rolled back for a detail — losing twenty
          files because a name failed to attach would be the worse answer —
          so the route says so instead, and this is where it gets said. A
          field nothing reads is worse than no field at all.
        */
        const result = await api.upload<{ count: number; detail_problem?: string }>(
          "/media-files",
          form,
          setUploadPercent
        );
        detailProblem = result?.detail_problem ?? null;
        setUploadPercent(null);
      }

      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({ queryKey: ["suggestions"] });

      // A create-a-memory mission is done the moment the memory exists.
      if (mission) {
        try {
          await api.patch(`/missions/${mission.id}`, { status: "completed" });
          await queryClient.invalidateQueries({ queryKey: ["missions"] });
        } catch {
          /* the channel exists either way */
        }
        items.forEach((item) => URL.revokeObjectURL(item.preview));
        navigate("/admin/missions", { state: { focusId: mission.id } });
        return;
      }

      /*
       * The cream moment reports the real post-create state (2e). The cover
       * object-URL stays alive for the tile beside the card; everything is
       * revoked when this page unmounts.
       */
      setCreated({
        id: channel.id,
        number,
        title: title.trim(),
        typeLabel,
        isVideo,
        count: items.length,
        undescribed: items.filter((i) => !i.caption.trim()).length,
        privacy: privacyWord(isAdmin ? privacy : 3),
        monthText: monthLabel(monthDate),
        cover: items[0]?.preview ?? null,
        detailProblem,
      });
      setCreating(false);
    } catch (err) {
      setCreating(false);
      setUploadPercent(null);
      setError(err instanceof Error ? err.message : "The channel could not be created.");
      /*
        Re-read the shelf before they press it again (M196).

        If two people created a channel at the same moment, one of them was
        refused for a number that is now genuinely taken — and pressing
        again would post the very same number, because `nextNumber` was
        computed from the shelf as it was. The work is safe in component
        state either way; without this, the retry is not.
      */
      void refetchChannels();
    }
  }

  // Object URLs live for the page, die with it.
  useEffect(() => {
    return () => {
      items.forEach((item) => URL.revokeObjectURL(item.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────── 2e · the cream moment
  if (created) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center gap-4 overflow-hidden px-8">
        <div
          className="flex w-[560px] max-w-full flex-col rounded-[26px] p-9 pb-[30px]"
          style={{ background: "#EFEAE2", color: "#1A1917" }}
        >
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "var(--accent)" }}
          >
            <Check size={22} strokeWidth={2.4} color="#fff" aria-hidden />
          </span>
          <p className="mt-[22px] text-[36px] font-light leading-[1.15]" style={{ letterSpacing: "-.01em" }}>
            Channel {created.number} is on the shelf
          </p>
          <p className="mt-3 text-[14px] leading-[1.55]" style={{ color: "rgba(26,25,23,.65)" }}>
            {created.title} · {created.typeLabel}
            {created.count > 0 &&
              ` · ${created.count} ${created.isVideo ? (created.count === 1 ? "film" : "films") : created.count === 1 ? "photograph" : "photographs"}`}{" "}
            · visible to {created.privacy}. It joins the rotation the next time{" "}
            {subject ?? "the family"} changes channels.
          </p>
          {created.detailProblem && (
            <div
              className="mt-[22px] flex items-center gap-2 rounded-[14px] px-4 py-3"
              style={{ background: "rgba(150,40,30,.1)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1A1917" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.5v.01" />
              </svg>
              <span className="text-[12px] leading-[1.45]" style={{ color: "rgba(26,25,23,.85)" }}>
                {created.detailProblem} You can add them again from the channel.
              </span>
            </div>
          )}

          {created.undescribed > 0 && (
            <div
              className="mt-[22px] flex items-center gap-2 rounded-[14px] px-4 py-3"
              style={{ background: "rgba(0,0,0,.06)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1A1917" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {/* No invented assignee: the suggestion engine files it for the
                  family, and whoever takes it takes it. */}
              <span className="text-[12px] leading-[1.45]" style={{ color: "rgba(26,25,23,.75)" }}>
                {created.undescribed} {created.undescribed === 1 ? "photo has" : "photos have"} no
                description yet — saved as a suggested mission.
              </span>
            </div>
          )}
          <div className="mt-[26px] flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => navigate("/admin/cards")}
              className="rounded-full px-6 py-3.5 text-[13px] font-medium"
              style={{ background: "#1A1917", color: "#F2F1EE" }}
            >
              Link an NFC card
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/shelf")}
              className="rounded-full px-[22px] py-3.5 text-[13px] font-medium"
              style={{ border: "1px solid rgba(0,0,0,.2)", color: "#1A1917" }}
            >
              Back to the shelf
            </button>
            <button
              type="button"
              onClick={() => navigate(`/admin/channels/${created.id}/preview`)}
              className="ml-auto text-[12px]"
              style={{ color: "rgba(26,25,23,.55)" }}
            >
              Play it now →
            </button>
          </div>
        </div>

        {/* The real tile, wearing its NEW badge. */}
        <div
          className="relative hidden h-[420px] w-[340px] flex-none overflow-hidden rounded-[26px] lg:block"
          style={{ border: "1px solid rgba(var(--accent-channels),.55)" }}
        >
          {created.cover ? (
            created.isVideo ? (
              <video src={created.cover} muted className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <img src={created.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )
          ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-[rgba(var(--ink),0.03)]">
              <ImageIcon className="h-7 w-7" style={{ color: "rgba(var(--ink-cream),.3)" }} aria-hidden />
            </span>
          )}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(11,11,12,.85), rgba(11,11,12,.2) 48%, transparent 68%)",
            }}
          />
          <div className="on-media absolute left-3.5 right-3.5 top-3.5 flex items-center justify-between">
            <span
              className="rounded-[9px] px-2.5 py-[7px] font-mono text-[12px] leading-none"
              style={{ background: "rgba(11,11,12,.55)", color: "rgba(var(--ink-cream),.9)" }}
            >
              {created.number}
            </span>
            <span
              className="rounded-full px-3 py-[7px] font-mono text-[9px] leading-none tracking-[0.13em]"
              style={{ background: "rgba(11,11,12,.55)", color: "var(--accent-soft)" }}
            >
              NEW
            </span>
          </div>
          <div className="on-media absolute bottom-[18px] left-5 right-5">
            <p className="text-[21px] font-semibold leading-[1.15]" style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em" }}>
              {created.title}
            </p>
            <p className="mt-1.5 text-[12px]" style={{ color: "rgba(var(--ink-cream),.75)" }}>
              {created.typeLabel}
              {created.count > 0 && ` · ${created.count} ${created.isVideo ? "films" : "photographs"}`}
              {created.monthText && ` · ${created.monthText}`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /*
    The door, before any of the work (M196's other half).

    Everything past this point asks the family to invest something — a
    title, a date, twenty photographs, a caption for each — and all of it is
    lost if the number the page chose turns out to be taken. So the refusal
    is here rather than as a courteous 409 at the end, because a courteous
    failure at the end still costs them the captions.

    It refuses on *pending* as well as on failure. A shelf that has not
    answered yet is not an empty shelf either — that is the same
    non-answer M191 found on `/owner`, and it produces exactly the same
    wrong number.
  */
  if (channelsPending || channelsFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-[17px]">
          {channelsPending ? "Opening…" : "Your memories could not be loaded"}
        </p>
        {channelsFailed && (
          <>
            <p className="max-w-[380px] text-[13px] leading-[1.6] text-fg-muted">
              Creating one now could clash with a channel that is already there, so this waits
              until the shelf can be read. Nothing has been changed.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void refetchChannels()}
                className="pressable rounded-full px-5 py-2.5 text-[13px]"
                style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={requestCancel}
                className="pressable rounded-full border border-line px-5 py-2.5 text-[13px]"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  /*
    The way out, and the way back.

    On step 1 the circle cancels the whole thing; after that it walks one step
    back. There is no second Cancel in the form's own footer any more (owner,
    17 Sep 2026: "you can remove the cancel") — one way out, in the place
    every other page in the workspace puts it.
  */
  function goBack() {
    if (step === 1) requestCancel();
    else setStep((step - 1) as 1 | 2);
  }

  /* Step 3 is a run through the photographs, so it cannot be reached before
     there are any. */
  const reachable: 1 | 2 | 3 = !title.trim() ? 1 : items.length ? 3 : 2;

  const stepper = (
    <Steps
      current={step}
      reachable={reachable}
      onGo={(n) => {
        setStep(n);
        if (n === 3) setDetailIndex(0);
      }}
    />
  );

  // ───────────────────────────────────────────────── the three form steps
  const header =
    step === 1 ? (
      <div className="flex flex-none items-end justify-between gap-6">
        <div className="flex items-center gap-[18px]">
          <BackCircle onClick={goBack} label="Cancel and go back" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[34px] font-light leading-none" style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em" }}>
                Create a channel
              </h1>
              <span
                className="rounded-[9px] px-2.5 py-2 font-mono text-[13px] font-medium leading-none"
                style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}
              >
                {number}
              </span>
            </div>
            <p className="mt-2.5 text-[13px] leading-none" style={{ color: "var(--fg-soft)" }}>
              The number is assigned automatically — it stays with the channel forever.
            </p>
          </div>
        </div>
        {stepper}
      </div>
    ) : (
      <div className="flex flex-none items-end justify-between gap-6">
        <div className="flex min-w-0 items-center gap-[18px]">
          <BackCircle onClick={goBack} label={step === 2 ? "Back to the channel" : "Back to the photographs"} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="flex-none rounded-[9px] px-2.5 py-2 font-mono text-[13px] font-medium leading-none"
                style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}
              >
                {number}
              </span>
              <h1 className="max-w-xl truncate text-[34px] font-light leading-none" style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em" }}>
                {title.trim()}
              </h1>
              <span
                className="hidden flex-none rounded-full px-3.5 py-[7px] text-[12px] leading-none lg:block"
                style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.75)" }}
              >
                {typeLabel.toLowerCase()}
              </span>
            </div>
            <p className="mt-2.5 truncate text-[13px] leading-none" style={{ color: "var(--fg-soft)" }}>
              {[monthLabel(monthDate), `visible to ${privacyWord(isAdmin ? privacy : 3)}`, "not on the shelf yet"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        {stepper}
      </div>
    );

  return (
    /*
      The roster line, not the workspace one (owner, 17 Sep 2026: "the create
      channel does not need all this white space underneath the title… just
      having the same height as all the others — contributors is a better
      example"). This page has no control row to fill a 184px band, so it
      declared one anyway and left 115px of air under the title while the form
      beneath it scrolled. `roster` is the kit's own name for exactly that:
      no controls, so the content starts on the higher line. It is the same
      number Contributors stands on, not a new one.
    */
    <PageFrame type="roster" header={header}>
      {mission && (
        <MissionBanner
          title={mission.title}
          instruction="Create this channel and add the memory — creating it finishes the mission."
          onExit={() => navigate(location.pathname, { replace: true, state: {} })}
        />
      )}

      {/* ── 2c · step 1: the channel, beside what it becomes ─────────────── */}
      {step === 1 && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_430px]">
          <div
            /* `overflow-y-auto` is the seatbelt for a very short window, not
               the plan: every row below is sized so the whole form — and the
               button with it — stands on one screen (owner: "I don't want the
               elements to be a scroll").

               A FLEX COLUMN holding a grid, rather than one grid holding
               everything, so the footer can take `mt-auto` and sit on the
               panel's floor. As a grid row it sat wherever the fields
               stopped, with a hand's width of empty panel under it. */
            className="scroll-thin box-border flex flex-col overflow-y-auto rounded-[26px] p-5"
            style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
          >
            {/*
              Three rows, and the last one takes whatever is left.

              The owner's question was "is there another design we can do to
              fill this in a little bit less awkward situation — there's quite
              a lot of empty space." There was: the form needed about 390px in
              a 531px panel, so it sat in the top two thirds with a void under
              it. The answer is not filler, it is giving the room to the one
              field that can use it. A channel description is the only
              free-form thing on this step — a summer, a place, a person — so
              it grows into the space instead of a gap doing nothing.

              It stops at 300px. Past that a description box stops reading as
              generous and starts reading as a mistake, and on a tall monitor
              the rest of the slack collects above the button.
            */}
            <div className="grid min-h-0 flex-1 gap-x-[22px] gap-y-4 sm:grid-cols-2 sm:grid-rows-[auto_auto_minmax(0,1fr)]">
            <label>
              <span className="flex justify-between">
                <span className={LABEL} style={LABEL_COLOR}>
                  TITLE *
                </span>
                <span className={COUNTER}>
                  {title.length}/{TITLE_MAX}
                </span>
              </span>
              <input
                ref={titleField}
                autoFocus
                maxLength={TITLE_MAX}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={FIELD}
                style={FIELD_STYLE}
              />
            </label>

            <div>
              <span className={LABEL} style={LABEL_COLOR}>
                TYPE
              </span>
              <div
                className="mt-2 flex h-12 gap-1 rounded-full p-1"
                style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.14)" }}
              >
                {TYPES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    className="pressable flex-1 rounded-full text-[12px]"
                    style={
                      type === value
                        ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                        : { color: "rgba(var(--ink-cream),.7)" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={LABEL} style={LABEL_COLOR}>
                DATE *
              </span>
              <input
                ref={dateField}
                type="month"
                placeholder="A month or a year is enough"
                max={new Date().toISOString().slice(0, 7)}
                value={monthDate}
                onChange={(e) => setMonthDate(e.target.value)}
                className={FIELD}
                style={
                  badMonth(monthDate)
                    ? { ...FIELD_STYLE, border: "1px solid var(--destructive-soft)" }
                    : FIELD_STYLE
                }
              />
              {/* The hint used to sit here permanently, saying "a month or a
                  year is enough" to everyone forever. It is in the field's
                  own placeholder now, and this line speaks only when the
                  date is wrong — which is the only time it was ever news. */}
              {badMonth(monthDate) && (
                <p className="mt-[7px] text-[11px] leading-[1.4]" style={{ color: "var(--destructive-soft)" }}>
                  Write it as year, then month — like 2026-08.
                </p>
              )}
            </div>

            {isAdmin && (
              <div>
                <span className={LABEL} style={LABEL_COLOR}>
                  WHO CAN SEE THIS MEMORY
                </span>
                <div className="mt-2 flex gap-2">
                  {PRIVACY.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPrivacy(option.value)}
                      className="pressable flex-1 rounded-full py-3.5 text-center text-[13px]"
                      style={
                        privacy === option.value
                          ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                          : { border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.75)" }
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-col">
              <span className="flex flex-none items-center justify-between gap-2">
                <label className={LABEL} style={LABEL_COLOR} htmlFor="channel-description">
                  CHANNEL DESCRIPTION
                </label>
                <span className={COUNTER}>
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              </span>
              {/* Speak it instead (owner: "add a little dictation microphone
                  to the description"), from inside the box's lower-right
                  corner. It wears the family's accent, so it is green here
                  and blue next door.

                  THE INSETS ARE THE BOX'S OWN PADDING, on both axes, so the
                  circle sits on exactly the margin the text sits on. And the
                  textarea is `block`: as an inline element it left about 4px
                  of baseline descender inside this wrapper, so `bottom` was
                  measured from below the box and the circle came out 10px
                  from the right edge but 3px from the bottom one — the
                  lopsided corner the owner pointed at. */}
              <div className="relative mt-2 min-h-0 flex-1 sm:max-h-[300px]">
                <textarea
                  id="channel-description"
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this channel about? A summer, a place, a person…"
                  className="block h-full min-h-[132px] w-full resize-none rounded-[12px] p-3.5 pr-[52px] text-sm leading-[1.6] outline-none placeholder:font-light placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)] focus:border-accent"
                  style={FIELD_STYLE}
                />
                <span className="absolute bottom-3.5 right-3.5">
                  <Dictate
                    onText={(phrase) =>
                      setDescription((prev) => appendPhrase(prev, phrase, DESCRIPTION_MAX))
                    }
                    title="Dictate the channel description"
                  />
                </span>
              </div>
            </div>

            {/*
              What it is about, in the family's own words (059).

              The owner's brief was exact about the mechanism: "childhood,
              holiday, travel, hometown — the user can create its own tag." So
              there is no fixed list and no dropdown to open first; you type
              the word and it exists. What the archive has already used is
              offered underneath, because the value of a tag is that the same
              word comes back, and a word nobody can find again is a new word
              every time.
            */}
            <div className="min-h-0 self-start">
              <span className={LABEL} style={LABEL_COLOR}>
                WHAT IT'S ABOUT
              </span>

              <div
                className="mt-2 flex min-h-12 flex-wrap items-center gap-1.5 rounded-[12px] px-2.5 py-2"
                style={FIELD_STYLE}
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-[12px]"
                    style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
                  >
                    <span className="max-w-[160px] truncate">{tag}</span>
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                      aria-label={`Remove ${tag}`}
                      className="flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: "rgba(0,0,0,.18)" }}
                    >
                      <X className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  </span>
                ))}
                <input
                  value={tagDraft}
                  maxLength={40}
                  disabled={tags.length >= 8}
                  placeholder={
                    tags.length
                      ? "Another word, then Enter…"
                      : "childhood, holiday, travel… type one and press Enter"
                  }
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    /* Enter and comma both finish a word — whichever a
                       person reaches for. Backspace on an empty box takes
                       the last one back, the way every chip field does. */
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagDraft);
                    } else if (e.key === "Backspace" && !tagDraft) {
                      setTags((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => addTag(tagDraft)}
                  className="min-w-[160px] flex-1 bg-transparent px-1.5 py-1 text-[14px] outline-none placeholder:font-light placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
                  style={{ color: "var(--cream, #F2F1EE)" }}
                />
              </div>

              {/*
                Words to press instead of type (owner, 17 Sep 2026: "give
                suggestion tabs").

                THE ARCHIVE'S OWN WORDS COME FIRST and the starter set fills
                what is left, which matters on the day a family creates their
                second channel: the value of a tag is that the same word comes
                back, and a field that offers only house words teaches people
                to invent a new one every time. Before there is any history
                the panel would otherwise be blank, and a blank suggestion row
                is how an optional field reads as one nobody uses.
              */}
              {tagSuggestions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {tagSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => addTag(name)}
                      className="pressable rounded-full px-2.5 py-1 text-[12px]"
                      style={{ border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

            </div>
            </div>

            {/*
              The footer is one row and one button now.

              Cancel is gone: the back circle in the header cancels, and a
              second way out sitting beside the primary action is the thing
              the owner asked to have removed. "A date first" is gone with it
              — the sentence used to stand between the two, explaining a dead
              control.

              WHICH MEANS THE BUTTON HAD TO STOP BEING DEAD. F42's rule is
              that a blocked button says what it is waiting for; it said it in
              a sentence beside itself. Now the button is always pressable and
              answers on the press: it names the field and puts the cursor in
              it. The trade is honest and worth saying out loud — you learn
              what is missing one press later than you used to.
            */}
            <div className="mt-auto flex flex-none items-center justify-between gap-4 pt-5">
              {confirmDiscard ? (
                /* Asked by the back circle, answered here — in the row that
                   was already there, so nothing moves when it appears. */
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span style={{ color: "var(--fg-muted)" }}>Discard this channel?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                    className="pressable rounded-full px-3.5 py-1.5"
                    style={{ border: "1px solid rgba(var(--ink),.2)", color: "var(--fg-soft)" }}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/admin/shelf")}
                    className="pressable rounded-full px-3.5 py-1.5"
                    style={{ border: "1px solid var(--destructive-soft)", color: "var(--destructive-soft)" }}
                  >
                    Discard
                  </button>
                </span>
              ) : (
                <p
                  role="alert"
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ color: "var(--destructive-soft)", visibility: error ? "visible" : "hidden" }}
                >
                  {error || " "}
                </p>
              )}
              <PrimaryPill
                onClick={() => {
                  if (!title.trim()) {
                    setError("This channel needs a title before the photographs.");
                    titleField.current?.focus();
                    return;
                  }
                  if (!monthDate || badMonth(monthDate)) {
                    setError("This channel needs a date — a month or a year is enough.");
                    dateField.current?.focus();
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
              >
                Next
              </PrimaryPill>
            </div>
          </div>

          {/* The live shelf preview: exactly what lands on the shelf. */}
          <div
            className="box-border hidden flex-col rounded-[26px] px-6 py-[22px] lg:flex"
            style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
          >
            <span className={CAPS} style={LABEL_COLOR}>
              ON THE SHELF IT BECOMES
            </span>
            <div
              className="relative mt-3.5 min-h-0 flex-1 overflow-hidden rounded-[18px]"
              style={{ border: "1px solid rgba(var(--ink),.1)" }}
            >
              {items[0] && !isVideo ? (
                <img src={items[0].preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[13px] italic" style={{ color: "rgba(var(--ink-cream),.4)" }}>
                  {isVideo ? "The film becomes the cover" : "First photo becomes the cover"}
                </span>
              )}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top, rgba(11,11,12,.85), rgba(11,11,12,.2) 48%, transparent 68%)",
                }}
              />
              <span
                className="on-media absolute left-3.5 top-3.5 rounded-[9px] px-2.5 py-[7px] font-mono text-[12px] leading-none"
                style={{ background: "rgba(11,11,12,.55)", color: "rgba(var(--ink-cream),.9)" }}
              >
                {number}
              </span>
              <div className="on-media absolute bottom-[18px] left-5 right-5">
                <p
                  className="text-[21px] font-semibold leading-[1.15]"
                  style={{
                    color: title.trim() ? "var(--cream, #F2F1EE)" : "rgba(var(--ink-cream),.4)",
                    letterSpacing: "-.01em",
                  }}
                >
                  {title.trim() || "Untitled"}
                </p>
                <p className="mt-1.5 text-[12px]" style={{ color: "rgba(var(--ink-cream),.75)" }}>
                  {[typeLabel, monthLabel(monthDate), privacyWord(isAdmin ? privacy : 3)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <p
              className="mt-4 border-t border-dashed pt-3.5 text-[12px] leading-[1.5]"
              style={{ borderColor: "rgba(var(--ink),.14)", color: "var(--fg-soft)" }}
            >
              {subject ?? "She"} hears the title read aloud when she opens it — write it the way
              she'd say it.
            </p>
          </div>
        </div>
      )}

      {/* ── 2d · step 2: the photographs ─────────────────────────────────── */}
      {step === 2 && (
        <div
          /* The same 20px inset step 1 uses, so Next lands the same distance
             from its panel's corner on both steps — "they all have a fixed
             logic position." */
          className="box-border flex min-h-0 flex-1 flex-col gap-3 rounded-[26px] p-5"
          style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
        >
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              acceptFiles(e.dataTransfer.files);
            }}
            /* It is a big target when the list is empty and a slim bar once
               it is not (owner: "there's a lot of white space"). The page is
               for the photographs; the invitation to add more should not keep
               a third of the height after they are in. */
            /* It is the whole room when the list is empty and a slim bar
               once it is not (owner: "there's a lot of white space"). An
               empty page used to be a small dashed box with two thirds of
               the panel blank underneath it; now the invitation is the page,
               and the moment a photograph lands it steps out of the way. */
            className={`pressable flex cursor-pointer items-center justify-center gap-3 rounded-[16px] ${
              items.length ? "flex-none flex-row py-2.5" : "min-h-0 flex-1 flex-col p-[18px]"
            }`}
            style={{
              border: `1px dashed rgba(var(--ink),${dragOver ? ".6" : ".25"})`,
              background: dragOver ? "rgba(var(--accent-channels),.08)" : undefined,
            }}
          >
            <Camera
              className={`${items.length ? "h-[18px] w-[18px]" : "h-7 w-7"} text-[color:rgba(var(--ink),0.6)]`}
              strokeWidth={1.7}
              aria-hidden
            />
            <span className="text-sm text-[color:rgba(var(--ink),0.7)]">
              Drop {mediaWord} here, or <span style={{ color: "var(--accent-soft)" }}>browse</span>
            </span>
            {items.length === 0 && (
              <span className="text-[12px]" style={{ color: "var(--fg-quiet)" }}>
                A channel can also start empty.
              </span>
            )}
            <input
              type="file"
              multiple={!isVideo && type !== "stories"}
              accept={isVideo ? VIDEO_ACCEPT : IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                acceptFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {/* ── The voice (spec 24b) ─────────────────────────────────────
              Record here, or bring a file. The recording is an option — the
              owner's word — so nothing below blocks Create; a channel made
              without a voice simply waits for one. */}
          {type === "stories" && (
            <div
              className="flex-none rounded-[16px] p-[18px]"
              style={{ border: "1px solid rgba(var(--ink),.14)", background: "rgba(var(--ink),.04)" }}
            >
              <span className={CAPS} style={LABEL_COLOR}>
                VOICE MESSAGE
              </span>

              {voice ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {/* The proof is listening to it, not a filename. */}
                  <audio controls src={voice.url} className="h-10 max-w-full" />
                  <button
                    type="button"
                    onClick={() => setVoice(null)}
                    className="pressable rounded-full px-4 py-2 text-[13px]"
                    style={{ border: "1px solid rgba(var(--ink),.2)", color: "rgba(var(--ink-cream),.8)" }}
                  >
                    Again
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    className="pressable flex items-center gap-2.5 rounded-full px-5 py-2.5 text-[14px] font-medium"
                    style={
                      recording
                        ? { background: "var(--destructive)", color: "#fff" }
                        : { background: "var(--chip-on)", color: "var(--on-chip-on)" }
                    }
                  >
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{
                        background: recording ? "#fff" : "var(--destructive)",
                        animation: recording ? "pulse 1.2s ease infinite" : undefined,
                      }}
                    />
                    {recording
                      ? `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`
                      : "Record"}
                  </button>

                  <label className="pressable cursor-pointer rounded-full px-4 py-2.5 text-[13px]"
                    style={{ border: "1px solid rgba(var(--ink),.2)", color: "rgba(var(--ink-cream),.8)" }}
                  >
                    Upload
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setVoice({ blob: file, url: URL.createObjectURL(file) });
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              )}

              {micProblem && (
                <p className="mt-2 text-[13px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
                  {micProblem}
                </p>
              )}
              <p className="mt-2 text-[12px]" style={{ color: "var(--fg-quiet)" }}>
                Her screen shows the photo while the voice plays. You can add or replace the
                recording later.
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <span className={CAPS} style={LABEL_COLOR}>
                {mediaWord.toUpperCase()} — {items.length}
              </span>
              <span className="truncate text-[12px]" style={{ color: "var(--fg-dim)" }}>
                {described} of {items.length} described
              </span>
            </div>
          )}

          {/*
            What has been said so far, one row per photograph (owner, 17 Sep
            2026: "they could manually see the pictures and the descriptions
            like we previously designed, but they will have the option to
            press again on it").

            THE ROWS DO NOT EDIT ANYTHING. That is the difference from the
            version this replaces, which put a live textarea in every row —
            two places to write the same description, and a panel twice as
            tall as the window. Here the row SHOWS what the pop-up wrote and
            opens the pop-up again when you press it, so there is exactly one
            place a description is typed and one place it is read back.
          */}
          {items.length > 0 && (
            <div className="scroll-thin ring-room grid min-h-0 flex-initial content-start gap-2.5 overflow-y-auto pr-1 lg:grid-cols-2">
              {items.map((item, index) => {
                const summary = detailSummary(item, people ?? []);
                return (
                  <div
                    key={item.preview}
                    className="group relative flex items-center gap-3 rounded-[16px] p-2 pr-10"
                    style={
                      item.error
                        ? { border: "1px solid var(--destructive-soft)" }
                        : { border: "1px solid rgba(var(--ink),.1)", background: "rgba(var(--ink),.04)" }
                    }
                  >
                    {item.error ? (
                      <p className="flex-1 px-1.5 text-[12px] leading-[1.4] text-destructive-soft">
                        {item.error}
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDetailIndex(index);
                          setStep(3);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="relative h-[58px] w-[58px] flex-none overflow-hidden rounded-[10px]">
                          {isVideo ? (
                            <video src={item.preview} muted className="h-full w-full object-cover" />
                          ) : (
                            <img src={item.preview} alt="" className="h-full w-full object-cover" />
                          )}
                          <span
                            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            style={{ background: "rgba(0,0,0,.5)" }}
                          >
                            <Maximize2 size={14} strokeWidth={2} color="#fff" aria-hidden />
                          </span>
                        </span>

                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className="truncate text-[13px] leading-[1.4]"
                            style={
                              item.caption.trim()
                                ? { color: "var(--cream, #F2F1EE)" }
                                : { color: "var(--fg-quiet)", fontStyle: "italic" }
                            }
                          >
                            {item.caption.trim() || "No description yet"}
                          </span>
                          <span
                            className="truncate text-[11px]"
                            style={{ color: summary.length ? "var(--fg-soft)" : "var(--accent-soft)" }}
                          >
                            {summary.length ? summary.join(" · ") : "Add when, where, who…"}
                          </span>
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(item.preview);
                        setItems((prev) => prev.filter((_, j) => j !== index));
                        setDetailIndex((cur) => (cur > index ? cur - 1 : cur));
                      }}
                      aria-label="Remove this file"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:rgba(var(--ink),0.45)] transition-colors hover:text-fg"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/*
            The invitation into step 3 (owner, 17 Sep 2026): "you have an
            explanation that says for every picture we will be asking a more
            detailed description — are you ready to get started."

            It is the only thing standing between the photographs and the
            descriptions, and it is a question rather than a wall: the footer's
            Create is still there for a family who wants the pictures up today
            and the words next Sunday.
          */}
          {step === 2 && items.length > 0 && (
            <div
              className="flex-none rounded-[16px] px-4 py-3"
              style={{ border: "1px solid rgba(var(--accent-channels),.35)", background: "rgba(var(--accent-channels),.06)" }}
            >
              <p className="text-[13px] leading-[1.5]" style={{ color: "var(--fg-soft)" }}>
                For every {mediaWord.slice(0, -1)} we will ask for a little more — a
                description, when it was taken, where it was and who is in it.{" "}
                <span style={{ color: "var(--cream, #F2F1EE)" }}>
                  {described === 0
                    ? "Ready to get started?"
                    : described === items.length
                      ? "All of them have something — go back through any of them by pressing it."
                      : `${items.length - described} still to go — or press any one of them.`}
                </span>
              </p>
            </div>
          )}

          {/*
            ONE BUTTON (owner, 17 Sep 2026: "no need for 2 different buttons
            — add descriptions = to next step, cannot create channel without
            description").

            Create used to sit here beside "Get started", which made the
            descriptions a side road with a shortcut past it. The forward
            action on this step is the next step, in the same corner step 1
            puts its own, and Create now exists in exactly one place: the end
            of the run, when the last photograph has been through the panel.

            An EMPTY channel is still allowed — "a channel can also start
            empty" is the dropzone's own promise — so with nothing to describe
            this button is Create, because there is no step 3 to walk.

            `mt-auto` collects whatever room is left over above it, so
            everything else stacks from the top.
          */}
          <div className="mt-auto flex flex-none items-center justify-between gap-4">
            <p
              role="alert"
              className="min-w-0 flex-1 truncate text-[13px]"
              style={{ color: "var(--destructive-soft)", visibility: error ? "visible" : "hidden" }}
            >
              {error || " "}
            </p>
            {items.length > 0 ? (
              <PrimaryPill
                onClick={() => {
                  setDetailIndex(firstUndescribed);
                  setStep(3);
                }}
              >
                Next
              </PrimaryPill>
            ) : (
              <PrimaryPill disabled={creating} onClick={() => void create()}>
                {creating ? busyLabel : "Create"}
              </PrimaryPill>
            )}
          </div>
        </div>
      )}

      {/*
        Step 3 — the run (owner, 17 Sep 2026: "if you get started then the
        pop-up starts").

        The same panel that has always been here, walked from the first
        photograph to the last with the count standing big on its left. The
        contact sheet stays behind it, so closing is always a step back into
        something rather than out of everything.
      */}
      {step === 3 && items[current] && !items[current].error && (
        <PhotoDetailModal
          item={items[current]}
          index={current}
          total={items.length}
          people={people ?? []}
          places={placeSuggestions}
          isVideo={isVideo}
          onChange={(patch) => patchItem(current, patch)}
          onStep={(delta) => setDetailIndex(stepped(current, delta))}
          onClose={() => setStep(2)}
          footer={
            /*
              One button, like everywhere else on this page. The way back out
              is the circle above the pop-up and the way back one photograph
              is the ‹ at the top of this column, so a third control down here
              was two more than the step needs.

              The end of the run is the end of the job: the last Next IS
              Create, because Create does not exist anywhere else any more.
            */
            <div className="flex items-center justify-end">
              {current === items.length - 1 ? (
                <PrimaryPill disabled={creating} onClick={() => void create()}>
                  {creating ? busyLabel : "Create"}
                </PrimaryPill>
              ) : (
                /* No arrow on it: the ‹ › pair at the top of this column is
                   already the arrow, and a third one on the button was the
                   owner's "Next does not need another arrow". */
                <PrimaryPill onClick={() => setDetailIndex(current + 1)}>Next</PrimaryPill>
              )}
            </div>
          }
        />
      )}

    </PageFrame>
  );
}
