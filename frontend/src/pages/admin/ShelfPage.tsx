import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import { useChannels, useNfcCards, usePeople, useScreenState } from "@/hooks/useAdminData";
import { MobileShelf } from "@/mobile/MobileShelf";
import { useIsMobile } from "@/mobile/useIsMobile";
import { ChannelTile } from "@/components/admin/ChannelTile";
import { PageFrame, PageHeader, PrimaryPill, SearchField } from "@/components/admin/kit";
import { FilterRail } from "@/components/admin/FilterRail";

/*
  The product's four real content types, and All.

  The old set was All / Albums / Videos / No NFC — two types out of four,
  plus a card-state filter wearing the same clothes as a type. The frame
  draws the types, so the types are what these are.
*/
type Filter = "all" | "album" | "video" | "instruction" | "documentary";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "album", label: "Album" },
  { key: "video", label: "Video" },
  { key: "instruction", label: "Instruction" },
  { key: "documentary", label: "Documentary" },
];

/** Every memory in the archive, and the one place a new one is started. */
export function ShelfPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShelf /> : <ShelfDesktop />;
}

function ShelfDesktop() {

  const { isAdmin } = useAuth();
  const { subjectName } = useDisplay();
  const subject = subjectName?.trim() || null;
  const { data: channels, isPending: isLoading, isError: channelsFailed } = useChannels();
  /*
    Three reads that asserted things about the family's archive without ever
    consulting their own failure (M208).

    `cards` is the sharp one. `carded` is built from `cards ?? []`, so a
    failed NFC read made `linked` false for every tile, and every tile said
    **"no card yet"** in amber with `aria-label="No card linked"`. Unlike a
    wrong number, that sends somebody to a drawer to find cards that already
    work — and the page showed no error anywhere.

    `screen` decides which tile is LIVE. Unread, no tile is live, so the
    shelf quietly claims nothing is on her display at all.

    `people` feeds the "added by" filter, which simply offers fewer faces
    when it fails — the mildest of the three, and still a silent narrowing
    of a control somebody is using to look for something.
  */
  const {
    data: cards,
    isPending: cardsPending,
    isError: cardsFailed,
  } = useNfcCards();
  const {
    data: screen,
    isPending: screenPending,
    isError: screenFailed,
  } = useScreenState();
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();

  const cardsUnread = cardsPending || cardsFailed;
  const screenUnread = screenPending || screenFailed;
  const peopleUnread = peoplePending || peopleFailed;

  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [addedBy, setAddedBy] = useState<string>("anyone");
  const [decade, setDecade] = useState<string>("any");

  const carded = useMemo(
    () => new Set((cards ?? []).map((c) => c.channel_id).filter(Boolean) as string[]),
    [cards]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (channels ?? []).filter((channel) => {
      if (filter !== "all" && channel.content_type !== filter) return false;
      if (addedBy !== "anyone" && channel.author_id !== addedBy && channel.created_by !== addedBy)
        return false;
      if (decade !== "any") {
        const year = channel.date ? new Date(channel.date).getFullYear() : null;
        if (year === null || Math.floor(year / 10) * 10 !== Number(decade)) return false;
      }
      if (!term) return true;
      return (
        channel.title.toLowerCase().includes(term) ||
        String(channel.number).padStart(2, "0").includes(term)
      );
    });
  }, [channels, search, filter, carded, addedBy, decade]);

  const all = channels ?? [];
  const photographs = all.reduce((n, c) => n + (c.photo_count ?? c.media_count ?? 0), 0);

  /* Only people who actually made something appear in "added by" — a filter
     that can only ever return nothing is a dead control. */
  const contributors = (people ?? []).filter(
    (p) => p.role !== "user" && all.some((c) => c.author_id === p.id || c.created_by === p.id)
  );

  const decades = [
    ...new Set(
      all
        .map((c) => (c.date ? Math.floor(new Date(c.date).getFullYear() / 10) * 10 : null))
        .filter((d): d is number => d !== null)
    ),
  ].sort((a, b) => b - a);

  return (
    <PageFrame
      header={
        <>
          <PageHeader
            title="Memory Shelf"
            /*
              The header's three figures wait for the shelf too (M202).

              Fixing the body and leaving these was the same half-fix as
              Insights: the sentence underneath said the shelf could not be
              read while the line above it stated "0 channels · 0
              photographs · 0 card-linked" as fact. The figure is the part a
              person reads.
            */
            subtitle={
              <>
                {subject ? `${subject}'s archive` : "This archive"}
                {!isLoading && !channelsFailed && (
                  <>
                    {" · "}
                    {all.length} {all.length === 1 ? "channel" : "channels"} · {photographs}{" "}
                    {photographs === 1 ? "photograph" : "photographs"}
                    {/*
                      The card figure is a THIRD read and fails on its own
                      (M208). Gating it with the channel figures would hide
                      two numbers we have because of one we do not; printing
                      it regardless says "0 card-linked" about a fleet nobody
                      asked after.
                    */}
                    {!cardsUnread && <> · {carded.size} card-linked</>}
                  </>
                )}
              </>
            }
            actions={
              <>
                <SearchField placeholder="Find a channel…" value={search} onChange={setSearch} />
                <PrimaryPill onClick={() => navigate("/admin/create-channel")}>
                  + New channel
                </PrimaryPill>
              </>
            }
          />

          <FilterRail
            filter={filter}
            onFilter={setFilter}
            addedBy={addedBy}
            onAddedBy={setAddedBy}
            decade={decade}
            onDecade={setDecade}
            filters={FILTERS}
            people={contributors}
            decades={decades}
            showing={rows.length}
            totalCount={all.length}
            countsUnknown={isLoading || channelsFailed || cardsUnread}
            peopleUnread={peopleUnread}
            onReset={() => {
              setFilter("all");
              setAddedBy("anyone");
              setDecade("any");
              setSearch("");
            }}
            /* Beside the count, not beneath it: on its own line it pushed the
               grid down by a whole row for one quiet link. */
            trailing={
              isAdmin ? (
                <Link
                  to="/admin/channels/deleted"
                  className="font-mono text-[11px]"
                  style={{ color: "var(--fg-quiet)" }}
                >
                  Recently deleted →
                </Link>
              ) : undefined
            }
          />
        </>
      }
    >
      {isLoading && <p style={{ color: "var(--fg-soft)" }}>Loading…</p>}

      {/*
        The failure said out loud, because "No channel matches that." was
        reachable from it.

        The M182 backstop exempted this file with the reason "`rows` is a
        useMemo over channels that already arrived. A failed load never
        reaches it." That reason was **wrong**. `isLoading` is false on a
        failed load, so the block below rendered, `rows` was empty, and the
        family was told their filter matched nothing — on a shelf that had
        not been read at all. An allowlist entry is a claim like any other,
        and this one had never been checked.

        `listState` is not used here because the two states want different
        words: "no match" is about the typed filter and stays; this is about
        the archive. Both now require the load to have succeeded.
      */}
      {channelsFailed && !isLoading && (
        <p style={{ color: "var(--fg-soft)" }}>
          The shelf could not be loaded, so we cannot say what is on it.
        </p>
      )}

      {!isLoading && !channelsFailed && (
        /*
          Rows are sized by the tiles, not by what is left over.

          `gridAutoRows: minmax(210px, 1fr)` shared the free height between
          however many rows there were, so narrowing the shelf from three rows
          to two made every card grow — press a filter and the whole grid
          changes shape under you. The tile carries its own proportion now
          (see ChannelTile), so a card is the same card whatever else is on
          screen.

          `auto-rows-max` is what makes that safe inside a fixed-height scroll
          region. Left on `auto`, the rows split the container's height between
          them the moment a third row exists (three rows of ~154px under
          190px-tall tiles), and every tile painted over the row below it.
          Max-content rows take their height from the tile, so overflow goes
          where it belongs: into this region's own scrollbar.
        */
        <div
          className="scroll-thin ring-room grid min-h-0 flex-1 auto-rows-max grid-cols-3 content-start gap-4 overflow-y-auto pb-2 pr-1"
        >
          {rows.map((channel) => (
            <ChannelTile
              key={channel.id}
              channel={channel}
              to={`/admin/edit-channel/${channel.id}`}
              // Unread means unknown, not "not live" (M208).
              live={!screenUnread && screen?.current_channel_number === channel.number}
              linked={carded.has(channel.id)}
              cardsUnread={cardsUnread}
            />
          ))}

          {rows.length === 0 && (
            <p className="col-span-3 py-10 text-center" style={{ color: "var(--fg-soft)" }}>
              No channel matches that.
            </p>
          )}
        </div>
      )}
    </PageFrame>
  );

}
