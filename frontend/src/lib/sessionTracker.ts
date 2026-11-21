/**
 * Measures how Margaret's screen is used — and nothing else.
 *
 * A device session runs from the moment the display wakes until half an hour
 * of stillness or the tab closing. Inside it, each channel she opens is one
 * visit, with how long it stayed open and how many photographs went past.
 *
 * Tracking is off unless the person at the machine is Margaret (or nobody
 * is signed in at all, which is the normal state of her screen). Someone
 * signed in as an admin is working on the archive rather than living with
 * it, and their browsing is never recorded — here or on the server.
 */

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:4000";
const SESSION_KEY = "recall.device_session";
const IDLE_MS = 30 * 60 * 1000;

let enabled = false;
let sessionId: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let listenersBound = false;

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${backendUrl}/api${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok || res.status === 204) return null;
    return (await res.json()) as T;
  } catch {
    // Measurement must never interrupt the archive: a failed beat is lost,
    // and that is the end of it.
    return null;
  }
}

/**
 * Same request, but survives the page going away. `keepalive` carries the
 * session cookie where sendBeacon cannot, which matters because our API
 * lives on another origin.
 */
function postOnExit(path: string, body?: unknown): void {
  try {
    void fetch(`${backendUrl}/api${path}`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    /* leaving anyway */
  }
}

function bindActivityListeners() {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;

  const touch = () => resetIdleTimer();
  for (const event of ["pointerdown", "keydown", "scroll", "wheel", "touchstart"]) {
    window.addEventListener(event, touch, { passive: true });
  }

  window.addEventListener("beforeunload", () => {
    if (activeVisit) {
      postOnExit(`/sessions/visits/${activeVisit.id}/end`, {
        media_viewed_count: activeVisit.viewed,
      });
    }
    if (sessionId) postOnExit(`/sessions/${sessionId}/end`);
  });
}

function resetIdleTimer() {
  if (!enabled) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void endSession(), IDLE_MS);
}

/** Called by the app once it knows who — if anyone — is signed in. */
export function configureTracking(on: boolean) {
  enabled = on;
  if (!on) {
    if (idleTimer) clearTimeout(idleTimer);
    sessionId = null;
    return;
  }
  bindActivityListeners();
  void ensureSession();
}

export async function ensureSession(): Promise<string | null> {
  if (!enabled) return null;
  if (sessionId) return sessionId;

  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    sessionId = stored;
    resetIdleTimer();
    return sessionId;
  }

  const created = await post<{ id: string }>("/sessions", { device_label: "main-screen" });
  if (!created?.id) return null;

  sessionId = created.id;
  sessionStorage.setItem(SESSION_KEY, sessionId);
  resetIdleTimer();
  return sessionId;
}

export async function endSession(): Promise<void> {
  const id = sessionId ?? sessionStorage.getItem(SESSION_KEY);
  sessionId = null;
  sessionStorage.removeItem(SESSION_KEY);
  if (idleTimer) clearTimeout(idleTimer);
  if (id) await post(`/sessions/${id}/end`);
}

// ------------------------------------------------------------------ visits

export type EntryMethod = "keyboard" | "nfc" | "overview" | "direct";

let activeVisit: { id: string; viewed: number } | null = null;

export async function startVisit(
  channelId: string | null,
  channelNumber: number,
  entryMethod: EntryMethod
): Promise<void> {
  if (!enabled) return;

  const device_session_id = await ensureSession();
  const visit = await post<{ id: string }>("/sessions/visits", {
    device_session_id,
    channel_id: channelId,
    channel_number: channelNumber,
    entry_method: entryMethod,
  });

  if (visit?.id) activeVisit = { id: visit.id, viewed: 1 };
}

/** One more photograph went past. */
export function noteMediaViewed(): void {
  if (activeVisit) activeVisit.viewed += 1;
}

export async function endVisit(): Promise<void> {
  const visit = activeVisit;
  activeVisit = null;
  if (!visit) return;
  await post(`/sessions/visits/${visit.id}/end`, { media_viewed_count: visit.viewed });
}
