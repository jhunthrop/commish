/**
 * Pure browser. No imports from `@/lib` — every one of the four rooms' `BROWSER_DEPS.fetchJson`
 * pulls this in as a one-line delegate, so it has to be safe to import from browser code with no
 * server-only module behind it (Task 16 Step 5).
 *
 * A `401` reaches a room's `fetchJson` today and becomes whatever generic "we could not reach the
 * server" line that call site already renders (A6) — every existing error path keeps working
 * exactly as it does today, because this hands the response back UNCHANGED. What it adds is a
 * single, shared side channel: when the failure is a `401` carrying our own `{ ok: false }`
 * envelope (never a raw network failure, never some other service's 401), it emits
 * `SESSION_LOST_EVENT` once, through one module-level `EventTarget` — the one place a dead
 * session becomes a signal instead of a hundred call sites each guessing at one.
 */

export const SESSION_LOST_EVENT = "commish:session-lost";

export interface SessionLostDetail {
  /** `true` when the request that lost its session was a write (anything but a GET) — the
   *  discriminator `SessionNotice` (`./session-notice.tsx`) uses to decide between a quiet strip
   *  and a `Modal`: a background read failing is worth a courtesy; a write failing is worth
   *  telling the person their click did not do what they thought it did. */
  readonly write: boolean;
}

const emitter = new EventTarget();

/** Our own envelope shape (`{ ok: false, error }`, `src/lib/api/respond.ts`'s `fail()`) — checked
 *  by CLONING the response, so the caller's own `await response.json()` still reads the real,
 *  untouched body afterward. A body that fails to parse as JSON, or parses to anything else, is
 *  treated as "not our envelope" rather than thrown — this function's only job is to notice, never
 *  to interrupt. */
async function isOurFailureEnvelope(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.clone().json();
    return typeof body === "object" && body !== null && (body as { readonly ok?: unknown }).ok === false;
  } catch {
    return false;
  }
}

/**
 * Wraps `fetch` once. Every room's `BROWSER_DEPS.fetchJson` becomes a one-line delegate to this
 * — same signature, same return value, so the swap costs each room exactly one line and no
 * caller anywhere in the four rooms has to change how it calls `fetchJson`.
 */
export async function fetchWithSessionWatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401 && (await isOurFailureEnvelope(response))) {
    const method = (init?.method ?? "GET").toUpperCase();
    emitter.dispatchEvent(new CustomEvent<SessionLostDetail>(SESSION_LOST_EVENT, { detail: { write: method !== "GET" } }));
  }
  return response;
}

/** Subscribes to a lost session. Returns the unsubscribe function, the same shape every other
 *  cleanup-returning subscription in this codebase uses (an effect's own return value). */
export function onSessionLost(listener: (detail: SessionLostDetail) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<SessionLostDetail>).detail);
  emitter.addEventListener(SESSION_LOST_EVENT, handler);
  return () => emitter.removeEventListener(SESSION_LOST_EVENT, handler);
}
