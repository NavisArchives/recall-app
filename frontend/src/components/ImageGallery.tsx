import { useCallback, useEffect, useRef, useState } from "react";
import { thumb } from "@/lib/thumb";
import type { MediaFile } from "@/types";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";

const ACTIVE_RING = "0 0 0 3px oklch(0.78 0.13 55)";

interface ImageGalleryProps {
  media: MediaFile[];
  /** Lets the surrounding page show detail for whichever photo is active. */
  onActiveChange?: (item: MediaFile | null) => void;
  /**
   * Fires with (index, total) whenever the active position changes — the
   * hook the display's position report hangs from (040). The gallery knows
   * where it is; the page knows which channel it is in, so the page owns
   * the report.
   */
  onPositionChange?: (index: number, total: number) => void;
}

export function ImageGallery({ media, onActiveChange, onPositionChange }: ImageGalleryProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const { setBackdrop, setStatus } = useDisplay();
  const wheelCooldownRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const total = media.length;
  const current = media[index];

  /** Wraps around, so the wheel keeps cycling at either end. */
  const goTo = useCallback(
    (next: number) => {
      if (!total) return;
      setIndex(((next % total) + total) % total);
    },
    [total],
  );

  // The blurred backdrop always mirrors whichever photo is active.
  useEffect(() => {
    if (current?.file_type === "image") setBackdrop(current.url);
    return () => setBackdrop(null);
  }, [current, setBackdrop]);

  useEffect(() => {
    if (!total) return;
    setStatus({
      hint: "Use the arrows for the next photo",
      current: index + 1,
      total,
    });
    onPositionChange?.(index, total);
    return () => setStatus(null);
  }, [index, total, setStatus, onPositionChange]);

  // The remote: arrows move between memories; OK starts or pauses a film.
  useRemoteKeys({
    onPrev: total > 1 ? () => goTo(index - 1) : undefined,
    onNext: total > 1 ? () => goTo(index + 1) : undefined,
    onSelect:
      current?.file_type === "video"
        ? () => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) void video.play().catch(() => {});
            else video.pause();
          }
        : undefined,
  });

  useEffect(() => {
    setFailed(false);
  }, [current?.id]);

  useEffect(() => {
    onActiveChange?.(current ?? null);
  }, [current, onActiveChange]);

  function handleWheel(event: React.WheelEvent) {
    if (wheelCooldownRef.current || total < 2) return;

    const delta =
      Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (Math.abs(delta) < 15) return;

    goTo(index + (delta > 0 ? 1 : -1));
    wheelCooldownRef.current = true;
    setTimeout(() => {
      wheelCooldownRef.current = false;
    }, 350);
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches[0]?.clientX;
    touchStartXRef.current = null;

    if (startX == null || endX == null) return;
    const distance = startX - endX;
    if (Math.abs(distance) < 50) return;

    goTo(index + (distance > 0 ? 1 : -1));
  }

  if (!total) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted">
        No memories yet.
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col justify-center gap-[2.4vh]"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl"
        style={{
          boxShadow: "0 24px 70px rgba(0,0,0,.55)",
          cursor: total > 1 ? "ns-resize" : "default",
        }}
      >
        {failed || !current.url ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-fg-muted">
            This memory could not be loaded.
          </p>
        ) : current.file_type === "video" ? (
          // autoPlay so the film starts without a pointer; if the browser
          // refuses (autoplay policy), OK on the remote starts it instead.
          <video
            key={current.id}
            ref={videoRef}
            src={current.url}
            controls
            autoPlay
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <img
            key={current.id}
            src={current.url}
            alt={`Memory ${index + 1} of ${total}`}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {total > 1 && (
        <>
          {/*
            Scrolls horizontally when a channel has more photos than fit.
            The inner track uses ml-auto so it right-aligns while it fits, and
            still scrolls from the start once it overflows (justify-end would
            clip the leading thumbnails out of reach).
          */}
          <div className="thumb-strip flex-shrink-0 overflow-x-auto">
            <div className="ml-auto flex w-max gap-4">
              {media.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Memory ${i + 1}`}
                  aria-current={i === index}
                  onClick={() => goTo(i)}
                  ref={
                    i === index
                      ? (el) =>
                          el?.scrollIntoView({
                            behavior: "smooth",
                            block: "nearest",
                            inline: "nearest",
                          })
                      : undefined
                  }
                  className="h-[11vh] max-h-[100px] w-[16.5vh] max-w-[150px] flex-none overflow-hidden rounded-lg transition-all"
                  style={{
                    boxShadow: i === index ? ACTIVE_RING : "none",
                    opacity: i === index ? 1 : 0.55,
                  }}
                >
                  {item.url && item.file_type === "image" ? (
                    <img
                      src={thumb(item.url, 320)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-white/10 text-xs">
                      {i + 1}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-shrink-0 justify-center gap-3">
            {media.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Go to memory ${i + 1}`}
                onClick={() => goTo(i)}
                className="h-2.5 w-2.5 rounded-full transition-colors"
                style={{
                  background:
                    i === index
                      ? "var(--accent-soft)"
                      : "rgba(var(--ink),.32)",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
