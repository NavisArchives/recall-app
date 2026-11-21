import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SubjectProfile } from "@/types";

/** Contextual status shown in the top-right of the header, set by the active page. */
export interface DisplayStatus {
  hint?: string;
  current?: number;
  total?: number;
  /**
   * What the counter counts — `STEP 1 OF 6` on a guide, plain `1 OF 6`
   * everywhere else (24h). A word, not a format string.
   */
  counterNoun?: string;
}

interface DisplayContextValue {
  backdrop: string | null;
  setBackdrop: (url: string | null) => void;
  /**
   * A moving backdrop, for the one channel type that has no still to show.
   *
   * A film usually carries no separate poster image, so `setBackdrop` has
   * nothing to be given and the room behind her television goes black — on
   * the one screen that is showing something in colour. This takes the film
   * itself, blurred past recognition by the same rule as any photograph. It
   * is a colour, not a second screening.
   *
   * Set one or the other, never both: the still wins if a channel has one,
   * because decoding a video twice to tint a wall is a poor trade.
   */
  backdropVideo: string | null;
  setBackdropVideo: (url: string | null) => void;
  status: DisplayStatus | null;
  setStatus: (status: DisplayStatus | null) => void;
  /**
   * Whose screen this is — her familiar first name, from this archive's own
   * settings.
   *
   * Null while it loads, and null if it cannot be read. Every screen that
   * greets her must cope with that by greeting her without a name, because
   * the one thing worse than an impersonal hello is a hello addressed to
   * somebody else's mother.
   */
  subjectName: string | null;
}

const DisplayContext = createContext<DisplayContextValue | null>(null);

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [backdropVideo, setBackdropVideo] = useState<string | null>(null);
  const [status, setStatus] = useState<DisplayStatus | null>(null);

  /*
   * Fetched once, here, rather than by each screen that wants it.
   *
   * The settings row is the archive's own — a device session is enough to
   * read it — and the display asks rarely: the subject's name does not
   * change while she is looking at it.
   */
  const { data: subject } = useQuery({
    queryKey: ["display-subject"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const value = useMemo(
    () => ({
      backdrop,
      setBackdrop,
      backdropVideo,
      setBackdropVideo,
      status,
      setStatus,
      subjectName: subject?.display_name?.trim() || null,
    }),
    [backdrop, backdropVideo, status, subject]
  );

  return (
    <DisplayContext.Provider value={value}>
      {backdrop && (
        <div className="recall-backdrop" style={{ backgroundImage: `url(${backdrop})` }} />
      )}
      {/*
        Same class, so it is the same wall: fixed, inset −40px, behind the
        header and everything else. Painting it inside the page instead left
        the header band sitting on flat black above a coloured room, which is
        exactly what it looked like.
      */}
      {!backdrop && backdropVideo && (
        <video
          className="recall-backdrop"
          style={{ objectFit: "cover" }}
          src={backdropVideo}
          muted
          loop
          autoPlay
          playsInline
          aria-hidden
        />
      )}
      <div className="recall-scrim" />
      {children}
    </DisplayContext.Provider>
  );
}

export function useDisplay() {
  const ctx = useContext(DisplayContext);
  if (!ctx) throw new Error("useDisplay must be used within a DisplayProvider");
  return ctx;
}
