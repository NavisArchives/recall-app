import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useGlobalKeyboardControls } from "@/hooks/useGlobalKeyboardControls";
import { useDisplay } from "@/lib/DisplayContext";
import { ProfileSwitcher } from "@/components/admin/ProfileSwitcher";
import { useAuth } from "@/context/AuthContext";
import { px } from "@/lib/designSpace";

/**
 * Which two-digit code the current route corresponds to. Read from the path
 * rather than useParams — the header renders outside <Routes>, so route params
 * are not available to it.
 */
function useCurrentChannelCode(): string {
  const { pathname } = useLocation();

  const channelMatch = pathname.match(/^\/channel\/(\d{1,2})/);
  if (channelMatch) return channelMatch[1].padStart(2, "0");

  if (pathname.startsWith("/overview")) return "00";
  if (pathname.startsWith("/social")) return "10";
  if (pathname.startsWith("/admin")) return "99";
  return "98";
}

function useClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export function Header() {
  const { typedDigits } = useGlobalKeyboardControls();
  const { status, subjectName } = useDisplay();
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const onAdmin = pathname.startsWith("/admin");
  // Sub-pages go back to the dashboard; the dashboard goes back to the display.
  const onAdminSubPage = onAdmin && pathname !== "/admin";
  const code = useCurrentChannelCode();
  const now = useClock();

  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  // The management area speaks English and its clock is a whisper, not the
  // room-sized display clock: "21:02 · Wednesday 5 August".
  const adminDate = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      {/*
        The display header, to spec 24: absolute at left/right 56, top 44,
        each block starting at the top rather than centred in the band.

        Its own element rather than a variant of the management row below.
        The two share nothing but a position on the page — this one is read
        from a sofa and is drawn in the mockup's own pixels; that one is a
        toolbar for somebody at a keyboard.
      */}
      {!onAdmin ? (
        <header className="relative h-header flex-shrink-0">
          {/* Left: the channel, the way the physical card reads. */}
          <div className="absolute" style={{ left: px(56), top: px(44) }}>
            <p
              className="font-mono uppercase"
              style={{
                fontSize: px(13),
                letterSpacing: ".3em",
                color: "rgba(242,241,238,.55)",
              }}
            >
              Channel
            </p>
            {/*
              Italic 300, not 900.

              It shipped at weight 900 with negative tracking, which at 76px
              is a headline shouting the number — and the number is not the
              memory, it is the label on the card in her hand. The design's
              is light and open, and now that `1,300` is actually loaded the
              browser draws the real face instead of slanting the upright one.
            */}
            <p
              style={{
                font: `italic 300 ${px(76)}/1 Roboto, sans-serif`,
                color: "#F2F1EE",
                marginTop: px(10),
              }}
            >
              {code}
            </p>
          </div>

          {/* Centre: the clock, centred on the frame — not on what is left
              over between the two side blocks. */}
          <div className="absolute text-center" style={{ left: 0, right: 0, top: px(44) }}>
            <p
              className="font-mono"
              style={{ fontSize: px(54), lineHeight: 1, color: "#F2F1EE" }}
            >
              {time}
            </p>
            <p
              style={{
                font: `400 ${px(16)}/1.2 Roboto, sans-serif`,
                color: "rgba(242,241,238,.55)",
                marginTop: px(10),
              }}
            >
              {date}
            </p>
          </div>

          {/* Right: what this screen can do — never the screen she is on. */}
          <div
            className="absolute font-mono text-right"
            style={{
              right: px(56),
              top: px(44),
              fontSize: px(13),
              lineHeight: 2.1,
              color: "rgba(242,241,238,.55)",
            }}
          >
            {status ? (
              <>
                {status.hint && <p>{status.hint}</p>}
                {/*
                  A counter is for finding your place among several things. On
                  a single photograph, a film or a voice message it says
                  "1 OF 1", which answers a question nobody asked and implies
                  there is somewhere else to go (spec 24).
                */}
                {status.total != null && status.total > 1 && (
                  <p style={{ color: "#E29A68" }}>
                    {status.counterNoun ? `${status.counterNoun} ` : ""}
                    {status.current} OF {status.total}
                  </p>
                )}
              </>
            ) : (
              <>
                {code !== "00" && <p>00 → every channel</p>}
                {code !== "98" && <p>98 → home</p>}
                {code !== "10" && <p>10 → family</p>}
              </>
            )}
          </div>
        </header>
      ) : (
      <header className="grid h-header flex-shrink-0 grid-cols-3 items-center px-[4vw]">
        <div>
          {onAdmin ? (
            <Link
              to={onAdminSubPage ? "/admin" : "/"}
              className="t-hint transition-colors hover:text-fg"
            >
              {/* Whose archive this is, from the archive itself — this said
                  "Margaret's" to every family until M57. */}
              {onAdminSubPage
                ? `← ${subjectName ? `${subjectName}'s Archive` : "The Archive"}`
                : "▶ Open Recall screen"}
            </Link>
          ) : (
            <>
              <p className="t-channel-label">CHANNEL</p>
              <p className="t-channel-number mt-1.5">{code}</p>
            </>
          )}
        </div>

        <div className="text-center">
          {onAdmin ? (
            <p className="hint-mono">
              {time} · {adminDate}
            </p>
          ) : (
            <>
              <p className="t-clock">{time}</p>
              <p className="t-date mt-1.5 capitalize">{date}</p>
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 text-right">
          {onAdmin && profile ? (
            <ProfileSwitcher />
          ) : status ? (
            <>
              {status.hint && <p className="t-hint">{status.hint}</p>}
              {/*
                A counter is for finding your place among several things. On a
                single photograph, a film or a voice message it says "1 OF 1",
                which answers a question nobody asked and implies there is
                somewhere else to go (display spec 24).
              */}
              {status.total != null && status.total > 1 && (
                <p className="t-position">
                  {status.counterNoun ? `${status.counterNoun} ` : ""}
                  {status.current} OF {status.total}
                </p>
              )}
            </>
          ) : (
            /*
              Never list the screen she is already on (display spec 24).

              Standing on home and being told "98 → home" is an instruction to
              go where she is, which is the kind of thing that makes a person
              doubt they have understood. And `11 → guide` names a screen that
              no longer exists at all — 11 became ordinary content when the
              guides menu was removed, so the hint was pointing at whatever a
              family happens to put there.
            */
            <>
              {code !== "00" && <p className="t-hint">00 → every channel</p>}
              {code !== "98" && <p className="t-hint">98 → home</p>}
              {code !== "10" && <p className="t-hint">10 → family</p>}
            </>
          )}
        </div>
      </header>
      )}

      {typedDigits.length > 0 && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/70"
          aria-live="polite"
        >
          <span className="font-sans text-[14rem] font-bold italic leading-none tracking-tight text-white">
            {typedDigits.padEnd(2, "_")}
          </span>
          <span className="hint-mono mt-6">
            {typedDigits.length < 2
              ? "Type a second digit…"
              : `Opening channel ${typedDigits}…`}
          </span>
        </div>
      )}
    </>
  );
}
