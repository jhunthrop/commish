"use client";

/**
 * ONE `EventSource` per tab, shared by every browser consumer of every stream url.
 *
 * A league's SSE stream carries draft, chat and scoring frames together, and a draft room
 * mounts two consumers of it (`useDraftRoom` and the chat band's `useLeagueChat`). Each opening
 * its own connection cost two of `REALTIME_CONFIG.maxStreamsPerUser` per tab — and each one
 * pins a dedicated Redis socket and an fd on the server for frames the other is already
 * receiving. The header's notice inbox (`NoticesProvider`) then added a second URL per tab.
 *
 * Ref-counted rather than reference-free: the first subscriber to a url constructs the
 * connection, later ones join it, and only the last one to leave closes it. That is also what
 * makes React StrictMode's double mount (1 → 2 → 1) and the collapsible chat band's toggle free
 * — neither ever reaches zero while the other consumer is still holding the stream.
 *
 * TWO MORE RULES since the Neon cost audit (2026-09-07, finding 3), both invisible to consumers:
 *
 *   1. ONE SOCKET PER TAB. The server reads the caller's own user stream on every league
 *      connection, so while a league url (`EVENT_STREAM_CONFIG.isCarrierUrl`) is subscribed the
 *      notice subscribers are bound to THAT connection and their own url holds no socket. When
 *      the league connection closes (its last subscriber leaves) the notice url reopens on its
 *      own; when a league connection appears, the standalone notice socket closes. Every
 *      subscriber's listeners move with it, so a consumer never knows which socket serves it.
 *
 *   2. HIDDEN TABS HOLD NOTHING. After `EVENT_STREAM_CONFIG.hiddenCloseMs` hidden, every socket
 *      closes; on return they reopen and each consumer sees a native `open`, which is exactly
 *      the mount-gap resync every hook already hangs off it. The server resumes from the
 *      browser's own `Last-Event-ID` inside its catch-up window, so nothing is lost.
 *
 * **No `Last-Event-ID` handling here, deliberately.** One shared connection means one
 * browser-owned resume cursor instead of two independent ones, which is strictly better than
 * what it replaces. Sharing that single cursor across folds is safe because every fold is
 * already idempotent under replay: `mergeMessages`/`applyReaction` are set-shaped and
 * `applyDraftEvent` answers a gap with `outcome: "resync"` rather than a silent hole. Adding a
 * manager-owned cursor would be a second, competing implementation of something the browser
 * already does correctly.
 *
 * Browser-only by construction: `new EventSource(...)` is constructed lazily inside
 * `subscribeLeagueStream`, so importing this module is safe anywhere (happy-dom included), and
 * nothing server-side may import it.
 */

import { EVENT_STREAM_CONFIG } from "./config";

/** The slice one subscriber sees. Structurally the `EventSourceLike` both rooms' deps declare. */
export interface LeagueStreamSubscription {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  /** Releases this subscriber. The underlying connection closes only when the last one goes. */
  close(): void;
}

type Listener = EventListener;

interface Subscriber {
  readonly url: string;
  readonly listeners: { readonly type: string; readonly listener: Listener }[];
  /** The socket this subscriber's listeners are attached to right now, if any. */
  boundTo: Socket | null;
  closed: boolean;
}

interface Socket {
  readonly url: string;
  readonly source: EventSource;
  /** The connection is open right now — so a late subscriber missed the native `open`. */
  opened: boolean;
  /** The connection is disconnected right now (the browser is retrying on its own). */
  errored: boolean;
}

/** Subscribers by the url they asked for. */
const subscribers = new Map<string, Set<Subscriber>>();
/** Open sockets by the url they were opened on. */
const sockets = new Map<string, Socket>();
/** True while the tab has been hidden past `hiddenCloseMs`: no socket may exist. */
let suspended = false;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
let watchingVisibility = false;

/** Which url's socket should serve a subscriber to `url`: the notice url rides a league socket. */
function socketUrlFor(url: string): string {
  if (url !== EVENT_STREAM_CONFIG.noticesStreamUrl) return url;
  for (const [candidate, held] of subscribers) {
    if (held.size > 0 && EVENT_STREAM_CONFIG.isCarrierUrl(candidate)) return candidate;
  }
  return url;
}

function openSocket(url: string): Socket {
  const socket: Socket = { url, source: new EventSource(url), opened: false, errored: false };
  // The manager's own listeners, so it knows what a subscriber joining later has missed. They
  // are never removed: they die with the connection when it closes.
  socket.source.addEventListener("open", () => {
    socket.opened = true;
    socket.errored = false;
  });
  socket.source.addEventListener("error", () => {
    socket.opened = false;
    socket.errored = true;
  });
  return socket;
}

function bind(subscriber: Subscriber, socket: Socket | null): void {
  if (subscriber.boundTo === socket) return;
  if (subscriber.boundTo !== null) {
    for (const { type, listener } of subscriber.listeners) subscriber.boundTo.source.removeEventListener(type, listener);
  }
  subscriber.boundTo = socket;
  if (socket === null) return;
  for (const { type, listener } of subscriber.listeners) attach(socket, type, listener);
}

/** Attaches one listener and replays the state transition it has already missed. `open` and
 *  `error` are STATE TRANSITIONS the connection has already made: a subscriber that attaches
 *  while the stream is already open would otherwise never see one, and every hook hangs its
 *  mount-gap resync off `open`. Synchronous so the subscriber's state is correct before it renders. */
function attach(socket: Socket, type: string, listener: Listener): void {
  socket.source.addEventListener(type, listener);
  if ((type === "open" && socket.opened) || (type === "error" && socket.errored)) listener(new MessageEvent(type));
}

/**
 * THE ONE RECONCILIATION: after any subscribe, close or visibility change, make the set of open
 * sockets equal the set of socket urls the live subscribers need (none while suspended), and
 * bind every subscriber to the socket that serves it.
 */
function reconcile(): void {
  const wanted = new Map<string, string>();
  for (const [url, held] of subscribers) {
    if (held.size > 0) wanted.set(url, socketUrlFor(url));
  }
  const socketUrls = new Set(wanted.values());

  for (const [url, socket] of sockets) {
    if (suspended || !socketUrls.has(url)) {
      for (const held of subscribers.values()) for (const subscriber of held) if (subscriber.boundTo === socket) bind(subscriber, null);
      socket.source.close();
      sockets.delete(url);
    }
  }
  if (!suspended) {
    for (const url of socketUrls) if (!sockets.has(url)) sockets.set(url, openSocket(url));
  }
  for (const [url, held] of subscribers) {
    const socket = suspended ? null : (sockets.get(wanted.get(url) ?? url) ?? null);
    for (const subscriber of held) bind(subscriber, socket);
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => {
      suspended = true;
      reconcile();
    }, EVENT_STREAM_CONFIG.hiddenCloseMs);
    return;
  }
  clearTimeout(hiddenTimer);
  if (!suspended) return;
  suspended = false;
  reconcile();
}

/** Registered on the first subscription, never before: importing this module must stay inert. */
function watchVisibility(): void {
  if (watchingVisibility || typeof document === "undefined") return;
  watchingVisibility = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

/**
 * Subscribes to a stream url, opening the connection if nobody else holds it (or attaching to
 * the league connection that already carries it — see the module docblock).
 *
 * Listeners are registered on the shared connection but recorded per subscriber, so `close()`
 * removes exactly this subscriber's listeners and never a peer's.
 */
export function subscribeLeagueStream(url: string): LeagueStreamSubscription {
  watchVisibility();
  const subscriber: Subscriber = { url, listeners: [], boundTo: null, closed: false };
  const held = subscribers.get(url) ?? new Set<Subscriber>();
  held.add(subscriber);
  subscribers.set(url, held);
  reconcile();

  return {
    addEventListener: (type, listener) => {
      if (subscriber.closed) return;
      const bound = listener as unknown as Listener;
      subscriber.listeners.push({ type, listener: bound });
      if (subscriber.boundTo !== null) attach(subscriber.boundTo, type, bound);
    },
    close: () => {
      if (subscriber.closed) return;
      subscriber.closed = true;
      bind(subscriber, null);
      const peers = subscribers.get(url);
      peers?.delete(subscriber);
      if (peers !== undefined && peers.size === 0) subscribers.delete(url);
      reconcile();
    },
  };
}
