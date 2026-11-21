import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

/**
 * Speak the description instead of typing it (owner, 17 Sep 2026: "add a
 * little dictation microphone to the description… a green microphone").
 *
 * It wears the family's accent, not a colour of its own — the owner was
 * looking at the green workspace when they asked for a green microphone, and
 * the same control has to be blue in the blue one. So it is drawn with the
 * chip pair, filled solid, exactly like every other on/off control on these
 * pages, and it sits in the lower-right corner of the box it writes into.
 *
 * WHAT IT WRITES. Each finished phrase is handed to `onText` as a chunk and
 * the caller appends it. Interim results are deliberately off: showing a
 * guess that then rewrites itself inside a textarea someone may also be
 * typing in is how dictation eats a sentence, and these are descriptions of
 * photographs — a family will say a phrase, stop, and look at it.
 *
 * WHERE THE LANGUAGE COMES FROM. `navigator.language`, not the product's own
 * switch. The workspace is English for now while the families are Belgian, so
 * the product's language is the wrong guess about the language they SPEAK;
 * the browser they installed is a much better one. A caller that knows better
 * can pass `lang`.
 *
 * IT DISAPPEARS WHERE IT CANNOT WORK. Firefox ships no SpeechRecognition at
 * all, so the button is not rendered there rather than rendered and dead —
 * an affordance that does nothing when pressed is worse than one that was
 * never offered.
 */

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}
interface SpeechResultListLike {
  readonly length: number;
  [index: number]: SpeechResultLike;
}
interface SpeechEventLike {
  readonly resultIndex: number;
  readonly results: SpeechResultListLike;
}
interface SpeechErrorLike {
  readonly error: string;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition ?? null;
}

/** Is there a speech recogniser in this browser at all? */
export function dictationWorks(): boolean {
  return ctor() !== null;
}

export function Dictate({
  onText,
  lang,
  title = "Dictate the description",
}: {
  /** One finished phrase. The caller decides where it goes. */
  onText: (chunk: string) => void;
  /** BCP-47, e.g. "nl-BE". Defaults to the browser's own language. */
  lang?: string;
  title?: string;
}) {
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const engine = useRef<RecognitionLike | null>(null);

  /*
    The sink is held in a ref because the recogniser outlives a render: the
    handler is attached once when listening starts, and `onText` is almost
    always an inline arrow, so capturing it would freeze this button on the
    photograph that was open when it was pressed.
  */
  const sink = useRef(onText);
  useEffect(() => {
    sink.current = onText;
  }, [onText]);

  /* Leaving the page — or the pop-up moving to the next photograph — must
     not leave a microphone open behind it. */
  useEffect(
    () => () => {
      engine.current?.abort();
      engine.current = null;
    },
    []
  );

  if (!dictationWorks()) return null;

  function stop() {
    engine.current?.stop();
    setOn(false);
  }

  function start() {
    const Ctor = ctor();
    if (!Ctor) return;
    setProblem(null);
    const rec = new Ctor();
    rec.lang = lang ?? navigator.language ?? "en-GB";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let phrase = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) phrase += result[0].transcript;
      }
      const text = phrase.trim();
      if (text) sink.current(text);
    };
    rec.onerror = (event) => {
      /* "aborted" is what a deliberate stop looks like from in here, and
         "no-speech" is somebody thinking. Neither is worth a red line. */
      if (event.error === "aborted" || event.error === "no-speech") return;
      setProblem(
        event.error === "not-allowed"
          ? "The microphone is blocked in this browser."
          : "Dictation stopped. You can type instead."
      );
      setOn(false);
    };
    rec.onend = () => setOn(false);
    engine.current = rec;
    rec.start();
    setOn(true);
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => (on ? stop() : start())}
        aria-pressed={on}
        aria-label={on ? "Stop dictating" : title}
        title={problem ?? (on ? "Listening — press to stop" : title)}
        /* Solid, not outlined (owner, 17 Sep 2026: "fill the microphone with
           a solid color"). It is the same chip pair every on/off control on
           these pages uses, so it is green in the green workspace and blue in
           the blue one without knowing either colour. */
        className="pressable flex h-7 w-7 flex-none items-center justify-center rounded-full transition-colors"
        style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
      >
        <Mic size={13} strokeWidth={2.2} aria-hidden />
      </button>
      {on && (
        /* A ring that breathes, so "it is listening" is visible from across
           the room — the fill cannot say it any more now that the resting
           state is filled too. */
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            border: "1.5px solid rgba(var(--accent-channels),.55)",
            animation: "pulse 1.4s ease infinite",
          }}
        />
      )}
    </span>
  );
}
