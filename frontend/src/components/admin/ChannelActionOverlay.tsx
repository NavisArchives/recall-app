import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Pencil, X, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Channel } from "@/types";

export type OverlayChannel = Channel & { archived_at?: string | null };

const PILL =
  "flex items-center gap-2.5 rounded-full border px-6 py-3.5 text-lg transition-colors";

/**
 * Fullscreen channel actions — not a modal, the whole screen becomes the
 * channel for a moment. What is offered depends on who is looking: viewing is
 * for everyone, editing follows edit rights, deleting is an admin's, and the
 * permanent kind exists only in Recently deleted, twice confirmed.
 */
export function ChannelActionOverlay({
  channel,
  mode,
  canEdit,
  isAdmin,
  onClose,
  onDone,
  initialConfirm = "none",
}: {
  channel: OverlayChannel;
  mode: "active" | "deleted";
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Open straight on a confirmation — the dashboard's Delete link uses this. */
  initialConfirm?: "none" | "delete" | "purge";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<"none" | "delete" | "purge">(initialConfirm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape always leaves, and the display shortcuts stay dead here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const number = String(channel.number).padStart(2, "0");
  const date = channel.date
    ? new Date(channel.date).toLocaleDateString("en-GB", { dateStyle: "long" })
    : null;

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/channels/${channel.id}`);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({ queryKey: ["channels-archived"] });
      onDone("Channel moved to Recently deleted");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "The channel could not be moved.");
    }
  }

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/channels/${channel.id}/restore`);
      await queryClient.invalidateQueries({ queryKey: ["channels"] });
      await queryClient.invalidateQueries({ queryKey: ["channels-archived"] });
      onDone("Channel restored");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "The channel could not be restored.");
    }
  }

  async function purge() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.delete<{ storage_cleared: boolean }>(
        `/channels/${channel.id}/permanent`
      );
      await queryClient.invalidateQueries({ queryKey: ["channels-archived"] });
      onDone(
        result.storage_cleared
          ? "Channel permanently deleted"
          : "Channel deleted — some files could not be removed from storage"
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "The channel could not be deleted.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden">
      {/* The channel's own photograph, far behind everything. */}
      {channel.cover_url && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${channel.cover_url})`, filter: "blur(40px)", opacity: 0.18 }}
        />
      )}
      <div aria-hidden className="absolute inset-0" style={{ background: "rgba(0,0,0,0.92)" }} />

      <div className="relative flex flex-col items-center gap-[2vh] px-[4vw] text-center">
        <p
          className="font-sans italic"
          style={{ font: "italic 200 clamp(80px, 18vh, 180px) / 1 Roboto, sans-serif" }}
        >
          {number}
        </p>
        <h1 className="t-title uppercase">{channel.title}</h1>
        <p
          className="t-subtitle"
          style={{ visibility: date ? "visible" : "hidden" }}
        >
          {date || " "}
        </p>

        {/* One line of feedback space, reserved so nothing moves. */}
        <p role="alert" className="h-6 text-destructive-soft" style={{ visibility: error ? "visible" : "hidden" }}>
          {error || " "}
        </p>

        {confirm === "none" && (
          <div className="mt-[2vh] flex flex-wrap items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => navigate(`/channel/${number}`)}
              className={PILL}
              style={{ borderColor: "var(--line)", background: "rgba(var(--ink),.04)" }}
            >
              <Play className="h-5 w-5" aria-hidden /> View
            </button>

            {mode === "active" && canEdit && (
              <button
                type="button"
                onClick={() => navigate(`/admin/edit-channel/${channel.id}`)}
                className={PILL}
                style={{ borderColor: "var(--line)", background: "rgba(var(--ink),.04)" }}
              >
                <Pencil className="h-5 w-5" aria-hidden /> Edit
              </button>
            )}

            {mode === "active" && isAdmin && (
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                className={`${PILL} text-fg-muted`}
                style={{ borderColor: "var(--line-soft)" }}
              >
                <X className="h-5 w-5" aria-hidden /> Delete
              </button>
            )}

            {mode === "deleted" && (
              <>
                <button
                  type="button"
                  onClick={restore}
                  disabled={busy}
                  className={PILL}
                  style={{ borderColor: "var(--accent)", color: "var(--accent-soft)" }}
                >
                  <Undo2 className="h-5 w-5" aria-hidden />
                  {busy ? "Restoring…" : "Restore"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirm("purge")}
                  className={PILL}
                  style={{ borderColor: "var(--destructive-soft)", color: "var(--destructive-soft)" }}
                >
                  <X className="h-5 w-5" aria-hidden /> Delete permanently
                </button>
              </>
            )}
          </div>
        )}

        {confirm === "delete" && (
          <div className="mt-[2vh] flex flex-col items-center gap-5">
            <p className="t-body max-w-xl">
              Move “{channel.title}” to deleted channels? It can be restored by an administrator
              at any time.
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setConfirm("none")}
                className={PILL}
                style={{ borderColor: "var(--line)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={archive}
                disabled={busy}
                className={PILL}
                style={{ borderColor: "var(--accent)", color: "var(--accent-soft)" }}
              >
                {busy ? "Moving…" : "Move to deleted"}
              </button>
            </div>
          </div>
        )}

        {confirm === "purge" && (
          <div className="mt-[2vh] flex flex-col items-center gap-5">
            <p className="t-body max-w-xl">
              Permanently delete “{channel.title}”? All media files will be removed forever.
              This cannot be undone.
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setConfirm("none")}
                className={PILL}
                style={{ borderColor: "var(--line)" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={purge}
                disabled={busy}
                className={PILL}
                style={{ borderColor: "var(--destructive-soft)", color: "var(--destructive-soft)" }}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="hint-mono absolute bottom-[5vh] hover:text-fg"
      >
        ← Back
      </button>
    </div>
  );
}
