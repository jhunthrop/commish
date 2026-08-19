"use client";

/**
 * ONE `EventSource` per league stream url, shared by every browser consumer of that url.
 *
 * A league's SSE stream carries draft, chat and scoring frames together, and a draft room now
 * mounts two consumers of it (`useDraftRoom` and the chat band's `useLeagueChat`). Each opening
 * its own connection cost two of `REALTIME_CONFIG.maxStreamsPerUser` per tab — and each one
 * pins a dedicated Redis socket and an fd on the server for frames the other is already
 * receiving.
 *
 * Ref-counted rather than reference-free: the first subscriber constructs the connection, later
 * ones join it, and only the last one to leave closes it. That is also what makes React
 * StrictMode's double mount (1 → 2 → 1) and the collapsible chat band's toggle free — neither
 * ever reaches zero while the other consumer is still holding the stream.
 *
 * **No `Last-Event-ID` handling here, deliberately.** One shared connection means one
 * browser-owned resume cursor instead of two independent ones, which is strictly better than
 * what it replaces. Sharing that single cursor across two folds is safe because both folds are
 * already idempotent under replay: `mergeMessages`/`applyReaction` are set-shaped and
 * `applyDraftEvent` answers a gap with `outcome: "resync"` rather than a silent hole. Adding a
 * manager-owned cursor would be a second, competing implementation of something the browser
 * already does correctly.
 *
 * Browser-only by construction: `new EventSource(...)` is constructed lazily inside
 * `subscribeLeagueStream`, so importing this module is safe anywhere (happy-dom included), and
 * nothing server-side may import it.
 */

/** The slice one subscriber sees. Structurally the `EventSourceLike` both rooms' deps declare. */
export interface LeagueStreamSubscription {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  /** Releases this subscriber. The underlying connection closes only when the last one goes. */
  close(): void;
}

interface SharedSource {
  readonly source: EventSource;
  readonly refs: number;
  /** The connection is open right now — so a late subscriber missed the native `open`. */
  readonly opened: boolean;
  /** The connection is disconnected right now (the browser is retrying on its own). */
  readonly errored: boolean;
}

const shared = new Map<string, SharedSource>();

function patch(url: string, change: Partial<SharedSource>): void {
  const held = shared.get(url);
  if (held !== undefined) shared.set(url, { ...held, ...change });
}

function acquire(url: string): SharedSource {
  const held = shared.get(url);
  if (held !== undefined) {
    const joined = { ...held, refs: held.refs + 1 };
    shared.set(url, joined);
    return joined;
  }
  const source = new EventSource(url);
  shared.set(url, { source, refs: 1, opened: false, errored: false });
  // The manager's own listeners, so it knows what a subscriber joining later has missed. They
  // are never removed: they die with the connection when the last subscriber leaves.
  source.addEventListener("open", () => patch(url, { opened: true, errored: false }));
  source.addEventListener("error", () => patch(url, { opened: false, errored: true }));
  return shared.get(url)!;
}

/**
 * Subscribes to a league stream, opening the connection if nobody else holds it.
 *
 * Listeners are registered on the shared connection but recorded per subscriber, so `close()`
 * removes exactly this subscriber's listeners and never a peer's.
 */
export function subscribeLeagueStream(url: string): LeagueStreamSubscription {
  const { source } = acquire(url);
  const mine: { readonly type: string; readonly listener: EventListener }[] = [];
  let closed = false;

  return {
    addEventListener: (type, listener) => {
      if (closed) return;
      const bound = listener as unknown as EventListener;
      mine.push({ type, listener: bound });
      source.addEventListener(type, bound);

      // `open` and `error` are STATE TRANSITIONS the connection has already made: a subscriber
      // that attaches while the stream is already open would otherwise never see one, and both
      // hooks hang their mount-gap resync off `open`. Synchronous so the subscriber's state is
      // correct before it renders.
      const state = shared.get(url);
      if (state === undefined) return;
      if ((type === "open" && state.opened) || (type === "error" && state.errored)) {
        listener(new MessageEvent(type));
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      for (const { type, listener } of mine) source.removeEventListener(type, listener);
      const held = shared.get(url);
      if (held === undefined) return;
      if (held.refs > 1) {
        shared.set(url, { ...held, refs: held.refs - 1 });
        return;
      }
      shared.delete(url);
      held.source.close();
    },
  };
}
