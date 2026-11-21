import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveChannelPath } from "@/lib/channelRouting";

const INPUT_RESET_DELAY_MS = 2500;
const NAVIGATE_DELAY_MS = 400;

/** True while the key press belongs to a form field, not the remote. */
function isTypingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(el.tagName) || el.isContentEditable);
}

export interface RemoteHandlers {
  /** ← and → — previous / next. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Enter — the remote's OK button. */
  onSelect?: () => void;
}

/**
 * The remote's arrow and OK keys, for whichever display screen is open.
 *
 * The product ships as a screen plus a remote: number keys, arrows, OK. The
 * digits are handled globally above; arrows and OK mean something different on
 * every screen (next photo, next step, open this channel), so each screen
 * subscribes here with its own meaning. ↑/↓ mirror ←/→ — on a remote held in
 * the dark, any arrow should do the obvious thing, never nothing.
 *
 * This lives in the same file as the digit handling on purpose: one place owns
 * the keyboard, and a scanner keystroke can never meet two competing listeners.
 */
export function useRemoteKeys({ onPrev, onNext, onSelect }: RemoteHandlers) {
  const handlers = useRef({ onPrev, onNext, onSelect });
  handlers.current = { onPrev, onNext, onSelect };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingInField(event.target)) return;

      const { onPrev, onNext, onSelect } = handlers.current;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        if (onPrev) {
          event.preventDefault();
          onPrev();
        }
      } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        if (onNext) {
          event.preventDefault();
          onNext();
        }
      } else if (event.key === "Enter") {
        if (onSelect) {
          event.preventDefault();
          onSelect();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

/**
 * Two-digit channel entry. The NFC reader is a keyboard-emulating (HID) device,
 * so a scanned tag arrives here as ordinary keystrokes — the same path as the
 * remote's number keys.
 */
export function useGlobalKeyboardControls() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [typedDigits, setTypedDigits] = useState("");
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Channel shortcuts belong to the display. In the management area a stray
  // digit would navigate away mid-form, so they are inert there.
  const enabled = !pathname.startsWith("/admin");

  useEffect(() => {
    if (!enabled) {
      setTypedDigits("");
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingInField(event.target)) return;

      if (!/^[0-9]$/.test(event.key)) return;

      setTypedDigits((prev) => (prev.length >= 2 ? event.key : prev + event.key));

      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = setTimeout(() => setTypedDigits(""), INPUT_RESET_DELAY_MS);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    };
  }, [enabled]);

  useEffect(() => {
    if (typedDigits.length !== 2) return;

    const timeout = setTimeout(() => {
      const path = resolveChannelPath(typedDigits);
      // The card reader types these digits exactly as a hand does, so both
      // arrive here and are recorded the same way.
      if (path) navigate(path, { state: { entry: "keyboard" } });
      setTypedDigits("");
    }, NAVIGATE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [typedDigits, navigate]);

  return { typedDigits };
}
