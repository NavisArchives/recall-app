import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ImageIcon, Mic, Search, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { useAsk, useChannels, type AskSnippet, type MatchRange } from "@/hooks/useAdminData";
import { NowPlayingBar } from "@/components/admin/NowPlayingBar";
import { placeholderProps } from "@/lib/placeholder";

/**
 * The ask flow, frames 8c → 8a → 8b: one page, three states.
 *
 * 8c is the invitation — an empty bar, the mic listening, two starter
 * questions that teach what kinds of question land. 8a is the same bar with
 * words in it: a dropdown offers the search action and the last few asks.
 * 8b is the answer, in the design's two strict levels: first a sentence,
 * then — under WHERE IT LIVES — the channels that hold it, showing only the
 * matched photographs.
 *
 * **This page says "memories" where it speaks to the family** (M155). The
 * owner asked for the answer to read "found in 3 memories", and a screen
 * that then said "Open channel" underneath was asking one person to hold
 * two nouns for one thing. So the headline, the scope hint and the card's
 * button all use the family's word.
 *
 * Everything under the surface is still a **channel** — the data model, the
 * routes, the numbers, Memory Shelf, the display and the NFC cards — and
 * the comments in this file keep that word deliberately. Whether the rest
 * of the product should follow this page is the owner's open question, not
 * a gap to be tidied: do not rename outward from here without it.
 *
 * The frames' deepest rule is carried in the layout: the now-playing bar
 * stays at the foot of 8c and 8a because asking the archive NEVER touches
 * her screen, and the bar proves it by keeping the screen in view. The
 * answer screen drops the bar (the frame does), because by then you are
 * reading, and "Play on Margaret's screen" beside each result is the
 * explicit, separate act of changing what she sees — drawn, but a
 * registered holder until a push path exists (nothing in the product can
 * change the display remotely; the sockets went in M-early, deliberately).
 *
 * The answer's subline says what was actually searched. The design's copy
 * reads "matched in captions and voice notes" — but there are no voice
 * notes (`corpus.voice_notes.available: false`, M104 declares the gap), and
 * this page will not claim a corpus it does not have.
 */

const RECENT_KEY = "recall.recent-asks";

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string) {
  const next = [q, ...readRecents().filter((r) => r !== q)].slice(0, 6);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* a full or blocked store loses the nicety, never the ask */
  }
}

/** The channels that hold it: photo snippets grouped under their channel. */
interface ChannelGroup {
  channel_id: string;
  channel_number: number;
  channel_title: string;
  photos: { media_id: string; media_url: string | null }[];
  channelMatched: boolean;
  /*
    The words that did the matching, and the text they matched in (owner,
    10 Aug). A card that says "its title or description says it" above a
    title plainly not containing the word is a claim the family cannot
    check — the description is the half they never see. When a search for
    "pet" answered with a channel whose description said "petite", there
    was nothing on the card to explain it, and an unexplained match reads
    as an invented one. So the evidence comes with the claim.
  */
  matchedIn: string | null;
  matchedRanges: MatchRange[];
}

function groupByChannel(results: AskSnippet[]): ChannelGroup[] {
  const groups = new Map<string, ChannelGroup>();
  for (const s of results) {
    if (!("channel_id" in s.provenance)) continue;
    const p = s.provenance;
    let g = groups.get(p.channel_id);
    if (!g) {
      g = {
        channel_id: p.channel_id,
        channel_number: p.channel_number,
        channel_title: p.channel_title,
        photos: [],
        channelMatched: false,
        matchedIn: null,
        matchedRanges: [],
      };
      groups.set(p.channel_id, g);
    }
    if (s.source === "photo" && p.media_id) {
      g.photos.push({ media_id: p.media_id, media_url: p.media_url ?? null });
    }
    if (s.source === "channel") {
      g.channelMatched = true;
      g.matchedIn = s.text;
      // The ranges belong to this snippet's own text; they are never mixed
      // with another snippet's, or they would point into the wrong string.
      g.matchedRanges = s.matches;
    }
  }
  return [...groups.values()].sort((a, b) => b.photos.length - a.photos.length);
}

/**
 * The matched text with the matched words marked, so the eye lands on the
 * reason a memory is on screen.
 *
 * This component decides nothing (M154). It is handed the character ranges
 * the matcher itself produced and marks exactly those. It used to re-run
 * the backend's fold and same-word rules here in the browser — two
 * implementations of one rule, agreeing by luck — and the day they
 * disagreed, this card would have underlined a word that did not cause the
 * result. Evidence computed by different code than the claim is not
 * evidence; it is a second opinion. So there is no rule left in this file
 * to drift, and adding one back would be the bug.
 */
function Evidence({ text, matches }: { text: string; matches: MatchRange[] }) {
  if (matches.length === 0) return <>{text}</>;

  const out: ReactNode[] = [];
  let at = 0;
  for (const [i, r] of matches.entries()) {
    // Defensive only against a malformed payload, never a second opinion
    // about what should be marked.
    if (r.start < at || r.end > text.length) continue;
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(
      <em
        key={i}
        style={{ color: "rgba(var(--ink-cream),.95)", fontStyle: "normal", fontWeight: 500 }}
      >
        {text.slice(r.start, r.end)}
      </em>
    );
    at = r.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

type Stage = "idle" | "typing" | "answer";

export function AskPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { subjectName, setStatus } = useDisplay();
  const subject = subjectName?.trim() || "the family";

  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const stage: Stage = asked ? "answer" : query.trim() ? "typing" : "idle";
  const { data: answer, isLoading } = useAsk(asked);
  const { data: channels } = useChannels();

  useEffect(() => {
    setStatus({ hint: "ASK" });
    return () => setStatus(null);
  }, [setStatus]);

  /*
    The mic opens live when the page does (8c: "MIC ON"). Real speech-to-
    text through the browser's own engine where it exists; where it does
    not, the button is a registered holder rather than a dead control. The
    transcript lands in the same bar as typing — M104's route treats spoken
    and typed questions as the same query.
  */
  const micSupported = useMemo(() => {
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  const stopMic = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startMic = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-GB";
      rec.onresult = (e) => {
        const text = Array.from(e.results)
          .map((r) => r[0]?.transcript ?? "")
          .join(" ")
          .trim();
        if (text) setQuery(text);
        if (e.results[e.results.length - 1]?.isFinal) setListening(false);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recognitionRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  useEffect(() => {
    if (micSupported) startMic();
    return () => stopMic();
    // Once, as the page opens — the mic is 8c's opening state, not a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    (q: string) => {
      const clean = q.trim();
      if (!clean) return;
      stopMic();
      pushRecent(clean);
      setQuery(clean);
      setAsked(clean);
    },
    [stopMic]
  );

  /*
    Three ways out, one behaviour: the × in the corner, a press on the empty
    dark, and Esc. Esc alone steps back through the answer first — a keyboard
    user is mid-task and expects to undo one level — while the × and the
    backdrop are unambiguous "I am done here", so they leave outright.
  */
  const leave = useCallback(() => {
    stopMic();
    navigate("/admin");
  }, [navigate, stopMic]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (asked) setAsked("");
      else leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asked, leave]);

  /*
    Pressing the empty dark leaves (owner). "Empty" is decided by an explicit
    opt-in rather than by `e.target === e.currentTarget`: the page is a stack
    of nested boxes, so target-equality would fire on any padding a layout
    happens to leave — including the strip beside the bar. Every region that
    is *something* carries `data-ask-surface`, and a press that closes to one
    of those is a press on the page, not on the way out.

    `onMouseDown` rather than `onClick`, so a text selection that starts on a
    result and releases over the dark does not read as "leave".
  */
  const onBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-ask-surface]")) return;
      leave();
    },
    [leave]
  );

  const recents = useMemo(readRecents, [asked]);
  const groups = useMemo(() => groupByChannel(answer?.results ?? []), [answer]);
  const matchedPhotos = (answer?.results ?? []).filter((s) => s.source === "photo").length;
  const initial = (profile?.name ?? "?").charAt(0).toUpperCase();
  void initial;

  /*
    What to put in the quotation marks (owner, 10 Aug).

    Not the question. The page used to title-case the whole sentence and
    announce that *it* had been found — "'Did She Hang Out With A Cat' has
    been found in 4 channels" — which is a specific, confident claim about
    a sentence the archive has never seen. The archive recognised one word
    of it, and now says so: the person's name in its own spelling, else
    the words that actually matched.

    `asked` remains the fallback for the one case with nothing to name —
    an empty answer, where quoting the question back is honest.
  */
  const found = answer?.subject.label ?? null;
  // A recognised name is already spelled the way the archive spells it;
  // only the fallback needs tidying.
  const titleCased = found ?? asked.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

  return (
    <div
      onMouseDown={onBackdrop}
      className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[30px] pt-2"
    >
      {/*
        The way out, top right (owner). It reads as an exit rather than as
        the bar's clear-the-question ×: it sits in the page's corner, not in
        a field, and it says so to a screen reader.
      */}
      <button
        type="button"
        data-ask-surface
        onClick={leave}
        aria-label="Close the ask and go back to the Overview"
        title="Close (Esc)"
        className="absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[rgba(var(--ink),.06)]"
        style={{ border: "1px solid rgba(var(--ink),.16)" }}
      >
        <X size={17} strokeWidth={1.7} style={{ color: "rgba(var(--ink-cream),.75)" }} aria-hidden />
      </button>

      {/* ── The bar: centred while idle (8c), lifted while asking (8a/8b) ── */}
      <div
        className={`flex flex-none flex-col items-center ${
          stage === "idle" ? "mt-[18vh]" : "mt-[26px]"
        }`}
      >
        {stage === "idle" && (
          <div
            className="mb-5 font-mono text-[10px] tracking-[0.2em]"
            style={{ color: "var(--fg-hint)" }}
          >
            ASK ABOUT {subject.toUpperCase()}'S ARCHIVE
          </div>
        )}

        <div
          data-ask-surface
          className="flex h-[58px] w-full max-w-[720px] items-center gap-3 rounded-full pl-6 pr-2"
          style={{
            background: "rgba(var(--ink),.07)",
            border:
              stage === "idle"
                ? "1.5px solid rgba(var(--ink),.16)"
                : "1.5px solid rgba(var(--accent-channels),.55)",
            boxShadow: stage === "idle" ? undefined : "0 20px 60px rgba(0,0,0,.45)",
          }}
        >
          <Search size={15} strokeWidth={1.7} style={{ color: "var(--fg-soft)" }} aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (asked) setAsked("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(query);
            }}
            placeholder="Speak, or type a question…"
            aria-label={`Ask about ${subject}'s archive`}
            className="w-full bg-transparent text-[16px] outline-none placeholder:font-light placeholder:italic"
            style={{ color: "var(--cream)" }}
          />
          {asked ? (
            <button
              type="button"
              aria-label="Clear the question"
              onClick={() => {
                setAsked("");
                setQuery("");
                inputRef.current?.focus();
              }}
              className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full"
              style={{ border: "1px solid rgba(var(--ink),.16)" }}
            >
              <X size={16} style={{ color: "rgba(var(--ink-cream),.75)" }} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label={
                micSupported
                  ? listening
                    ? "Listening — press to stop"
                    : "Ask by voice"
                  : "Ask by voice — not available in this browser"
              }
              {...(micSupported ? {} : placeholderProps("ask.voice"))}
              disabled={!micSupported}
              onClick={() => (listening ? stopMic() : startMic())}
              className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full disabled:opacity-40"
              style={{ background: "var(--chip-round)" }}
            >
              <Mic size={18} strokeWidth={1.7} color="var(--on-chip-round)" aria-hidden />
            </button>
          )}
        </div>

        {stage === "idle" && micSupported && (
          <div className="mt-4 flex items-center gap-2" aria-live="polite">
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: listening ? "var(--live-amber)" : "rgba(var(--ink),.2)" }}
            />
            <span
              className="font-mono text-[9px] tracking-[0.16em]"
              style={{ color: listening ? "var(--live-amber)" : "var(--fg-dim)" }}
            >
              {listening ? "MIC ON" : "MIC OFF"}
            </span>
          </div>
        )}

        {/* ── 8a: the dropdown under a live query ───────────────────────── */}
        {stage === "typing" && (
          <div
            data-ask-surface
            className="mt-3 w-full max-w-[720px] rounded-[22px] p-[10px_10px_14px]"
            style={{
              background: "var(--panel-field)",
              border: "1px solid rgba(var(--ink),.12)",
              boxShadow: "var(--shadow-sheet)",
            }}
          >
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex w-full items-center gap-3 rounded-[14px] p-[14px_16px] text-left"
              style={{ background: "rgba(var(--accent-channels),.13)" }}
            >
              <Search size={15} strokeWidth={1.7} style={{ color: "rgba(var(--ink-cream),.75)" }} aria-hidden />
              <span className="flex-1 text-[14px]" style={{ color: "var(--cream)" }}>
                Search the archive for <em>"{query.trim()}"</em>
              </span>
              <span
                className="flex-none rounded-[7px] px-[9px] py-[5px] font-mono text-[10px] font-medium"
                style={{ border: "1px solid rgba(var(--ink),.2)", color: "rgba(var(--ink-cream),.75)" }}
              >
                ENTER
              </span>
            </button>

            {recents.length > 0 && (
              <>
                <div
                  className="p-[16px_16px_8px] font-mono text-[9px] tracking-[0.16em]"
                  style={{ color: "var(--fg-dim)" }}
                >
                  RECENT
                </div>
                {recents.slice(0, 2).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => submit(r)}
                    className="flex w-full items-center gap-3 rounded-[12px] p-[11px_16px] text-left hover:bg-[rgba(var(--ink),.04)]"
                  >
                    <Clock size={13} style={{ color: "var(--fg-quiet)" }} aria-hidden />
                    <span className="text-[13.5px]" style={{ color: "rgba(var(--ink-cream),.75)" }}>
                      {r}
                    </span>
                  </button>
                ))}
              </>
            )}

            <div
              className="mt-[10px] p-[12px_16px_2px] text-[11px] leading-[1.4]"
              style={{
                color: "rgba(var(--ink-cream),.4)",
                borderTop: "1px solid rgba(var(--ink),.07)",
              }}
            >
              Searches your memories — titles, descriptions and photo captions.
            </div>
          </div>
        )}

        {/* ── 8c: the starters and the reassurance ──────────────────────── */}
        {stage === "idle" && (
          <>
            <div data-ask-surface className="mt-10 flex items-center gap-2.5">
              <span className="text-[12px]" style={{ color: "var(--fg-dim)" }}>
                Try asking
              </span>
              {["What happened in the garden?", "Who is in the wedding photos?"].map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => {
                    setQuery(starter);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full px-4 py-2 text-[13px]"
                  style={{
                    border: "1px solid rgba(var(--ink),.16)",
                    color: "rgba(var(--ink-cream),.85)",
                  }}
                >
                  {starter}
                </button>
              ))}
            </div>
            <p className="mt-8 max-w-[520px] text-center text-[12px] leading-[1.6]" style={{ color: "var(--fg-dim)" }}>
              Answers come from {subject}'s photos, descriptions and captions — Recall never
              changes what is on the screen.
            </p>
          </>
        )}
      </div>

      {/* ── 8b: the answer, then the channels that hold it ──────────────── */}
      {stage === "answer" && (
        <div data-ask-surface className="scroll-thin mt-[52px] min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading && (
            <p className="text-center text-[14px]" style={{ color: "var(--fg-soft)" }}>
              Reading the archive…
            </p>
          )}

          {answer && (
            <>
              <div className="mx-auto max-w-[860px] text-center">
                <div
                  className="font-mono text-[10px] tracking-[0.2em]"
                  style={{ color: "var(--fg-dim)" }}
                >
                  THE ANSWER
                </div>
                <h2
                  className="mt-4 text-[34px] font-light leading-[1.2]"
                  style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
                >
                  {groups.length > 0 ? (
                    <>
                      "{titleCased}" has been found in{" "}
                      <em>
                        {groups.length} {groups.length === 1 ? "memory" : "memories"}
                      </em>
                    </>
                  ) : (
                    <>"{titleCased}" was not found in the archive</>
                  )}
                </h2>
                <p className="mt-3 text-[14px]" style={{ color: "var(--fg-soft)" }}>
                  {groups.length > 0 ? (
                    matchedPhotos > 0 ? (
                      <>
                        {matchedPhotos} {matchedPhotos === 1 ? "photograph" : "photographs"} across{" "}
                        {subject}'s archive — matched in titles, descriptions and captions.
                      </>
                    ) : (
                      /* Channels matched by their own words, no photographs:
                         "0 photographs across the archive" is true and reads
                         like a failure — say what actually matched. */
                      <>Matched in memory titles and descriptions.</>
                    )
                  ) : (
                    <>
                      Nothing in the titles, descriptions or captions says this yet — a photograph
                      with those words in its caption would answer it. Worth asking the family.
                    </>
                  )}
                </p>
              </div>

              {groups.length > 0 && (
                <>
                  <div className="mt-11 flex items-center gap-4 px-[60px]">
                    <span className="h-px flex-1" style={{ background: "rgba(var(--ink),.1)" }} />
                    <span
                      className="font-mono text-[10px] tracking-[0.2em]"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      WHERE IT LIVES
                    </span>
                    <span className="h-px flex-1" style={{ background: "rgba(var(--ink),.1)" }} />
                  </div>

                  <div className="mx-auto mt-8 flex max-w-[1160px] flex-wrap justify-center gap-5 pb-4">
                    {groups.map((g) => {
                      const full = (channels ?? []).find((c) => c.id === g.channel_id);
                      const total = full?.photo_count ?? full?.media_count ?? null;
                      const matched = g.photos.length;
                      const thumbs = g.photos.slice(0, 3);
                      const overflow = matched - thumbs.length;
                      return (
                        <div
                          key={g.channel_id}
                          className="flex w-[560px] flex-col gap-4 rounded-[26px] p-[24px_26px_22px]"
                          style={{
                            background: "rgba(var(--ink),.045)",
                            border: "1px solid rgba(var(--ink),.09)",
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className="flex-none rounded-[8px] px-2 py-1.5 font-mono text-[12px] leading-none"
                              style={{ background: "rgba(var(--ink),.07)", color: "rgba(var(--ink-cream),.8)" }}
                            >
                              {String(g.channel_number).padStart(2, "0")}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-[19px] font-semibold"
                              style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
                            >
                              {g.channel_title}
                            </span>
                            {full?.content_type && (
                              <span
                                className="flex-none rounded-full px-3 py-1.5 font-mono text-[9px] tracking-[0.08em]"
                                style={{
                                  background: "rgba(var(--ink),.08)",
                                  color: "rgba(var(--ink-cream),.85)",
                                }}
                              >
                                {full.content_type.toUpperCase()}
                              </span>
                            )}
                          </div>

                          <p className="text-[13px]" style={{ color: "rgba(var(--ink-cream),.7)" }}>
                            {matched > 0 ? (
                              <>
                                {titleCased} is mentioned — {matched}{" "}
                                {matched === 1 ? "photograph" : "photographs"}
                              </>
                            ) : g.matchedIn ? (
                              // The reason itself, quoted from the memory's
                              // own words. Not "its description says it".
                              <Evidence text={g.matchedIn} matches={g.matchedRanges} />
                            ) : (
                              <>The memory itself matches — its title or description says it</>
                            )}
                          </p>

                          {thumbs.length > 0 && (
                            <div className="flex items-center gap-2.5">
                              {thumbs.map((p) => (
                                <span
                                  key={p.media_id}
                                  className="flex h-[92px] w-[124px] items-center justify-center overflow-hidden rounded-[14px]"
                                  style={{ background: "var(--panel-deep)", border: "1px solid rgba(var(--ink),.08)" }}
                                >
                                  {p.media_url ? (
                                    <img src={p.media_url} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <ImageIcon size={16} style={{ color: "rgba(var(--ink-cream),.3)" }} aria-hidden />
                                  )}
                                </span>
                              ))}
                              {overflow > 0 && (
                                <span
                                  className="flex h-[92px] w-[64px] flex-none items-center justify-center rounded-[14px] text-[14px]"
                                  style={{
                                    background: "rgba(var(--ink),.05)",
                                    border: "1px solid rgba(var(--ink),.08)",
                                    color: "rgba(var(--ink-cream),.7)",
                                  }}
                                >
                                  +{overflow}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                            <span className="text-[12px]" style={{ color: "var(--fg-hint)" }}>
                              {full?.content_type ?? "memory"}
                              {total !== null ? <> · {total} photographs</> : null}
                              {/*
                                Only when a photograph actually matched (M156).
                                This count has always meant "matched
                                *photographs*", but on a card that is on screen
                                *because* it matched — quoting the very words
                                above this line — "0 match" reads as "this
                                matched nothing", and the card contradicts its
                                own existence. A memory found by its title or
                                description says so above; it has no photograph
                                tally to report, so it reports none.

                                "0 photographs" stays: that one is a fact about
                                the memory, not about the search.
                              */}
                              {matched > 0 ? <> · {matched} match</> : null}
                            </span>
                            <span className="flex items-center gap-2.5">
                              <button
                                type="button"
                                {...placeholderProps("ask.playOnScreen")}
                                disabled
                                className="rounded-full px-4 py-[10px] text-[12px] font-medium leading-none disabled:opacity-40"
                                style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
                              >
                                Play on {subject}'s screen
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/edit-channel/${g.channel_id}`)}
                                className="rounded-full px-4 py-[10px] text-[12px] leading-none"
                                style={{
                                  border: "1px solid rgba(var(--ink),.16)",
                                  color: "rgba(var(--ink-cream),.85)",
                                }}
                              >
                                Open memory
                              </button>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── The foot: her screen, kept in view while asking (8a/8c) ─────── */}
      {stage !== "answer" && (
        <div data-ask-surface className="mt-auto flex-none">
          <NowPlayingBar />
        </div>
      )}
    </div>
  );
}

/* The browser speech API, typed to the sliver of it this page touches. */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
