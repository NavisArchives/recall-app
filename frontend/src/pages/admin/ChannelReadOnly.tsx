import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import type { ChannelWithMedia } from "@/types";

/**
 * A channel somebody may see but not change.
 *
 * Deliberately not the editor with its controls turned off. A page of greyed
 * inputs is the dimmed shelf all over again — it says "this is broken" when
 * the truth is "this is somebody else's". So the words render as words and
 * the photographs at full strength, and the only thing missing is the ability
 * to alter them.
 *
 * The rule is stated once, plainly, naming who can change it, because "why
 * can I not edit this?" is the question this page exists to answer.
 */
export function ChannelReadOnly({ channel }: { channel: ChannelWithMedia }) {
  const navigate = useNavigate();
  const { hasDevice } = useAuth();
  const number = String(channel.number).padStart(2, "0");
  // Whoever made it is whoever may change it.
  const author = channel.created_by_name ?? channel.author?.name;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-[18px] pt-[22px]">
        <div className="flex items-center gap-3.5">
          <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">CHANNEL</span>
          <span className="text-2xl font-bold italic leading-none">{number}</span>
          <span
            className="rounded-full px-3 py-1 font-mono text-[11px] leading-none"
            style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink),.75)" }}
          >
            {channel.content_type}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px]"
            style={{ border: "1px solid rgba(var(--ink),.2)", color: "var(--fg-muted)" }}
          >
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {author ? `Only ${author} and the admins can change this` : "Only the admins can change this"}
          </span>
          {/*
            Only where it can actually go (M147).

            `/channel/NN` is Margaret's display, behind the device session.
            On the family screen this button opens the channel; on a phone it
            would have been refused at the guard — so it is absent there
            rather than drawn and dead (F26).
          */}
          {hasDevice && (
            <button
              type="button"
              onClick={() => navigate(`/channel/${number}`, { state: { entry: "direct" } })}
              className="pressable rounded-[10px] px-[18px] py-2 text-[13px]"
              style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}
            >
              ▶ VIEW CHANNEL
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 gap-10">
        {/* What the channel is */}
        <div className="flex w-[400px] flex-none flex-col gap-[18px]">
          <div>
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">TITLE</span>
            <p className="mt-2 text-[22px] font-semibold leading-[1.25]">{channel.title}</p>
          </div>

          {channel.date && (
            <div>
              <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">DATE</span>
              <p className="mt-2 text-[15px]">
                {new Date(channel.date).toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          )}

          {channel.description && (
            <div>
              <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
                CHANNEL DESCRIPTION
              </span>
              <p className="mt-2 text-[15px] leading-[1.6] text-fg-muted">{channel.description}</p>
            </div>
          )}

          <p className="mt-auto pb-6 text-[13px] leading-[1.6] text-fg-faint">
            You can read everything here and show it on her screen. Changing it is
            {author ? ` ${author}'s` : " an administrator's"} to do.
          </p>
        </div>

        {/* The photographs, at full strength — the point of the page */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
            {channel.media.length === 1 ? "1 PHOTO" : `${channel.media.length} PHOTOS`}
          </span>

          <div className="scroll-thin ring-room flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 pr-1">
            {channel.media.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3.5 rounded-[14px] py-3 pl-2.5 pr-4"
                style={{ border: "1px solid rgba(var(--ink),.16)" }}
              >
                <span className="w-4 flex-none" />
                {/* A URL can be null when signing failed; show the frame
                    rather than a broken image. */}
                {item.url && item.file_type === "video" ? (
                  <video
                    src={item.url}
                    muted
                    className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                  />
                ) : item.url ? (
                  <img
                    src={item.url}
                    alt=""
                    className="h-[88px] w-[88px] flex-none rounded-lg object-cover"
                  />
                ) : (
                  <span
                    className="h-[88px] w-[88px] flex-none rounded-lg"
                    style={{ background: "rgba(var(--ink),.05)" }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[9px] tracking-[0.14em] text-[color:rgba(var(--ink),0.4)]">
                    DESCRIPTION
                  </span>
                  <p
                    className="mt-1.5 text-sm leading-[1.5]"
                    style={{ color: item.caption ? "var(--fg)" : "var(--fg-faint)" }}
                  >
                    {item.caption || "No description yet."}
                  </p>
                </div>
              </div>
            ))}

            {channel.media.length === 0 && (
              <p className="py-6 text-center text-sm text-fg-faint">
                Nothing in this channel yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
