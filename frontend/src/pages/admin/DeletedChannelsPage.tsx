import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ImageIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { SuccessScreen } from "@/components/admin/SuccessScreen";
import { combinedListState, partiallyFailed } from "@/lib/listState";
import {
  ChannelActionOverlay,
  type OverlayChannel,
} from "@/components/admin/ChannelActionOverlay";

type ArchivedChannel = OverlayChannel & { archived_at: string };

/** A photograph the family removed — the row kept its order, so it knows
 *  exactly where it goes back to (M127). */
interface ArchivedFile {
  id: string;
  file_type: string;
  caption: string | null;
  display_order: number;
  archived_at: string;
  channel: { id: string; number: number; title: string } | null;
  url: string;
}

/**
 * Recently deleted. Nothing here disappears on its own — a channel stays
 * until an administrator restores it or removes it for good, and only that
 * second act is unrecoverable.
 *
 * Files live here too since M127. The remove confirm has always said
 * "removed files go to Recently deleted", and until now this page answered
 * "No recently deleted channels" — a true sentence about the wrong noun,
 * which read as "your photograph is gone". The data was never gone; the
 * door was missing.
 */
export function DeletedChannelsPage() {
  const { isAdmin } = useAuth();
  const { setStatus } = useDisplay();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<ArchivedChannel | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus({ hint: "RECENTLY DELETED" });
    return () => setStatus(null);
  }, [setStatus]);

  const {
    data: channels,
    isPending: channelsPending,
    isError: channelsFailed,
  } = useQuery({
    queryKey: ["channels-archived"],
    queryFn: () => api.get<ArchivedChannel[]>("/channels/archived/list"),
  });

  const {
    data: files,
    isPending: filesPending,
    isError: filesFailed,
  } = useQuery({
    queryKey: ["media-archived"],
    queryFn: () => api.get<ArchivedFile[]>("/media-files/archived/list"),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/media-files/${id}/restore`, {}),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["media-archived"] });
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
      void queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (success) {
    return <SuccessScreen title={success} to="/admin/channels/deleted" />;
  }

  const rows = channels ?? [];
  const fileRows = files ?? [];

  /*
    "Nothing has been deleted recently." is a claim about the archive, and
    this page used to make it whenever the lists came back undefined — which
    is exactly what a failed load looks like (M180, F70). On the one route
    back from a deletion, read by somebody who has just deleted something by
    mistake, that sentence means "it is gone for good".

    `listState` will not let empty be reached from a failure: the state is
    computed from both lists together, because the sentence is a claim about
    both, and one of them failing withdraws it.
  */
  const parts = [
    { isPending: channelsPending, isError: channelsFailed, count: rows.length },
    { isPending: filesPending, isError: filesFailed, count: fileRows.length },
  ];
  const state = combinedListState(parts);
  const loading = state === "loading";
  const empty = state === "empty";

  return (
    <div className="flex min-h-full flex-col md:h-full md:min-h-0">
      <div className="flex-none">
        {/* Desktop-only (M82) — the More sheet reaches this page on a phone,
            so the back link would only repeat the nav. */}
        <Link
          to="/admin/shelf"
          className="hidden font-mono text-xs text-fg-faint hover:text-fg md:inline"
        >
          ← Memory Shelf
        </Link>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.01em]">Recently deleted</h1>
        <p className="mt-1 text-sm text-fg-faint">
          Channels and photographs are kept here until an administrator removes them
          permanently.
        </p>
        <p
          role="alert"
          className="mt-1 h-5 text-sm text-destructive-soft"
          style={{ visibility: error ? "visible" : "hidden" }}
        >
          {error || " "}
        </p>
      </div>

      {loading && <p className="mt-8 text-fg-muted">Loading…</p>}

      {empty && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-fg-muted">Nothing has been deleted recently.</p>
        </div>
      )}

      {/* The failure said plainly, with the way to try again — never
          dressed up as an empty archive. */}
      {state === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-fg-muted">
            This list could not be loaded, so we cannot say what is here.
          </p>
          <button
            type="button"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["channels-archived"] });
              void queryClient.invalidateQueries({ queryKey: ["media-archived"] });
            }}
            className="rounded-full px-5 py-2.5 text-[13px]"
            style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
          >
            Try again
          </button>
        </div>
      )}

      {/* One half arrived and the other did not: show what is real, and
          do not let the missing half read as an empty one. */}
      {partiallyFailed(parts) && (
        <p className="mt-6 text-[13px]" style={{ color: "var(--fg-soft)" }}>
          Some of this could not be loaded, so the list below may be incomplete.
        </p>
      )}

      {state === "ready" && (
        <div className="scroll-thin mt-[2.5vh] min-h-0 flex-1 md:overflow-y-auto pr-1">
          {rows.length > 0 && (
            <p className="mb-3 font-mono text-[10px] tracking-[0.16em] text-fg-faint">
              CHANNELS — {rows.length}
            </p>
          )}
          {/*
            The columns stop being three at every width (M184, F72).

            `grid-cols-3` held down to 0px, so a phone drew three ~96px cards
            and every title truncated to about five characters: "Sunday with
            Family" as "Sunda…", "Removal round trip" as "Remov…". On this
            page that is not a cosmetic loss — it is the page where you
            choose what to restore and what to delete for ever, and you could
            not tell the cards apart.

            Unlike Insights (M183) this needs no separate phone component:
            the card is the same card, and only how many fit in a row
            changes. A whole second implementation would be more code and a
            new thing to drift.

            Above `md` the counts are exactly as they were — three, and four
            from `xl`. Only the widths where titles were clipping move.
          */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {rows.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => setSelected(channel)}
                className="pressable relative aspect-[4/3] overflow-hidden rounded-xl border border-line-soft text-left"
              >
                {channel.cover_url ? (
                  <img
                    src={channel.cover_url}
                    alt=""
                    className="h-full w-full object-cover"
                    style={{ filter: "grayscale(0.7) brightness(0.7)" }}
                    // A deleted channel's files may already be gone; a broken
                    // image icon is a worse answer than a quiet empty frame.
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[rgba(var(--ink),0.03)]">
                    <ImageIcon className="h-7 w-7 text-fg-faint" aria-hidden />
                  </span>
                )}

                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-2/3"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,.9), transparent)" }}
                />

                <span className="absolute inset-x-0 bottom-0 p-4">
                  <span className="t-channel-small block italic opacity-80">
                    {String(channel.number).padStart(2, "0")}
                  </span>
                  <span className="block truncate opacity-90">{channel.title}</span>
                  <span className="block text-xs" style={{ color: "var(--accent-soft)" }}>
                    Deleted{" "}
                    {new Date(channel.archived_at).toLocaleDateString("en-GB", {
                      dateStyle: "medium",
                    })}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* ── Files: the door the remove's confirm always promised ─────── */}
          {fileRows.length > 0 && (
            <>
              <p
                className={`mb-3 font-mono text-[10px] tracking-[0.16em] text-fg-faint ${
                  rows.length > 0 ? "mt-9" : ""
                }`}
              >
                FILES — {fileRows.length}
              </p>
              <ul className="flex flex-col gap-2.5">
                {fileRows.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-3.5 rounded-[14px] border border-line-soft py-2.5 pl-2.5 pr-4"
                  >
                    {file.file_type === "video" ? (
                      <video
                        src={file.url}
                        muted
                        className="h-[60px] w-[60px] flex-none rounded-lg object-cover"
                        style={{ filter: "grayscale(0.7) brightness(0.7)" }}
                      />
                    ) : (
                      <img
                        src={file.url}
                        alt=""
                        className="h-[60px] w-[60px] flex-none rounded-lg object-cover"
                        style={{ filter: "grayscale(0.7) brightness(0.7)" }}
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {file.caption?.trim() || (
                          <span className="italic text-fg-faint">No description</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-faint">
                        {file.channel
                          ? `Channel ${String(file.channel.number).padStart(2, "0")} · ${file.channel.title}`
                          : "Its channel is gone"}
                        {" · deleted "}
                        {new Date(file.archived_at).toLocaleDateString("en-GB", {
                          dateStyle: "medium",
                        })}
                      </p>
                    </div>

                    {/*
                      A file whose channel is itself in the bin cannot come
                      back to a shelf that is not there: restoring the
                      channel brings its photographs with it (the channel
                      restore clears theirs too), so this offers the honest
                      order instead of a button that half-works.
                    */}
                    {file.channel && rows.some((c) => c.id === file.channel?.id) ? (
                      <span className="flex-none text-xs text-fg-faint">
                        Restore its channel first
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={restore.isPending}
                        onClick={() => restore.mutate(file.id)}
                        className="pressable flex-none rounded-md px-3 py-1.5 text-sm disabled:opacity-40"
                        style={{ border: "1px solid var(--line)", color: "var(--accent-soft)" }}
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {selected && (
        <ChannelActionOverlay
          channel={selected}
          mode="deleted"
          canEdit={false}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onDone={(message) => {
            setSelected(null);
            setSuccess(message);
          }}
        />
      )}
    </div>
  );
}
