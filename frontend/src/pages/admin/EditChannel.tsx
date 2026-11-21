import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMissions } from "@/hooks/useAdminData";
import { MissionBubble } from "@/components/admin/MissionBanner";
import { GuidedSequence } from "@/components/admin/GuidedSequence";
import { ChannelReadOnly } from "./ChannelReadOnly";
import { X, GripVertical, ImageIcon, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { isGenuinelyMissing } from "@/lib/missingOrUnreachable";
import { SuccessScreen } from "@/components/admin/SuccessScreen";
import { fileProblem, IMAGE_ACCEPT, VIDEO_ACCEPT } from "@/lib/mediaTypes";
import type { Author, ChannelWithMedia, MediaFile } from "@/types";
import { listState } from "@/lib/listState";

/**
 * The channel editor, frame 12a: the metadata keeps the left column, and
 * every photograph becomes a row of its own on the right — drag dots, the
 * picture, its description, and the way out. A photo's words are edited
 * where the photo is, not in a separate place.
 */

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";
const COUNTER = "font-mono text-[10px] text-[color:rgba(var(--ink),0.3)]";
const INPUT =
  "mt-2 w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent";
const BORDER = { borderColor: "rgba(var(--ink),.22)" };

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const CAPTION_MAX = 200;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const PRIVACY = [
  { value: 1, label: "Private", hint: "Subject and administrators" },
  { value: 2, label: "Chosen", hint: "Plus the chosen co-authors" },
  { value: 3, label: "Everyone", hint: "Every profile" },
] as const;

interface PendingFile {
  file: File;
  preview: string;
  caption: string;
  error: string | null;
}

/**
 * A quick client-side check so an obvious mistake fails instantly. It does not
 * decide — the server reads the magic bytes and has the final say — so a file
 * the browser cannot label is passed along rather than turned away.
 */
function validateNewFile(file: File, isVideoChannel: boolean): string | null {
  const problem = fileProblem(file, isVideoChannel ? "video" : "image");
  if (problem) return problem;

  if (!isVideoChannel && file.size > IMAGE_MAX_BYTES) {
    return `${file.name} is too large (${(file.size / 1024 / 1024).toFixed(0)} MB — 20 MB max).`;
  }
  return null;
}

export function EditChannel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const { setStatus } = useDisplay();

  // Editable fields
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<1 | 2 | 3>(3);
  const [grantedIds, setGrantedIds] = useState<string[]>([]);

  // Media state — each photo carries its own words now.
  const [mediaOrder, setMediaOrder] = useState<MediaFile[]>([]);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [removing, setRemoving] = useState<MediaFile | null>(null);
  const dragIndex = useRef<number | null>(null);

  // Flow state
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; date?: string }>({});

  const baseline = useRef<string>("");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ── Mission mode (frame 13b) ─────────────────────────────────────────
  // Arriving from a mission, the page becomes the mission: everything not
  // part of it rests, the rows still waiting pulse, and a popup names the
  // step. Escape hands the page back.
  const missionId = (location.state as { missionId?: string } | null)?.missionId ?? null;
  const { data: allMissions } = useMissions();
  const mission = missionId
    ? (allMissions ?? []).find((m) => m.id === missionId && m.status !== "completed")
    : undefined;
  const missionMode = !!mission && mission.task_kind === "describe_photos";
  // A mission asking for new material in this channel: the drop zone is the
  // work, and the save that adds the files concludes it.
  const uploadMission =
    !!mission && (mission.task_kind === "add_photos" || mission.task_kind === "record");
  // Recall's description findings point at the description field itself.
  const isDescriptionMission =
    !!mission &&
    mission.task_kind === "custom" &&
    (mission.rule_key === "missing_description" || mission.rule_key === "short_description");
  // Any other human-written task about this channel: the whole editor is the
  // workspace, and saving it concludes the mission.
  const customMission = !!mission && mission.task_kind === "custom" && !isDescriptionMission;
  const guided = missionMode || uploadMission || isDescriptionMission || customMission;
  const veiled = missionMode || uploadMission || isDescriptionMission;
  const missionTargets = useRef<string[] | null>(null);

  /*
   * An add-photos mission is two phases, and the transition is automatic
   * (M39, after the owner walked it).
   *
   * What he hit: the popup said "add the photos", he added nine, and nothing
   * ever changed. No count, no step, no description asked for, and — his
   * words — "there is no next". A mission that names a number has to show
   * the number, and then has to move on by itself when it is met, because
   * there is no button to hunt for that would do it.
   *
   *   Phase 1, add:      "Add at least 4 photos — 0 of 4", counting up.
   *   Phase 2, describe: the added photos, one at a time.
   *
   * The count is of photos added *now*. Four already in the channel plus
   * nine new ones must not read as "done at four" — the mission asked for
   * new ones. `task_count` is the target, from the row, never a constant.
   */
  const missionTarget = uploadMission ? Math.max(1, mission?.task_count ?? 1) : 0;
  const [describing, setDescribing] = useState(false);
  const [describeIndex, setDescribeIndex] = useState(0);

  /*
    The photo-remove confirm learns the M96 idiom (F26).

    It predates that mission and never got its Escape: Cancel worked, the key
    did not. A window listener rather than a local handler, for the reason
    M96 found — the confirm replaces the control that opened it, so focus is
    left on a node that no longer exists.
  */
  useEffect(() => {
    if (!removing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRemoving(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removing]);

  useEffect(() => {
    if (!guided) return;
    document.body.classList.add("mission-mode");
    const exit = () => navigate(location.pathname, { replace: true, state: {} });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    /*
     * A press outside the mission's own work ends it — the phone's Escape,
     * and the owner's rule: "if we press outside of the desired or required
     * action, it stops the mission."
     *
     * Only where there *is* an outside. `veiled` is what draws that line: a
     * describe/add/description mission dims the rest of the page, so
     * everything beyond the lit part is plainly not the work. A **custom**
     * mission is deliberately unveiled because the whole editor is the work
     * — and there only Save carries `mission-lift`, so this listener would
     * have ended the mission the moment somebody clicked the title field
     * they were asked to change. Honouring the rule means applying it where
     * the rule's own premise holds.
     *
     * `click`, not pointerdown, so a scroll-drag starting on the veil never
     * counts as leaving.
     */
    const press = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-mission-anchor], .mission-lift, .mission-next, .mission-target, [role='status']")) return;
      exit();
    };
    document.addEventListener("keydown", key);
    if (veiled) document.addEventListener("click", press);
    return () => {
      document.body.classList.remove("mission-mode");
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", press);
    };
  }, [guided, veiled, navigate, location.pathname]);

  useEffect(() => {
    setStatus({ hint: "EDIT" });
    return () => setStatus(null);
  }, [setStatus]);

  const { data: channel, isLoading, error: loadError } = useQuery({
    queryKey: ["channel-detail", id],
    queryFn: () => api.get<ChannelWithMedia>(`/channels/detail/${id}`),
    enabled: !!id,
    retry: false,
  });

  const {
    data: people,
    isPending: peopleLoading,
    isError: peopleFailed,
  } = useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Author[]>("/people"),
    enabled: isAdmin,
  });

  /*
    Who can see this channel — and it must never be answered from a failed
    read (found by M213's narrow census; the M203 class on a fourth page).

    `grantedIds` starts `[]` and `:271` only overwrites it `if
    (initialGrants)`, so a failed access read left every co-author's
    checkbox UNCHECKED — the screen saying nobody has been given this
    private channel. An admin who then changes the title and saves hits
    `PUT /channels/:id/access { person_ids: [] }` at the bottom of the same
    handler and **revokes everyone**, silently, from a channel that was
    shared a moment earlier.

    Same shape as M203's blank form: a control rendered from data that never
    arrived, written back over the real thing. The difference is that this
    one is a permission list, so the loss is invisible until somebody cannot
    open a memory they were shown last week.
  */
  const {
    data: initialGrants,
    isPending: grantsPending,
    isError: grantsFailed,
  } = useQuery({
    queryKey: ["channel-access", id],
    queryFn: () => api.get<string[]>(`/channels/${id}/access`),
    enabled: isAdmin && !!id,
  });
  const grantsUnread = isAdmin && (grantsPending || grantsFailed);

  // The server said this channel belongs to someone else: say so and leave.
  const forbidden = loadError instanceof Error && /not yours/.test(loadError.message);
  useEffect(() => {
    if (!forbidden) return;
    const t = setTimeout(() => navigate("/admin", { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [forbidden, navigate]);

  // Seed the form once, and remember what "unchanged" looks like.
  useEffect(() => {
    if (!channel) return;
    setTitle(channel.title);
    setDate(channel.date ?? "");
    setDescription(channel.description ?? "");
    setPrivacy((channel.privacy_level ?? 3) as 1 | 2 | 3);
    setMediaOrder(channel.media);
    const seededCaptions = Object.fromEntries(
      channel.media.map((m) => [m.id, m.caption ?? ""])
    );
    setCaptions(seededCaptions);
    if (missionTargets.current === null) {
      // A mission naming one photograph is about that photograph alone;
      // otherwise every wordless photo is a step.
      missionTargets.current = mission?.media_id
        ? channel.media.filter((m) => m.id === mission.media_id).map((m) => m.id)
        : channel.media
            .filter((m) => m.file_type === "image" && !(m.caption ?? "").trim())
            .map((m) => m.id);
    }
    baseline.current = JSON.stringify({
      title: channel.title,
      date: channel.date ?? "",
      description: channel.description ?? "",
      privacy: channel.privacy_level ?? 3,
      order: channel.media.map((m) => m.id),
      captions: seededCaptions,
      grants: [] as string[],
    });
  }, [channel]);

  useEffect(() => {
    if (initialGrants) {
      setGrantedIds(initialGrants);
      const parsed = JSON.parse(baseline.current || "{}");
      parsed.grants = [...initialGrants].sort();
      baseline.current = JSON.stringify(parsed);
    }
  }, [initialGrants]);

  const dirty = useMemo(() => {
    if (!channel || !baseline.current) return false;
    if (pending.length > 0) return true;
    return (
      baseline.current !==
      JSON.stringify({
        title,
        date,
        description,
        privacy,
        order: mediaOrder.map((m) => m.id),
        captions,
        grants: [...grantedIds].sort(),
      })
    );
  }, [channel, title, date, description, privacy, mediaOrder, captions, grantedIds, pending]);

  // Which rows the mission still wants, in shelf order.
  const emptyIds = missionMode
    ? mediaOrder
        .filter(
          (m) =>
            (mission?.media_id ? m.id === mission.media_id : m.file_type === "image") &&
            !(captions[m.id] ?? "").trim()
        )
        .map((m) => m.id)
    : [];
  const currentTarget = emptyIds[0] ?? null;
  const missionTotal = missionTargets.current?.length ?? 0;
  const missionStep = missionTotal - emptyIds.length + 1;

  /**
   * Brings a row to the reader, rather than making them hunt for it.
   *
   * Two details the mission depends on. The banner is `position: fixed` over
   * the top of the workspace, so a row that merely touches an edge can still
   * be underneath it — `block: "center"` clears it with room to spare. And
   * smooth scrolling is a common migraine and nausea trigger, in a product
   * whose audience skews older, so the OS setting decides.
   */
  const bringIntoView = useCallback((selector: string) => {
    /*
     * Deferred, then repeated once the picture has loaded.
     *
     * Two things defeat a naive scroll here. An effect runs before the row it
     * is about has been laid out, and a smooth scroll is interruptible — the
     * preview image arriving changes the row's height a moment later, the
     * layout shifts, and the scroll is abandoned half-way.
     *
     * A timeout rather than requestAnimationFrame, deliberately: rAF does not
     * fire at all in a hidden tab, so a scroll that depends on it silently
     * never happens. A timer runs either way.
     */
    const move = () => {
      const el = document.querySelector(selector);
      if (!el) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });

      // The image lands later and moves everything below it; come back once.
      const img = el.querySelector("img, video");
      if (img && !(img as HTMLImageElement).complete) {
        img.addEventListener("load", () => el.scrollIntoView({ block: "center", behavior: "auto" }), {
          once: true,
        });
      }
    };
    setTimeout(move, 60);
  }, []);

  // The bubble stands beside the row that is next — bring that row within
  // reach whenever the mission moves on.
  useEffect(() => {
    if (!missionMode || !currentTarget) return;
    bringIntoView(`[data-mission-anchor="${currentTarget}"]`);
  }, [missionMode, currentTarget, bringIntoView]);

  // An add-photos mission starts at the drop zone, wherever the list left it.
  useEffect(() => {
    if (!uploadMission || !channel || describing) return;
    bringIntoView('[data-mission-anchor="mission-add"]');
  }, [uploadMission, channel, describing, bringIntoView]);

  /*
   * The photographs this mission is about: the ones added in this sitting.
   *
   * Rejected files are excluded — a file the validator refused is not a
   * photograph anyone can describe, and counting it toward the target would
   * let a mission "complete" on files that will never be uploaded.
   */
  const added = useMemo(() => pending.filter((p) => !p.error), [pending]);

  /*
   * Meeting the minimum advances the phase by itself.
   *
   * Deliberately one-way: it flips to describing and stays there, so adding
   * a tenth photograph does not throw somebody back to the drop zone
   * mid-sentence. More may still be added — the sequence grows with them.
   */
  useEffect(() => {
    if (!uploadMission || describing) return;
    if (added.length >= missionTarget) setDescribing(true);
  }, [uploadMission, describing, added.length, missionTarget]);

  // Removing files back below the minimum returns to adding, which is the
  // honest state: the mission's number is not met any more.
  useEffect(() => {
    if (!uploadMission || !describing) return;
    if (added.length === 0) setDescribing(false);
  }, [uploadMission, describing, added.length]);

  const describedCount = added.filter((p) => p.caption.trim()).length;
  const allDescribed = added.length > 0 && describedCount === added.length;

  /*
   * A file just added arrives in view.
   *
   * Every added file appends a row below the last, off-screen, so without
   * this somebody adding ten photographs hunts for each one in turn. It
   * fires only when the list actually grows — auto-scrolling on every render
   * would fight anyone who scrolled somewhere themselves, which is worse
   * than not scrolling at all.
   */
  const pendingCount = useRef(0);
  useEffect(() => {
    if (pending.length > pendingCount.current) {
      bringIntoView(`[data-pending-row="${pending.length - 1}"]`);
    }
    pendingCount.current = pending.length;
  }, [pending, bringIntoView]);

  // A mission finishes the moment its work is actually done — and arriving
  // to find every photo already described counts. Nobody presses "finish":
  // the bubble says so, then the board shows the card in Done.
  useEffect(() => {
    if (!missionMode || !mission || !channel || dirty || mediaOrder.length === 0) return;
    const remaining = mediaOrder.filter(
      (m) =>
        (mission.media_id ? m.id === mission.media_id : m.file_type === "image") &&
        !(captions[m.id] ?? "").trim()
    ).length;
    if (remaining > 0) return;
    const t = setTimeout(async () => {
      try {
        await api.patch(`/missions/${mission.id}`, { status: "completed" });
        await queryClient.invalidateQueries({ queryKey: ["missions"] });
      } catch {
        /* returning either way */
      }
      navigate("/admin/missions", { state: { focusId: mission.id } });
    }, 2200);
    return () => clearTimeout(t);
  }, [missionMode, mission, channel, dirty, mediaOrder, captions, navigate, queryClient]);

  // Leaving with unsaved work should never be silent — unless it was saved.
  useEffect(() => {
    if (!dirty || success) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, success]);

  // Documentaries are films too; instructions are photographs in order.
  const isVideoChannel =
    channel?.content_type === "video" || channel?.content_type === "documentary";

  function addFiles(list: FileList | null) {
    const incoming = Array.from(list ?? []).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      caption: "",
      error: validateNewFile(file, !!isVideoChannel),
    }));
    setPending((prev) => [...prev, ...incoming]);
  }

  async function removeExisting(item: MediaFile) {
    setError(null);
    try {
      await api.delete(`/media-files/${item.id}`);
      setMediaOrder((prev) => {
        const next = prev.filter((m) => m.id !== item.id);
        // The baselines must forget the removed photo too, or the page would
        // count the removal as an unsaved edit.
        const parsed = JSON.parse(baseline.current || "{}");
        parsed.order = (parsed.order as string[]).filter((x) => x !== item.id);
        delete (parsed.captions as Record<string, string>)[item.id];
        baseline.current = JSON.stringify(parsed);
        return next;
      });
      setCaptions((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo could not be removed.");
    } finally {
      setRemoving(null);
    }
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(event: React.DragEvent, index: number) {
    event.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === index) return;
    setMediaOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndex.current = index;
  }

  function validate(): boolean {
    const errors: { title?: string; date?: string } = {};
    if (!title.trim()) errors.title = "The title is required.";
    if (!date) errors.date = "The date is required.";
    else if (date > today) errors.date = "The date cannot be in the future.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSave() {
    if (!channel) return;
    if (!validate()) {
      setError("Fix the errors above before saving.");
      return;
    }
    if (pending.some((p) => p.error)) {
      setError("Remove the rejected files before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    const uploadedCount = pending.length;

    // Metadata first; media afterwards — so a failed upload never loses the
    // text changes, and the error can say exactly which half went wrong.
    try {
      await api.patch(`/channels/${id}`, {
        title,
        date,
        description: description || null,
        ...(isAdmin ? { privacy_level: privacy } : {}),
      });

      // Only the words that actually changed travel.
      const parsed = JSON.parse(baseline.current || "{}");
      const before = (parsed.captions ?? {}) as Record<string, string>;
      for (const item of mediaOrder) {
        const now = (captions[item.id] ?? "").trim();
        if (now !== (before[item.id] ?? "").trim()) {
          await api.patch(`/media-files/${item.id}`, { caption: now || null });
        }
      }

      if (mediaOrder.length > 1) {
        await api.patch(`/media-files/reorder`, {
          channel_id: channel.id,
          ordered_ids: mediaOrder.map((m) => m.id),
        });
      }

      /*
        Never write a list we did not read (M213's census / M203's class).
        An empty `grantedIds` here would mean "revoke everybody", and on a
        failed read that is not what anyone chose — it is what nothing
        arrived.
      */
      if (isAdmin && privacy === 2 && !grantsUnread) {
        await api.put(`/channels/${id}/access`, { person_ids: grantedIds });
      }
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "The changes could not be saved.");
      return;
    }

    if (pending.length > 0) {
      try {
        const form = new FormData();
        form.set("channel_id", channel.id);
        pending.forEach((p) => {
          form.append("files", p.file);
          form.append("captions", p.caption);
          form.append("taken_on", "");
        });
        await api.post("/media-files", form);
        pending.forEach((p) => URL.revokeObjectURL(p.preview));
        setPending([]);
      } catch (err) {
        setSaving(false);
        setError(
          `Your changes were saved, but the new photos could not be added${
            err instanceof Error ? ` : ${err.message}` : "."
          }`
        );
        return;
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["channels"] }),
      queryClient.invalidateQueries({ queryKey: ["channel-detail", id] }),
      queryClient.invalidateQueries({ queryKey: ["channel-access", id] }),
      queryClient.invalidateQueries({ queryKey: ["suggestions"] }),
    ]);

    setSaving(false);

    // A mission asking for new material concludes when the save that adds
    // it lands — no button, the save itself is the finish line.
    // A human-written task about this channel concludes with the save that
    // does it; a description finding is judged by the rule engine, so the
    // board is where its card flips — go there and let it.
    if ((customMission || isDescriptionMission) && mission) {
      if (customMission) {
        try {
          await api.patch(`/missions/${mission.id}`, { status: "completed" });
          await queryClient.invalidateQueries({ queryKey: ["missions"] });
        } catch {
          /* the work is saved either way */
        }
      }
      navigate("/admin/missions", { state: { focusId: mission.id } });
      return;
    }

    /*
     * An add-photos mission finishes when it got what it asked for (M39).
     *
     * It used to complete on any save that carried a file, so one
     * photograph out of four closed a mission for four, and none of them
     * needed words. Now the target and the descriptions both have to be
     * met. Saving with less still saves — the work is never held hostage —
     * the mission simply stays open, which is the truth.
     */
    if (uploadMission && mission && uploadedCount > 0) {
      const enough = uploadedCount >= missionTarget;
      if (enough && allDescribed) {
        try {
          await api.patch(`/missions/${mission.id}`, { status: "completed" });
          await queryClient.invalidateQueries({ queryKey: ["missions"] });
        } catch {
          /* the work is saved either way */
        }
        navigate("/admin/missions", { state: { focusId: mission.id } });
        return;
      }
      setSuccess(
        enough
          ? "Saved. The mission stays open until every photo has a description."
          : `Saved. ${missionTarget - uploadedCount} more to go.`
      );
      return;
    }

    // Finishing the last step of a mission returns to the board, with the
    // card already in Done.
    if (missionMode && mission) {
      const remaining = mediaOrder.filter(
        (m) =>
          (mission.media_id ? m.id === mission.media_id : m.file_type === "image") &&
          !(captions[m.id] ?? "").trim()
      ).length;
      if (remaining === 0) {
        try {
          await api.patch(`/missions/${mission.id}`, { status: "completed" });
          await queryClient.invalidateQueries({ queryKey: ["missions"] });
        } catch {
          /* the work is saved either way */
        }
        navigate("/admin/missions", { state: { focusId: mission.id } });
        return;
      }
    }

    setSuccess("Channel updated");
  }

  async function handleArchive() {
    setArchiving(true);
    setError(null);
    try {
      await api.delete(`/channels/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      setSuccess("Channel archived");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setArchiving(false);
    }
  }

  const requestPrivacy = useCallback(
    (value: 1 | 2 | 3) => {
      // Widening to everyone deserves a pause; narrowing does not.
      if (value === 3 && privacy !== 3) setConfirmAll(true);
      else setPrivacy(value);
    },
    [privacy]
  );

  function requestBack() {
    if (dirty) setConfirmDiscard(true);
    else navigate("/admin/shelf");
  }

  if (success) {
    return <SuccessScreen title={success} to="/admin/shelf" />;
  }

  if (isLoading) {
    return <p className="flex min-h-[40vh] items-center justify-center text-fg-muted">Loading…</p>;
  }

  if (forbidden) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-xl font-semibold">This channel is not available</p>
        <p className="max-w-lg text-fg-muted">
          You can only edit channels you created. Returning to the dashboard…
        </p>
      </div>
    );
  }

  if (!channel) {
    /*
      "Channel not found" was said for every failure, including a 503 (M201).

      This is the edit page — someone arrives here holding a memory in mind,
      and being told it does not exist is being told it was deleted. It is a
      claim about the family's archive, made from a request that never
      answered. Only a 404 is the archive speaking.
    */
    const missing = isGenuinelyMissing(loadError);
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xl font-semibold">
          {missing ? "Channel not found" : "This channel could not be loaded"}
        </p>
        {!missing && (
          <p className="max-w-[340px] text-sm leading-[1.6] text-fg-muted">
            Nothing has happened to it — we could not reach the archive to ask.
          </p>
        )}
      </div>
    );
  }

  /*
   * Seeing and changing are different questions (M49).
   *
   * The server decides: `can_edit` is its answer, so the screen states the
   * rule rather than deriving it again and risking a different one. Somebody
   * who may read but not change gets a viewer at full strength — never this
   * editor with its controls greyed out, which would say "broken" when the
   * truth is "somebody else's".
   */
  if (channel.can_edit === false) {
    return <ChannelReadOnly channel={channel} />;
  }

  const number = String(channel.number).padStart(2, "0");
  const co_authors = (people ?? []).filter((p) => p.role === "co_author");
  /*
    "No co-authors yet." beside a list of tick-boxes is an answer about the
    family, and a failed load made it without having asked anyone (M181,
    F70). Here it decides who a memory can be shared with, so the false
    version quietly narrows the choice to nobody.
  */
  const coAuthorsState = listState({
    isPending: peopleLoading,
    isError: peopleFailed,
    count: co_authors.length,
  });

  return (
    /*
     * No frame here (M75). The shell gutters and paces every page, so the
     * M74 patches that gave this one its own `px-[22px]` are gone rather
     * than kept as a second frame. What stays is the shape: it lets go of
     * the desktop's fixed height below `md` so the columns can stack.
     */
    <div className="flex min-h-0 flex-col md:h-full md:overflow-hidden">
      {missionMode && mission && (
        <MissionBubble
          onExit={() => navigate(location.pathname, { replace: true, state: {} })}
          anchorId={currentTarget ?? "mission-save"}
          label={
            emptyIds.length > 0 ? `MISSION STEP ${missionStep} OF ${missionTotal}` : "MISSION"
          }
          title={
            emptyIds.length > 0
              ? "Describe this photo"
              : dirty
                ? "Press Save"
                : "Already described ✓"
          }
          body={
            emptyIds.length > 0
              ? "A sentence is enough — where it was taken, who is in it, what was happening."
              : dirty
                ? "Saving finishes the mission by itself."
                : "Nothing left to do here — returning to the board."
          }
        />
      )}
      {/* Every other kind of mission gets its bubble too — always visible,
          always beside the thing it is about. */}
      {!missionMode && guided && mission && (
        <MissionBubble
          onExit={() => navigate(location.pathname, { replace: true, state: {} })}
          anchorId={
            uploadMission
              ? describing
                ? "mission-sequence"
                : "mission-add"
              : isDescriptionMission
                ? "mission-description"
                : "mission-save"
          }
          label="MISSION"
          /*
           * The popup always names the step, the count, and what unlocks the
           * next one (M39). The owner's word for it was "foolproof": at no
           * point may somebody be looking at this and not know what would
           * let them proceed. It used to say one unchanging sentence
           * through the whole mission, which is how he ended up adding nine
           * photographs and waiting for something to happen.
           */
          title={
            uploadMission
              ? describing
                ? `Describe ${mission.task_kind === "record" ? "the recording" : "the photos"} — ${describedCount} of ${added.length}`
                : mission.task_kind === "record"
                  ? `Add ${missionTarget === 1 ? "the recording" : `at least ${missionTarget} recordings`} — ${added.length} of ${missionTarget}`
                  : `Add at least ${missionTarget} photo${missionTarget === 1 ? "" : "s"} — ${added.length} of ${missionTarget}`
              : isDescriptionMission
                ? mission.rule_key === "short_description"
                  ? "Say a little more"
                  : "Write the channel's description"
                : mission.title
          }
          body={
            uploadMission
              ? describing
                ? allDescribed
                  ? "Every one has words. Save to finish the mission."
                  : "A sentence each — where it was taken, who is in it. You can skip and come back; the mission finishes when they all have words."
                : `Drop files below or browse. ${
                    missionTarget - added.length
                  } more and the descriptions open by themselves.`
              : isDescriptionMission
                ? "A few sentences in her words: what this channel is, who is in it. Save when it reads well."
                : (mission.detail ??
                  "Make the change this mission asks for — pressing Save concludes it.")
          }
        />
      )}
      {veiled && <div className="mission-veil" aria-hidden="true" />}
      {/*
        Identity and the three verbs, on one line — and anchored (M76).

        The workspace box is a fixed height, and a flex child shrinks by
        default. Without `flex-none` this row could be squeezed by a growing
        photo list or a short laptop, which is how VIEW / Archive / Save ended
        up pushed into the box's cut zone. The list below owns the overflow;
        this row owns none of it.
      */}
      <div className="flex flex-none flex-wrap items-center justify-between gap-4 pb-[18px] md:flex-nowrap">
        {/*
          The identity block is what gives way when the window narrows (M81).

          On desktop the row must not wrap: `flex-wrap` used to let the verb
          group drop to a second line, where — being the only item on it —
          `justify-between` seated it at the left, and the row read as a
          floating cluster under the header rather than "identity left,
          actions right". `md:flex-nowrap` holds the line, and this block
          shrinks (`min-w-0`) so the low-priority hint truncates instead of
          pushing the verbs off their corner. Below `md` the wrap stays: it
          is how the phone editor gets its full-width verb row (M74).
        */}
        {/*
          Frame 1c's identity block: the way back, the number, the channel's
          own name, and what cannot be changed about it — the title carries
          the page rather than the word CHANNEL, because on this screen the
          channel is the subject, not the category.
        */}
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={requestBack}
            aria-label="Back to the shelf"
            className="hidden h-11 w-11 flex-none items-center justify-center rounded-full md:flex"
            style={{ border: "1px solid rgba(var(--ink),.13)" }}
          >
            <ArrowLeft size={16} strokeWidth={1.7} style={{ color: "rgba(var(--ink-cream),.75)" }} />
          </button>

          <div className="min-w-0">
            {/*
              On a phone the title takes its own row (owner, with screenshot:
              "Making cof…" at 34px between the chip and the type pill left
              room for eleven letters). The chip and the pill share line one,
              the full title wraps beneath — `order-last w-full` under `md`,
              back inline and truncating on the desktop, where 1c is the
              approved reference and the row must not change.
            */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:flex-nowrap">
              <span
                className="flex-none rounded-[9px] px-2.5 py-[7px] font-mono text-[12px] font-medium leading-none"
                style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}
              >
                {number}
              </span>
              <span
                className="order-last w-full whitespace-normal text-[27px] font-light leading-[1.15] md:order-none md:w-auto md:truncate md:whitespace-nowrap md:text-[34px] md:leading-none"
                style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
              >
                {channel.title}
              </span>
              <span
                className="flex-none rounded-full px-3.5 py-1.5 text-[12px]"
                style={{ border: "1px solid rgba(var(--ink),.2)", color: "rgba(var(--ink-cream),.75)" }}
              >
                {channel.content_type}
              </span>
            </div>
            {/* The "cannot be changed" line was desktop-only; the owner asked
                for it on the phone as well. It wraps there — truncating the
                one sentence that explains the page's limits defeats it. */}
            <div
              className="mt-2 text-[13px] leading-[1.4] md:truncate"
              style={{ color: "var(--fg-hint)" }}
            >
              {channel.author?.name ? `Added by ${channel.author.name} · ` : ""}
              {channel.date
                ? `${new Date(channel.date).toLocaleDateString("en-GB", { dateStyle: "long" })} · `
                : ""}
              number, type and author cannot be changed
            </div>
          </div>
        </div>

        {/* On a phone the verbs take the full width as one even row — and a
            label never breaks across lines ("View channel" was wrapping
            mid-word into a two-line pill). If the row runs out of width a
            whole pill drops, not half a word. */}
        <div className="flex w-full flex-wrap items-center gap-2.5 gap-y-2 md:w-auto md:flex-nowrap md:shrink-0 md:gap-3">
          <button
            type="button"
            /*
              The admin preview, not Margaret's screen (M160).

              This used to open `/channel/:number` — the kiosk display itself
              — and the display is gated on the *machine*, not the person:
              `AuthGuard requireProfile={false}` turns away anything without a
              device session. So an admin working from their own laptop, which
              is not the paired screen, pressed "View channel" and was bounced
              to sign-in. It read as being locked out of their own archive.

              The gate is right and is not the thing to change: a screen in a
              living room is a machine the family trusted, not a person who
              knows a password. Loosening it to make this button work would
              trade the one guard protecting her display for a convenience.
              The button was simply pointing at the wrong page.

              `/admin/channels/:id/preview` is the read-only view built for
              exactly this — openable from anywhere a family session reaches.
              It takes the channel's id, not its number.
            */
            onClick={() => navigate(`/admin/channels/${id}/preview`)}
            className="pressable flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 py-[13px] text-[13px] leading-none md:flex-none"
            style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
          >
            View channel
          </button>

          {isAdmin &&
            (confirmArchive ? (
              <span className="flex items-center gap-3 text-sm">
                <span className="text-fg-muted">Move to Recently deleted?</span>
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  className="text-fg-faint hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchive()}
                  disabled={archiving}
                  style={{ color: "var(--accent)" }}
                >
                  {archiving ? "Archiving…" : "Archive"}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="flex-1 whitespace-nowrap rounded-full px-5 py-[13px] text-[13px] leading-none transition-colors md:flex-none"
                style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
              >
                Archive
              </button>
            ))}

          <span className="relative flex-1 md:flex-none">
            <button
              type="button"
              data-mission-anchor="mission-save"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className={`w-full rounded-full px-5 py-[13px] text-[13px] font-medium leading-none disabled:opacity-40 md:w-auto ${
                (missionMode && emptyIds.length === 0) || (guided && !missionMode && dirty)
                  ? "mission-target mission-lift"
                  : guided
                    ? "mission-lift"
                    : ""
              }`}
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </span>
        </div>
      </div>

      {/* One reserved line of feedback for the whole page. */}
      <p
        role="alert"
        className="h-5 flex-none text-sm text-destructive-soft"
        style={{ visibility: error ? "visible" : "hidden" }}
      >
        {error || " "}
      </p>

      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-8 md:flex-row md:gap-10">
        {/* The channel itself — resting while a mission is on. */}
        <div
          className={`flex w-full flex-none flex-col gap-[18px] rounded-[26px] p-6 md:w-[470px] ${missionMode ? "mission-rest pointer-events-none" : ""}`}
          style={{
            background: "rgba(var(--ink),.045)",
            border: "1px solid rgba(var(--ink),.09)",
          }}
        >
          <label>
            <span className="flex justify-between">
              <span className={LABEL}>TITLE *</span>
              <span className={COUNTER}>
                {title.length}/{TITLE_MAX}
              </span>
            </span>
            <input
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT}
              style={{ ...BORDER, height: 48, borderColor: fieldErrors.title ? "var(--destructive-soft)" : undefined }}
            />
          </label>

          <label>
            <span className={LABEL}>DATE *</span>
            <input
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
              style={{ ...BORDER, height: 48, borderColor: fieldErrors.date ? "var(--destructive-soft)" : undefined }}
            />
          </label>

          <label>
            <span className="flex justify-between">
              <span className={LABEL}>CHANNEL DESCRIPTION</span>
              <span className={COUNTER}>
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </span>
            <textarea
              rows={4}
              maxLength={DESCRIPTION_MAX}
              data-mission-anchor="mission-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${INPUT} resize-none py-3 leading-[1.55] ${
                isDescriptionMission ? "mission-target mission-lift" : ""
              }`}
              style={BORDER}
            />
          </label>

          {isAdmin && (
            <div>
              <span className={LABEL}>WHO CAN SEE THIS MEMORY</span>
              {confirmAll ? (
                <div
                  className="mt-2.5 rounded-[10px] p-3.5 text-sm"
                  style={{ border: "1px solid var(--accent)" }}
                >
                  <p className="text-fg-muted">
                    Open this memory to every profile in the archive?
                  </p>
                  <div className="mt-2.5 flex gap-4">
                    <button
                      type="button"
                      onClick={() => setConfirmAll(false)}
                      className="text-fg-faint hover:text-fg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrivacy(3);
                        setConfirmAll(false);
                      }}
                      style={{ color: "var(--accent)" }}
                    >
                      Yes, everyone
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex gap-2.5">
                  {PRIVACY.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      title={option.hint}
                      onClick={() => requestPrivacy(option.value)}
                      className="flex-1 rounded-[10px] p-3 text-center text-[13px] transition-colors"
                      style={
                        privacy === option.value
                          ? { border: "2px solid var(--accent)", color: "var(--fg)", fontWeight: 500 }
                          : { border: "1px solid rgba(var(--ink),.2)", color: "rgba(var(--ink),.7)" }
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}

              {privacy === 2 && !confirmAll && grantsUnread && (
                <p className="mt-3 text-[13px] leading-[1.6]" style={{ color: "var(--fg-faint)" }}>
                  Who this is shared with could not be read, so it is not shown and will not be
                  changed by saving. Everyone who had it keeps it.
                </p>
              )}

              {privacy === 2 && !confirmAll && !grantsUnread && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {co_authors.map((person) => (
                    <label key={person.id} className="flex items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={grantedIds.includes(person.id)}
                        onChange={(e) =>
                          setGrantedIds((prev) =>
                            e.target.checked
                              ? [...prev, person.id]
                              : prev.filter((x) => x !== person.id)
                          )
                        }
                      />
                      {person.name}
                    </label>
                  ))}
                  {coAuthorsState === "error" && (
                    <p className="text-sm text-fg-faint">
                      The family could not be loaded, so this list may be incomplete.
                    </p>
                  )}
                  {coAuthorsState === "empty" && (
                    <p className="text-sm text-fg-faint">No co-authors yet.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            One way back, and it is the circle in the header (F26).

            This footer used to carry a second "← Back to shelf". Removing it
            was nearly a mistake: it called `requestBack`, which asks before
            discarding unsaved work, while the new circle navigated away
            outright — deleting the link would have quietly kept the door
            that loses your edits. The circle now goes through the same
            guard, and what remains here is only the confirm itself.
          */}
          <div className="mt-auto hidden pb-6 md:block">
            {confirmDiscard ? (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-fg-muted">Discard unsaved changes?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                  className="text-fg-faint hover:text-fg"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/admin/shelf")}
                  style={{ color: "var(--destructive-soft)" }}
                >
                  Discard
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Every photograph, as a row with its own words. The list scrolls;
            nothing else on the page does. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-[26px] p-6"
          style={{
            background: "rgba(var(--ink),.045)",
            border: "1px solid rgba(var(--ink),.09)",
          }}
        >
          {/*
            The count never wraps (M78).

            Mono, tracked type is wider than it looks, and the em dash is a
            break opportunity the browser takes when the row is tight — so
            "PHOTOS — 12" split across two lines at 375px and the row read
            broken. The same fix landed next door in the Add flow and on the
            owner dashboard and missed *this* row, which is where it was
            reported. A gap keeps the two spans from meeting in the middle;
            the sentence on the right may still wrap, which is fine, because
            it can no longer push the count.
          */}
          <div className="flex items-baseline justify-between gap-3">
            <span className={`${LABEL} whitespace-nowrap`}>
              {isVideoChannel ? "FILES" : "PHOTOS"} — {mediaOrder.length}
            </span>
            {/*
              The count of undescribed photographs is a standing fact, not a
              mission-mode one (frame 1c). A description is what the frame
              reads aloud when she asks, so "2 need descriptions" is the most
              useful thing this header can say — and it says it in amber
              because it is owed, then goes quiet when nothing is.
            */}
            <span className="flex min-w-0 items-center gap-3">
              {emptyIds.length > 0 && (
                <span
                  className="whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[10px] tracking-[0.14em]"
                  style={{ background: "rgba(var(--accent-channels),.18)", color: "var(--accent-soft)" }}
                >
                  {emptyIds.length} NEED{emptyIds.length === 1 ? "S" : ""} DESCRIPTION
                  {emptyIds.length === 1 ? "" : "S"}
                </span>
              )}
              <span className="hidden truncate text-xs md:inline" style={{ color: "rgba(var(--ink-cream),.4)" }}>
                Drag to reorder · removed files go to Recently deleted
              </span>
            </span>
          </div>

          {/* Only this list scrolls — the page never does. */}
          {/* Desktop: this list is the page's one scroll region. Phone: the
              page itself scrolls, so the list simply flows. */}
          <div className="scroll-thin ring-room flex min-h-0 flex-col gap-3 pb-4 md:flex-1 md:overflow-y-auto md:pr-1">
          {mediaOrder.map((item, index) => {
            const caption = captions[item.id] ?? "";
            const editing = editingId === item.id;
            const confirming = removing?.id === item.id;

            return (
              <div
                key={item.id}
                data-mission-anchor={item.id}
                onDragOver={(e) => handleDragOver(e, index)}
                className={`relative flex items-center gap-3.5 rounded-[14px] py-3 pl-2.5 pr-4 ${
                  missionMode
                    ? item.id === currentTarget
                      ? "mission-target mission-lift"
                      : emptyIds.includes(item.id)
                        ? "mission-next mission-lift"
                        : "mission-rest"
                    : ""
                }`}
                style={
                  missionMode
                    ? undefined
                    : editing
                      ? { border: "2px solid var(--accent)", background: "rgba(var(--accent-channels),.06)" }
                      : { border: "1px solid rgba(var(--ink),.16)" }
                }
              >
                {/* Only the handle drags. A draggable row swallows the click
                    that would put the cursor in the description. */}
                <span
                  draggable={!confirming}
                  onDragStart={() => handleDragStart(index)}
                  className="flex-none cursor-grab"
                >
                  <GripVertical className="h-5 w-4 text-[color:rgba(var(--ink),0.35)]" aria-hidden />
                </span>

                {item.file_type === "video" ? (
                  <video
                    src={item.url ?? undefined}
                    muted
                    className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                  />
                ) : item.url ? (
                  <img
                    src={item.url}
                    alt=""
                    className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-[88px] w-[88px] flex-none items-center justify-center rounded-lg bg-[rgba(var(--ink),0.06)]">
                    <ImageIcon className="h-6 w-6 text-fg-faint" aria-hidden />
                  </span>
                )}

                {confirming ? (
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                    <span className="text-sm text-fg-muted">
                      Remove this {item.file_type === "video" ? "video" : "photo"} from the
                      channel? It goes to Recently deleted.
                    </span>
                    <span className="flex flex-none gap-4 text-sm">
                      <button
                        type="button"
                        onClick={() => setRemoving(null)}
                        className="text-fg-faint hover:text-fg"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeExisting(item)}
                        style={{ color: "var(--destructive-soft)" }}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between">
                        <span
                          className="font-mono text-[9px] tracking-[0.14em]"
                          style={{
                            color:
                              missionMode || editing ? "var(--accent)" : "rgba(var(--ink),.4)",
                          }}
                        >
                          {missionMode
                            ? item.id === currentTarget
                              ? "YOUR TURN — ADD A DESCRIPTION"
                              : emptyIds.includes(item.id)
                                ? "UP NEXT"
                                : missionTargets.current?.includes(item.id)
                                  ? "DONE ✓"
                                  : "DESCRIPTION"
                            : editing
                              ? "DESCRIPTION — EDITING"
                              : "DESCRIPTION"}
                        </span>
                        <span className="font-mono text-[9px] text-[color:rgba(var(--ink),0.3)]">
                          {caption.length}/{CAPTION_MAX}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        maxLength={CAPTION_MAX}
                        value={caption}
                        placeholder="Add a description — where, when, who is in it…"
                        onFocus={() => setEditingId(item.id)}
                        onBlur={() => setEditingId((current) => (current === item.id ? null : current))}
                        onChange={(e) =>
                          setCaptions((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        className="mt-1.5 w-full resize-none bg-transparent text-sm leading-[1.5] outline-none placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setRemoving(item)}
                      aria-label="Remove this file"
                      className="flex-none text-[color:rgba(var(--ink),0.45)] transition-colors hover:text-fg"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/*
            Phase 2 of an add-photos mission: one photograph at a time.

            The whole list is still here in every other situation — an album
            of thirty holiday photographs one at a time would be its own
            punishment, and M39 says so. This is only for a mission that
            named a number, where the walk-through is the value.
          */}
          {uploadMission && describing && added.length > 0 && (
            <div
              data-mission-anchor="mission-sequence"
              className="mission-lift rounded-[14px] p-4"
              style={{ border: "1px solid rgba(var(--accent-channels),.4)", background: "rgba(var(--accent-channels),.05)" }}
            >
              <GuidedSequence
                items={added.map((p) => ({ key: p.preview, done: !!p.caption.trim() }))}
                index={describeIndex}
                onIndex={setDescribeIndex}
                noun={isVideoChannel ? "clip" : "photo"}
              >
                {(item) => {
                  const i = pending.findIndex((p) => p.preview === item.key);
                  const p = pending[i];
                  if (!p) return null;
                  return (
                    <div className="flex gap-4">
                      {isVideoChannel ? (
                        <video
                          src={p.preview}
                          muted
                          className="h-[180px] w-[180px] flex-none rounded-lg object-cover"
                        />
                      ) : (
                        <img
                          src={p.preview}
                          alt=""
                          className="h-[180px] w-[180px] flex-none rounded-lg object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between">
                          <span className="font-mono text-[9px] tracking-[0.14em] text-[color:rgba(var(--ink),0.4)]">
                            DESCRIPTION · WILL BE ADDED WHEN YOU SAVE
                          </span>
                          <span className="font-mono text-[9px] text-[color:rgba(var(--ink),0.3)]">
                            {p.caption.length}/{CAPTION_MAX}
                          </span>
                        </div>
                        <textarea
                          autoFocus
                          rows={6}
                          maxLength={CAPTION_MAX}
                          value={p.caption}
                          placeholder="Where was it taken, who is in it, what was happening…"
                          onChange={(e) =>
                            setPending((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x))
                            )
                          }
                          className="mt-1.5 w-full resize-none bg-transparent text-sm leading-[1.6] outline-none placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
                        />
                      </div>
                    </div>
                  );
                }}
              </GuidedSequence>
            </div>
          )}

          {/*
            New files wait here, words and all, until Save.

            While the sequence has the floor, this list shows only files the
            validator refused. They are not in the sequence — an unusable
            file is not a photograph to describe — but Save refuses to run
            while one is present, so hiding them outright would leave
            somebody holding a blocked Save and nothing to press.
          */}
          {(uploadMission && describing ? pending.filter((p) => p.error) : pending).map((p) => {
            const i = pending.indexOf(p);
            return (
            <div
              key={p.preview}
              data-pending-row={i}
              className={`flex items-center gap-3.5 rounded-[14px] py-3 pl-2.5 pr-4 ${
                uploadMission ? "mission-lift" : ""
              }`}
              style={{
                border: p.error
                  ? "1px solid var(--destructive-soft)"
                  : "1px dashed rgba(var(--ink),.3)",
              }}
            >
              <span className="w-4 flex-none" />
              {isVideoChannel ? (
                <video
                  src={p.preview}
                  muted
                  className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                />
              ) : (
                <img
                  src={p.preview}
                  alt=""
                  className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                {p.error ? (
                  <p className="text-sm text-destructive-soft">{p.error}</p>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="font-mono text-[9px] tracking-[0.14em] text-[color:rgba(var(--ink),0.4)]">
                        DESCRIPTION · WILL BE ADDED WHEN YOU SAVE
                      </span>
                      <span className="font-mono text-[9px] text-[color:rgba(var(--ink),0.3)]">
                        {p.caption.length}/{CAPTION_MAX}
                      </span>
                    </div>
                    <textarea
                      rows={2}
                      maxLength={CAPTION_MAX}
                      value={p.caption}
                      placeholder="Add a description — where, when, who is in it…"
                      onChange={(e) =>
                        setPending((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x))
                        )
                      }
                      className="mt-1.5 w-full resize-none bg-transparent text-sm leading-[1.5] outline-none placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
                    />
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(p.preview);
                  setPending((prev) => prev.filter((_, j) => j !== i));
                }}
                aria-label="Remove this file"
                className="flex-none text-[color:rgba(var(--ink),0.45)] transition-colors hover:text-fg"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            );
          })}

          {/* The phone's way to add is the big amber + — this zone would be
              a second, dimmer door. It stays on the phone only while an
              upload mission is pointing at it. Desktop keeps it always. */}
          <label
            data-mission-anchor="mission-add"
            className={`cursor-pointer rounded-[14px] p-5 text-center text-sm text-fg-muted transition-colors hover:border-accent ${
              uploadMission ? "block" : "hidden"
            } md:block ${
              // Once the descriptions have the floor the drop zone is still
              // usable — more may be added — but it stops being the thing
              // the mission is pointing at.
              uploadMission && !describing ? "mission-target mission-lift" : uploadMission ? "mission-lift" : ""
            }`}
            style={{ border: "1px dashed rgba(var(--ink),.25)" }}
          >
            {isVideoChannel ? "Add another video" : "Add photos to this channel"}
            <input
              type="file"
              multiple={!isVideoChannel}
              accept={isVideoChannel ? VIDEO_ACCEPT : IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </label>
          </div>
        </div>
      </div>
    </div>
  );
}
