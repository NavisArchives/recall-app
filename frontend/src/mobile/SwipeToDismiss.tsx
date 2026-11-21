import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";

/** How far the card must rest at to hold the delete action open. */
const ACTION_WIDTH = 88;
/** Past this fraction of the card's width, letting go means "gone". */
const COMMIT_FRACTION = 0.55;
/** Below this, the finger was a tap, not a drag — the card's own tap survives. */
const DRAG_SLOP = 8;

/**
 * The iPhone swipe, on a mission card.
 *
 * Two gestures, and the difference between them is how much the person has
 * already said. A **partial** swipe reveals the red action and waits: the tap
 * on it is the confirmation, the same "ask first" the desktop card got in
 * M96. A **full** swipe carries the card off the screen, and that complete,
 * deliberate movement is itself the answer — which is the convention the
 * owner asked for by name.
 *
 * The motion here is the finger's, not a decoration: the card is wherever the
 * pointer has dragged it. The only timed movement is the snap that follows a
 * release, which is the gesture finishing rather than an effect playing.
 */
export function SwipeToDismiss({
  onDismiss,
  label = "Delete",
  children,
}: {
  onDismiss: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [gone, setGone] = useState(false);
  const start = useRef<{ x: number; y: number; from: number } | null>(null);
  const moved = useRef(false);
  /*
    Dismissing happens once, whatever the route to it.

    One tap on the action sent two DELETEs for the same mission. Two gestures
    can reach the same act — the tap and the full swipe — and the card is
    still on screen while it leaves, so nothing stopped a second call. The
    second is harmless today (the row is already gone) but it is a request
    the person did not make, and "harmless" is not a property to rely on.
  */
  const spent = useRef(false);
  const frame = useRef<HTMLDivElement>(null);

  function width() {
    return frame.current?.getBoundingClientRect().width ?? 320;
  }

  function down(e: React.PointerEvent) {
    // A second finger, or the right button, is not a swipe.
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, from: offset };
    moved.current = false;
    setDragging(true);
  }

  function move(e: React.PointerEvent) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    // Let a vertical scroll win: the board scrolls, and a swipe that starts
    // as a scroll should stay one.
    if (!moved.current && Math.abs(dy) > Math.abs(dx)) {
      start.current = null;
      setDragging(false);
      return;
    }
    if (Math.abs(dx) > DRAG_SLOP) {
      moved.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    // Leftward only, and a little resistance past the action so the card
    // does not feel like it has come loose.
    const next = Math.min(0, start.current.from + dx);
    setOffset(next);
  }

  function dismissOnce() {
    if (spent.current) return;
    spent.current = true;
    setGone(true);
    setOffset(-width() - 40);
    onDismiss();
  }

  function up() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);

    if (Math.abs(offset) > width() * COMMIT_FRACTION) {
      // Carried off the screen: the gesture was the confirmation.
      dismissOnce();
      return;
    }
    // Otherwise it either holds the action open, or it goes back — and going
    // back must cost nothing at all.
    setOffset(Math.abs(offset) > ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0);
  }

  return (
    <div ref={frame} className="relative overflow-hidden rounded-[16px]">
      {/* Held open behind the card. Tapping it is the confirm. */}
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        <button
          type="button"
          aria-label={label}
          tabIndex={offset < -DRAG_SLOP ? 0 : -1}
          onClick={dismissOnce}
          disabled={gone}
          className="flex flex-col items-center justify-center gap-1 px-6 text-[13px] font-medium text-white"
          style={{ width: ACTION_WIDTH, background: "var(--destructive)" }}
        >
          <Trash2 className="h-[18px] w-[18px]" aria-hidden />
          {label}
        </button>
      </div>

      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // A drag must not also count as a tap on the card underneath.
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{
          /*
            Opaque, or the action shows through.

            The mission card is a bordered box with no fill — the page shows
            through it by design — so the red panel sitting behind it was
            visible on every card at rest, before anyone had swiped anything.
            Every mechanism check still passed: nothing was dismissed, the
            mutation fired only where it should. It simply looked alarming.
            The sliding layer carries the page's own colour so the action is
            hidden until the card moves off it.
          */
          background: "var(--bg-deep)",
          transform: `translateX(${offset}px)`,
          transition: dragging ? undefined : "transform 180ms ease-out",
          opacity: gone ? 0 : 1,
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
