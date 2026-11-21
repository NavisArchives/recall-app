import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { LAST_CHANNEL_KEY } from "@/lib/lastChannel";
import { greetingFor } from "@/lib/greeting";
import { watchHour } from "@/lib/hourTick";
import type { ChannelWithMedia } from "@/types";

/**
 * The current hour, kept current — see `lib/hourTick.ts` for why this is not
 * simply `new Date().getHours()`, and why the loop lives outside React.
 */
function useHourOfDay() {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => watchHour(setHour), []);
  return hour;
}

export function Home() {
  const { setBackdrop, subjectName } = useDisplay();

  /*
   * Her own name, or none at all.
   *
   * This line held a string literal from the single-family era, so every
   * family's screen said good evening to Margaret — the Fourniers' display
   * greeted her by name on Margaret's own television. While the name loads,
   * or if it cannot be read, the greeting simply drops it: nameless is
   * impersonal, wrong is somebody else's mother.
   */
  /*
   * Four bands, and one of them says nothing about the time (M172).
   *
   * This was `hour >= 18 ? "Good evening" : "Good morning"` — two bands, so
   * everything from midnight to 17:59 was "Good morning". At three in the
   * morning her screen told her the day had started, next to a clock reading
   * 03:00. For someone who wakes disoriented at night that is not a cosmetic
   * slip; it is the screen confidently asserting the wrong thing about where
   * she is in the day, which is the one thing this display exists to get
   * right. Afternoon was missing entirely.
   *
   * The night band greets her by name and stops. Not "Good night" — that
   * instructs her to bed, and it is not this screen's place to tell her what
   * to do with her own night.
   */
  const hour = useHourOfDay();
  const { lead: greetingLead, name: greetingName } = greetingFor(hour, subjectName);

  // The last memory she looked at glows behind the welcome, so this screen
  // feels like a room she has been in rather than an empty one.
  const lastNumber = localStorage.getItem(LAST_CHANNEL_KEY);

  const { data: last } = useQuery({
    queryKey: ["channel", lastNumber],
    queryFn: () => api.get<ChannelWithMedia>(`/channels/${lastNumber}`),
    enabled: !!lastNumber,
    retry: false,
  });

  useEffect(() => {
    const photo = last?.media?.find((m) => m.file_type === "image");
    if (photo?.url) setBackdrop(photo.url);
    return () => setBackdrop(null);
  }, [last, setBackdrop]);

  return (
    /*
      Home, to display spec 24ab. Sizes are the spec's design pixels over
      14.4 (its 1440-wide space), so the screen scales with the television
      rather than assuming one.
    */
    <div className="flex h-full flex-col items-center justify-center px-[4vw] text-center">
      <p
        className="font-mono uppercase"
        style={{ fontSize: "0.9vw", letterSpacing: ".38em", color: "rgba(242,241,238,.55)" }}
      >
        Welcome to Recall
      </p>

      <h1
        className="mt-[1.6vh]"
        style={{ font: "300 5.83vw/1.05 Roboto, sans-serif", color: "#F2F1EE" }}
      >
        {greetingLead}
        <span style={{ color: "#E29A68" }}>{greetingName}</span>
        {/* Non-breaking space keeps the line's height while the name loads,
            so the two cards below do not jump up and settle. */}
        {!greetingLead && !greetingName ? "\u00a0" : ""}
      </h1>

      <p
        className="mt-[2.7vh]"
        style={{ font: "300 1.6vw/1.4 Roboto, sans-serif", color: "rgba(242,241,238,.66)" }}
      >
        How would you like to begin?
      </p>

      {/*
        Both cards are INFORMATIONAL, and that is why neither has a focus
        state: the NFC reader is a keyboard that types digits, so both routes
        into the archive are blind. Nothing here is clickable because nothing
        here is pointed at.
      */}
      <div className="mt-[5.7vh] flex flex-wrap items-stretch justify-center gap-[1.53vw]">
        <div
          className="flex flex-col items-start text-left"
          style={{
            width: "25vw",
            padding: "1.67vw 1.94vw",
            borderRadius: "1.25vw",
            border: "1px solid rgba(242,241,238,.3)",
            background: "rgba(11,11,12,.5)",
          }}
        >
          <span
            aria-hidden
            style={{ width: "0.69vw", height: "0.69vw", borderRadius: "50%", background: "#C87941" }}
          />
          <p className="mt-[1.4vh]" style={{ font: "400 1.53vw/1.3 Roboto, sans-serif", color: "#F2F1EE" }}>
            Place a card on the reader
          </p>
          <p
            className="mt-[0.9vh] font-mono uppercase"
            style={{ fontSize: "0.83vw", letterSpacing: ".16em", color: "rgba(242,241,238,.55)" }}
          >
            It opens by itself
          </p>
        </div>

        <div
          className="flex flex-col items-start text-left"
          style={{
            width: "25vw",
            padding: "1.67vw 1.94vw",
            borderRadius: "1.25vw",
            border: "1px solid rgba(242,241,238,.3)",
            background: "rgba(11,11,12,.5)",
          }}
        >
          {/* The cue is a channel number in the card's own italic — it shows
              the shape of the answer rather than describing it. */}
          <span
            aria-hidden
            style={{ font: "italic 400 1.81vw/1 Roboto, sans-serif", color: "#E29A68" }}
          >
            02
          </span>
          <p className="mt-[1.4vh]" style={{ font: "400 1.53vw/1.3 Roboto, sans-serif", color: "#F2F1EE" }}>
            Type a channel number
          </p>
          <p
            className="mt-[0.9vh] font-mono uppercase"
            style={{ fontSize: "0.83vw", letterSpacing: ".16em", color: "rgba(242,241,238,.55)" }}
          >
            Two digits, like on the cards
          </p>
        </div>
      </div>
    </div>
  );
}
