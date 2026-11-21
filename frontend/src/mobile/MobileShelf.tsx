import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useChannels, usePeople, useScreenState } from "@/hooks/useAdminData";
import { useMobileUI } from "./MobileShell";
import { Sheet, SheetCancel } from "./Sheet";
import { ShelfCardFull, NewChannelCard } from "./ShelfCardFull";
import type { Channel } from "@/types";

/*
 * The Memory Shelf on a phone (wireframes-mobile.md, Part 2; frame 16b).
 *
 * A 2-across grid, scrolling vertically, "New channel" first. Tapping a card
 * does not navigate — it asks. The sheet's first row is the 90% case: add
 * memories, straight to the photos, skipping the edit page entirely. There is
 * no "view" row anywhere; the phone is not a viewer — her screen is.
 */

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";

export function MobileShelf() {
  const navigate = useNavigate();
  const { isAdmin, profile } = useAuth();
  const { openAdd } = useMobileUI();
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  /*
    The failure state has to reach the sheet (M214).

    `(people ?? [])` alone could not tell "the read failed" from "the read
    succeeded and this person is not in it" — so the two cases below were
    indistinguishable, and the false one hid behind the benign one.
  */
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const peopleUnread = peoplePending || peopleFailed;
  /*
    The fork of M208's desktop guard, missed on the phone (found by the
    M213 sweep's own call-site census — fourth fork miss of the cycle).

    It is precise about which case it protects. On a COLD failure `screen`
    is undefined and `screen?.current_channel_number === n` is already
    false, so no tile claims LIVE either way. The guard earns its place on
    a FAILED REFETCH: React Query keeps the previous data, so
    `current_channel_number` is the *old* channel and the shelf would put a
    LIVE badge on a memory that is no longer on her screen — the same warm
    case listState.test.ts documents as the one that hides a bug, because
    the page looks perfectly fine.
  */
  const { data: screen, isPending: screenPending, isError: screenFailed } = useScreenState();
  const screenUnread = screenPending || screenFailed;
  const [sheet, setSheet] = useState<Channel | null>(null);

  const liveNumber = screenUnread ? null : (screen?.current_channel_number ?? null);
  const rows = channels ?? [];

  /*
    Three states, because there are three (M214, correcting M208).

    M208 stopped this naming the wrong person, and that was sufficient
    against misidentification and silent about the case that actually
    fails. `creatorOf` returned null for two situations that are not
    equivalent, and the sheet said the same thing for both:

      A. `created_by` IS NULL — nobody was ever recorded. "Somebody else
         created this" asserts a creator who does not exist, and "only they
         can add to it" points at nobody. `channels.ts:233` writes
         `req.profile?.personId ?? null`, so the app produces this itself
         whenever a channel is created with no acting profile.

      B. the contributor read failed — `canEdit` has already proved
         `created_by !== profile.id`, so somebody else genuinely did create
         it. True, merely unnamed.

    A is the false one and it had no fixture, which is exactly how it
    survived: correct by construction in every scratch family, and
    therefore never once on a screen. M214 adds the fixture first.
  */
  const creatorOf = useMemo(() => {
    const byId = new Map((people ?? []).map((p) => [p.id, p.name]));
    return (
      channel: Channel
    ): { kind: "none" } | { kind: "unknown" } | { kind: "named"; name: string } => {
      if (!channel.created_by) return { kind: "none" };
      const name = byId.get(channel.created_by);
      if (name) return { kind: "named", name };
      return { kind: "unknown" };
    };
  }, [people]);

  const canEdit = (channel: Channel) =>
    isAdmin || channel.created_by === profile?.id;

  return (
    // The shell frames this page (M75); it carries content only.
    <div>
      {/*
        The count waits until the shelf has been read (M202's class).

        "MEMORY SHELF — 0 CHANNELS" rendered on a failed load, with nothing
        else on the screen to contradict it. On the page that *is* the
        archive, to a family who came to look at what they have gathered,
        that reads as: it is all gone. `rows` is `channels ?? []`, so the
        number was counting the absence of an answer.

        This file is why the M182 backstop could not catch it — `ShelfPage`
        sits in its ALLOWED map, exempted for a different and genuinely safe
        sentence about the typed filter, and a file-level exemption covers
        everything else in the file.
      */}
      <p className={`${LABEL} mb-3.5`}>
        MEMORY SHELF
        {channelsPending || channelsFailed ? "" : ` — ${rows.length} CHANNEL${rows.length === 1 ? "" : "S"}`}
      </p>

      {channelsFailed && (
        <p className="mb-3.5 text-[13px] text-fg-faint">
          The shelf could not be loaded, so we cannot say what is on it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/*
          New channel first, in the same footprint as a real card so the grid
          stays even (M65).
        */}
        <NewChannelCard
          onPress={() => openAdd({ kind: "new" })}
          className="aspect-[3/4] w-full"
        />

        {rows.map((channel) => (
          /*
            The same card the overview uses, laid out for this container: the
            strip sizes it 150×200, the grid gives it half a row and keeps the
            shape with `aspect-[3/4]` (M65).

            Pressing still asks rather than navigates — the Shelf tab's rule
            (M49): the sheet's first row is the 90% case, straight to adding
            memories. Only the card's look changed here.
          */
          <ShelfCardFull
            key={channel.id}
            channel={channel}
            live={channel.number === liveNumber}
            locked={!canEdit(channel)}
            onPress={() => setSheet(channel)}
            className="aspect-[3/4] w-full"
          />
        ))}
      </div>

      {sheet && (
        <Sheet open onClose={() => setSheet(null)}>
          <div className="mb-[18px] flex items-baseline gap-2.5">
            <span className="min-w-0 flex-1 truncate text-[17px] font-medium">
              {sheet.title}
            </span>
            <span className="font-mono text-[10px] tracking-[0.12em] text-fg-faint">
              CHANNEL {String(sheet.number).padStart(2, "0")}
            </span>
          </div>

          {canEdit(sheet) ? (
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const channel = sheet;
                  setSheet(null);
                  openAdd(channel);
                }}
                className="flex h-[54px] items-center gap-3.5 rounded-[16px] bg-accent px-[18px] text-[15px] font-medium text-accent-foreground"
              >
                <Plus className="h-[18px] w-[18px]" /> Add memories
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = sheet.id;
                  setSheet(null);
                  navigate(`/admin/edit-channel/${id}`);
                }}
                className="flex h-[54px] items-center gap-3.5 rounded-[16px] border px-[18px] text-[15px]"
                style={{ borderColor: "rgba(var(--ink),.22)" }}
              >
                <Pencil className="h-4 w-4" /> Edit details
              </button>
            </div>
          ) : (
            // Cards they cannot touch still show; the sheet simply says why
            // there is nothing to press.
            <p className="py-2 text-[13px] leading-[1.55] text-fg-muted">
              {(() => {
                const who = creatorOf(sheet);
                if (who.kind === "named") {
                  return `Created by ${who.name} — only they can add to it.`;
                }
                if (who.kind === "none") {
                  /*
                    Stops being false AND names the actual door (M201's
                    shape). Saying only "nobody is recorded" would leave the
                    reader hunting for a creator who never existed; the
                    person who can actually help is an administrator, so the
                    sentence says so.
                  */
                  return "No one is recorded as having made this, so only an administrator can add to it.";
                }
                return peopleUnread
                  ? "We could not check who made this, so we cannot say who can add to it."
                  : "Somebody else made this, so only they can add to it.";
              })()}
            </p>
          )}

          <div className="mt-1.5">
            <SheetCancel onClose={() => setSheet(null)} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
