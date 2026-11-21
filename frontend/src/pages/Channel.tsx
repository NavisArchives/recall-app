import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ImageGallery } from "@/components/ImageGallery";
import { ChannelNotFound } from "@/components/ChannelNotFound";
import { Guide } from "@/components/Guide";
import { VideoScreen } from "@/components/display/VideoScreen";
import { StoriesScreen } from "@/components/display/StoriesScreen";
import { ChannelIntro } from "@/components/display/ChannelIntro";
import { px } from "@/lib/designSpace";
import { ContributorChip } from "@/components/display/ContributorChip";
import { rememberChannel } from "@/lib/lastChannel";
import { api } from "@/lib/api";
import { startVisit, endVisit, noteMediaViewed, type EntryMethod } from "@/lib/sessionTracker";
import type { ChannelWithMedia, MediaFile } from "@/types";

export function Channel() {
  const { number } = useParams<{ number: string }>();
  const location = useLocation();
  const [activePhoto, setActivePhoto] = useState<MediaFile | null>(null);
  const firstPhoto = useRef(true);

  const handleActiveChange = useCallback((item: MediaFile | null) => {
    setActivePhoto(item);
    // The first photograph arrives with the channel and is already counted;
    // every one after it is another she chose to look at.
    if (firstPhoto.current) firstPhoto.current = false;
    else noteMediaViewed();
  }, []);

  const {
    data: channel,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["channel", number],
    queryFn: () => api.get<ChannelWithMedia>(`/channels/${number}`),
    enabled: !!number,
  });

  // Home shows the last memory she opened glowing behind the welcome. This
  // must sit above the early returns — a hook cannot run conditionally.
  useEffect(() => {
    if (channel && number) rememberChannel(number);
  }, [channel, number]);

  /*
    Which photograph is up (040), debounced. The gallery calls on every
    position change; arrows and the wheel can move several times a second,
    and each report is a database write, so the report waits 400ms for the
    browsing to settle. Fire-and-forget with a swallowed catch, exactly like
    the channel report below — her screen never surfaces a reporting error.
  */
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePositionChange = useCallback(
    (index: number, total: number) => {
      if (!number) return;
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(() => {
        void api
          .post("/screen-state", {
            number: Number(number),
            photo_index: index,
            photo_count: total,
          })
          .catch(() => {});
      }, 400);
    },
    [number]
  );
  useEffect(
    () => () => {
      if (positionTimer.current) clearTimeout(positionTimer.current);
    },
    []
  );

  // What her screen is showing, so the dashboard can say so, and one visit
  // recorded for as long as this channel stays open.
  useEffect(() => {
    if (!channel || !number) return;

    const entry = ((location.state as { entry?: EntryMethod } | null)?.entry ??
      "direct") as EntryMethod;

    /*
      The channel report, carrying this build's version (041). This POST is
      the display's only regular contact with the backend — there is no
      separate heartbeat — so it is where the machine says what it is
      running. Once per channel open is plenty: a version changes on deploy,
      not between photographs, and the position reports below deliberately
      leave it out rather than rewriting an unchanged string all evening.
    */
    void api
      .post("/screen-state", { number: Number(number), software_version: __APP_VERSION__ })
      .catch(() => {});
    void startVisit(channel.id, Number(number), entry);

    return () => {
      void endVisit();
    };
    // Only the channel identity matters here; re-running on state changes
    // would split one visit into several.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id, number]);

  if (isLoading) {
    return <p className="flex h-full items-center justify-center text-fg-muted">Loading…</p>;
  }

  if (error || !channel) {
    return <ChannelNotFound number={number} />;
  }

  // Per-photo detail when the active photo has its own; otherwise the channel's.
  /*
   * The screen says only what the family told us (059).
   *
   * This printed the day whenever a photograph carried a date — and every
   * screen that writes one is a MONTH picker that appends "-01". So a
   * photograph dated "August 1978" was read to Margaret as "1 August 1978":
   * a day nobody chose, stated as fact, to someone who cannot check it. The
   * day now appears only when `taken_precision` says the day is real, and a
   * year-only date prints as a year.
   */
  const displayDate = activePhoto?.taken_on ?? channel.date;
  const precision = activePhoto?.taken_on ? (activePhoto.taken_precision ?? "month") : "month";
  const formattedDate = displayDate
    ? new Date(displayDate).toLocaleDateString("en-GB", {
        ...(precision === "day" ? { day: "numeric" } : {}),
        ...(precision === "year" ? {} : { month: "long" }),
        year: "numeric",
      })
    : null;

  /*
   * An instruction channel is a guide, not an album (M91).
   *
   * The family could create this content type from the day M38 landed; the
   * display never learned to show it, so "Making coffee" arrived as nine
   * thumbnails — which is the one thing a guide must not be, because a grid
   * asks you to choose and choosing is the hard part. Each photograph and its
   * caption is one step, in the order the channel already stores.
   *
   * This sits below every hook and below the loading and not-found returns,
   * so the visit, the screen-state and the last-channel memory are recorded
   * exactly as they are for any other channel.
   */
  if (channel.content_type === "instruction") {
    const steps = [...channel.media]
      .sort((a, b) => a.display_order - b.display_order)
      .map((item) => ({ id: item.id, text: item.caption, imageUrl: item.url }));

    return (
      <Guide
        label={channel.title}
        steps={steps}
        // The first step arrives with the channel and is already counted;
        // every one after it is another she chose to look at.
        onStepChange={() => {
          if (firstPhoto.current) firstPhoto.current = false;
          else noteMediaViewed();
        }}
      />
    );
  }

  /*
    A film gets its own screen (spec 24d), and `documentary` is the same
    screen — the type is retired visually, so a family that chose it is not
    shown a second, slightly different way of watching one video.
  */
  if (channel.content_type === "video" || channel.content_type === "documentary") {
    return <VideoScreen channel={channel} />;
  }

  /* A voice message (spec 24b): the photograph is the room, the waveform is
     the screen, OK is pause. Its own component for the same reason the film
     has one — nothing about the album grammar survives contact with it. */
  if (channel.content_type === "stories") {
    return <StoriesScreen channel={channel} />;
  }

  const displayText = activePhoto?.caption ?? channel.description;

  /*
   * The eyebrow says what the channel actually is.
   *
   * It used to be `album ? "album" : "video"`, so a documentary announced
   * itself as a video and an instruction did too. The type is already the
   * display's own vocabulary — album, video, documentary, instruction — so
   * there is nothing to translate.
   */
  const kind = channel.content_type;

  return (
    // Both columns start at the top: the title sits level with the top of the
    // photograph, and every element below holds a reserved place so changing
    // text never moves anything else on the screen.
    /*
      One design for every type (owner-directed).

      The order is the correction: **type · date** on one small line, then the
      title, then the description — the album used to run type → title →
      date-on-its-own-line, which reads as a subtitle to the memory rather
      than as a fact about it, and no other type was drawn that way.

      The words share `ChannelIntro` with the film screen and the chip sits in
      its one fixed place, so the two cannot drift into two designs again.
    */
    <div
      className="relative flex h-full min-h-0"
      /* 56px margins and a 4vw gutter, from the spec — `px-[4vw]` was 57.6
         and put the column 1.6px off every other screen's left edge. */
      style={{ paddingLeft: px(56), paddingRight: px(56), gap: px(56), paddingBottom: px(24) }}
    >
      <div className="flex w-[29%] flex-none flex-col" style={{ paddingTop: px(100) }}>
        <ChannelIntro
          /*
            24e names who added it rather than when — the WHEN is the amber
            line below, because it changes with every photograph and the
            title never does. Amber is spent on the one thing that moves.
          */
          eyebrow={
            channel.author
              ? `${kind} · Added by ${channel.author.name}`
              : kind
          }
          title={channel.title}
          titleSize={56}
          accent={formattedDate || null}
          description={displayText}
          descriptionSize={22}
        />
      </div>

      <ContributorChip author={channel.author} />

      <div className="h-full min-h-0 min-w-0 flex-1 py-[3vh]">
        <ImageGallery
          media={channel.media}
          onActiveChange={handleActiveChange}
          onPositionChange={handlePositionChange}
        />
      </div>
    </div>
  );
}
