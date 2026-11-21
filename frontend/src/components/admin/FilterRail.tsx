import { ChevronDown } from "lucide-react";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import type { Author } from "@/types";

const GROUP = "font-mono text-[9px] tracking-[0.14em]";
const groupStyle = { color: "var(--fg-quiet)" };

/*
 * Nothing in this rail changes size when it changes state.
 *
 * Pressing a face used to nudge its neighbours two pixels to the right. The
 * ring was not the culprit — an outline never reflows — it was the "Anyone"
 * pill gaining a 1px border on each edge as it went inactive, and the type
 * pills changing font weight. Both grow the box, and a control that shoves
 * its neighbours when you use it feels broken however correct it is.
 *
 * So every pill carries its border at all times, transparent when it is not
 * wanted, and the weight stays put. State is carried by colour alone, which
 * is the only property here that costs no space.
 */
const STABLE_BORDER = "1px solid transparent";

/**
 * The shelf's filter rail: type, decade, who added it — and what the three
 * of them currently leave you looking at.
 *
 * The result count and Reset are the part that matters. Three filters can
 * combine into an empty shelf, and without a line saying "showing 0 of 10"
 * an empty grid reads as an archive with nothing in it rather than as a
 * question asked too narrowly.
 *
 * Only values the archive actually has are offered: a decade nobody has a
 * photograph from, or a contributor who has made nothing, would be a control
 * that can only ever return an empty shelf.
 */
export function FilterRail<T extends string>({
  filter,
  onFilter,
  filters,
  addedBy,
  onAddedBy,
  decade,
  onDecade,
  people,
  decades,
  showing,
  totalCount,
  countsUnknown = false,
  peopleUnread = false,
  onReset,
  trailing,
}: {
  filter: T;
  onFilter: (next: T) => void;
  filters: { key: T; label: string }[];
  addedBy: string;
  onAddedBy: (next: string) => void;
  decade: string;
  onDecade: (next: string) => void;
  people: Author[];
  decades: number[];
  showing: number;
  totalCount: number;
  /** The shelf has not been read, so neither figure means anything (M202). */
  countsUnknown?: boolean;
  /**
   * The contributor list has not been read (M208).
   *
   * Without this the whole "added by" group simply vanishes — `people` comes
   * back empty from a failed load and the section renders on
   * `people.length > 0`. A filter that disappears is indistinguishable from
   * a filter that was never offered, and somebody hunting for a memory by
   * who added it is left thinking the archive cannot do that.
   */
  peopleUnread?: boolean;
  onReset: () => void;
  /** Sits with the result count, so it costs the rail no extra row. */
  trailing?: React.ReactNode;
}) {
  const narrowed = filter !== "all" || addedBy !== "anyone" || decade !== "any";

  const activeLabel = [
    filter !== "all" ? filters.find((f) => f.key === filter)?.label : null,
    decade !== "any" ? `${decade}s` : null,
    addedBy !== "anyone" ? people.find((p) => p.id === addedBy)?.name : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-none flex-wrap items-end gap-7">
      <div>
        <div className={`${GROUP} pb-2`} style={groupStyle}>
          TYPE
        </div>
        <div
          className="flex items-center gap-1 rounded-full p-1"
          style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.08)" }}
        >
          {filters.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onFilter(option.key)}
              className="rounded-full px-4 py-1.5 text-[13px] font-medium leading-none"
              style={
                filter === option.key
                  ? { background: "var(--chip-on)", color: "var(--on-chip-on)", border: STABLE_BORDER }
                  : { color: "rgba(var(--ink-cream),.75)", border: STABLE_BORDER }
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {decades.length > 0 && (
        <div>
          <div className={`${GROUP} pb-2`} style={groupStyle}>
            DATE
          </div>
          <div className="relative">
            <select
              value={decade}
              onChange={(e) => onDecade(e.target.value)}
              aria-label="Filter by decade"
              className="appearance-none rounded-full py-[9px] pl-4 pr-9 text-[13px] leading-none"
              style={{
                background: "rgba(var(--ink),.05)",
                border: "1px solid rgba(var(--ink),.12)",
                color: "rgba(var(--ink-cream),.85)",
              }}
            >
              <option value="any">Any decade</option>
              {decades.map((d) => (
                <option key={d} value={String(d)}>
                  {d}s
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              aria-hidden
              className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--fg-soft)" }}
            />
          </div>
        </div>
      )}

      {peopleUnread && (
        <div>
          <div className={`${GROUP} pb-2`} style={groupStyle}>
            ADDED BY
          </div>
          <p className="pb-2 text-[12px]" style={{ color: "var(--fg-quiet)" }}>
            The contributors could not be loaded, so this filter is not available.
          </p>
        </div>
      )}

      {!peopleUnread && people.length > 0 && (
        <div>
          <div className={`${GROUP} pb-2`} style={groupStyle}>
            ADDED BY
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAddedBy("anyone")}
              className="rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
              style={
                addedBy === "anyone"
                  ? { background: "var(--chip-on)", color: "var(--on-chip-on)", border: STABLE_BORDER }
                  : { border: "1px solid rgba(var(--ink),.12)", color: "rgba(var(--ink-cream),.75)" }
              }
            >
              Anyone
            </button>
            {people.map((person) => {
              const on = addedBy === person.id;
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => onAddedBy(on ? "anyone" : person.id)}
                  aria-label={`Only ${person.name}`}
                  aria-pressed={on}
                  className="relative h-9 w-9 flex-none rounded-full"
                >
                  {/* Drawn over the face, inside its own bounds — an outline
                      offset outwards would reach into the next avatar's gap. */}
                  {on && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-full"
                      style={{ boxShadow: "inset 0 0 0 2px var(--accent)" }}
                    />
                  )}
                  {person.profile_picture_url ? (
                    <img
                      src={person.profile_picture_url}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <InitialsAvatar name={person.name} size={36} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/*
        The line names what is being applied, not just the count (F26).

        The advisor pressed a contributor's face and reported that nothing
        happened. The filter was working — it is that the one contributor who
        has authored anything authored *everything*, so ten of ten came back
        and the only feedback was a count that had not moved. A control whose
        effect cannot be seen is indistinguishable from a broken one, so the
        line says which narrowing is on.
      */}
      <div className="ml-auto flex items-center gap-3 pb-2 text-[13px]">
        <span style={{ color: "var(--fg-soft)" }}>
          {/*
            No count when there is nothing to count (M202).

            "Showing all 0 channels" rendered on a failed load, beside a
            sentence saying the shelf could not be read. This line exists to
            prove a filter is working; on an unread shelf it proves nothing
            and asserts a total the page does not have.
          */}
          {countsUnknown ? (
            activeLabel ? (
              <>Filtered · {activeLabel}</>
            ) : null
          ) : narrowed ? (
            <>
              Showing {showing} of {totalCount}
              {activeLabel ? <> · {activeLabel}</> : null}
            </>
          ) : (
            `Showing all ${totalCount} ${totalCount === 1 ? "channel" : "channels"}`
          )}
        </span>
        {narrowed && (
          <button type="button" onClick={onReset} style={{ color: "var(--accent-soft)" }}>
            Reset
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
}
