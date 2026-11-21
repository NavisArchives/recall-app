import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { isGenuinelyMissing } from "@/lib/missingOrUnreachable";
import { PageFrame, PageHeader, GhostPill } from "@/components/admin/kit";
import { ChannelReadOnly } from "./ChannelReadOnly";
import type { ChannelWithMedia } from "@/types";

/**
 * A channel, seen and not touched — the preview the create flow promised
 * (M147).
 *
 * 2e's last line offered to show the family what they had just made, and
 * had nowhere honest to send them: `/channel/NN` is Margaret's display,
 * guarded by the device session, so a mother on her phone pressing it would
 * have been refused; the editor is the opposite mistake, opening a page of
 * controls to somebody who only asked to look. So the read-only view the
 * shelf already uses for a channel that is not yours gets a route of its
 * own, reachable by an ordinary signed-in family session.
 *
 * It changes nothing on her screen. Opening a preview is a private act in
 * the workspace: no channel change is issued, no visit is recorded, and the
 * living room carries on with whatever it was showing.
 */
export function ChannelPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setStatus } = useDisplay();

  useEffect(() => {
    setStatus({ hint: "PREVIEW" });
    return () => setStatus(null);
  }, [setStatus]);

  const {
    data: channel,
    isLoading,
    error,
  } = useQuery({
    // The archive comes from the session on the server; a channel id from
    // another family is simply not found (M02).
    queryKey: ["channel", id],
    queryFn: () => api.get<ChannelWithMedia>(`/channels/detail/${id}`),
    enabled: !!id,
    retry: false,
  });

  return (
    <PageFrame
      type="roster"
      header={
        <PageHeader
          title={channel ? channel.title : "Preview"}
          /*
            The subtitle said "Loading the channel…" for anything that was
            not a loaded channel — so a failed load put "Loading…" in the
            header while the body underneath explained the failure. Two
            answers on one screen, and the reassuring one on top.
          */
          subtitle={
            channel
              ? `Channel ${String(channel.number).padStart(2, "0")} · seen as it is, not edited here`
              : error
                ? ""
                : "Loading the channel…"
          }
          actions={<GhostPill onClick={() => navigate("/admin/shelf")}>Back to the shelf</GhostPill>}
        />
      }
    >
      {isLoading && <p style={{ color: "var(--fg-soft)" }}>Loading…</p>}

      {/*
        A channel that is not this family's comes back as a plain refusal,
        and the page says the true thing rather than the technical one.

        But it used to say that for *every* refusal (M201). On a 503 it
        told somebody their channel was not in the archive — a confident,
        specific, wrong cause, and one that sends a person looking for who
        deleted a memory that is sitting there safely. Only a 404 is the
        archive answering; anything else is us failing to ask.
      */}
      {error && !isLoading && (
        <p style={{ color: "var(--fg-soft)" }}>
          {isGenuinelyMissing(error)
            ? "That channel is not in this archive."
            : "This channel could not be loaded, so we cannot say whether it is here."}
        </p>
      )}

      {channel && <ChannelReadOnly channel={channel} />}
    </PageFrame>
  );
}
