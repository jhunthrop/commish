import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EVENT_STREAM_CONFIG } from "./config";
import { subscribeLeagueStream } from "./league-stream";

type Listener = (event: MessageEvent) => void;

/** Records construction, listener registration and close — everything the manager promises. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Listener[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((held) => held !== listener));
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data = ""): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, data } as MessageEvent);
  }
}

// The registry is module state keyed by url, so every case gets a url of its own rather than
// depending on the previous case having tidied up.
let urlSequence = 0;
const nextUrl = (): string => `/api/leagues/l${++urlSequence}/events`;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeLeagueStream", () => {
  it("opens ONE EventSource for two subscribers to the same url, and both see every frame", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    const second = subscribeLeagueStream(url);
    expect(FakeEventSource.instances).toHaveLength(1);

    const seen: string[] = [];
    first.addEventListener("chat.message", () => seen.push("first"));
    second.addEventListener("chat.message", () => seen.push("second"));
    FakeEventSource.instances[0]!.emit("chat.message");

    expect(seen).toEqual(["first", "second"]);
    first.close();
    second.close();
  });

  it("gives a different league its own source", () => {
    const a = subscribeLeagueStream(nextUrl());
    const b = subscribeLeagueStream(nextUrl());
    expect(FakeEventSource.instances).toHaveLength(2);
    a.close();
    b.close();
  });

  it("closes only the subscriber's own listeners, never a peer's, and closes the socket at zero", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    const second = subscribeLeagueStream(url);
    const seen: string[] = [];
    first.addEventListener("chat.message", () => seen.push("first"));
    second.addEventListener("chat.message", () => seen.push("second"));
    const source = FakeEventSource.instances[0]!;

    first.close();
    expect(source.closed).toBe(false);
    source.emit("chat.message");
    expect(seen).toEqual(["second"]);

    second.close();
    expect(source.closed).toBe(true);
  });

  it("survives React StrictMode's 1 → 2 → 1 mount without churning a socket", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    const second = subscribeLeagueStream(url);
    first.close();

    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    second.close();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("closing twice releases exactly one reference", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    const second = subscribeLeagueStream(url);
    first.close();
    first.close();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    second.close();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("opens a fresh source once the last subscriber has gone", () => {
    const url = nextUrl();
    subscribeLeagueStream(url).close();
    const again = subscribeLeagueStream(url);
    expect(FakeEventSource.instances).toHaveLength(2);
    again.close();
  });

  it("dispatches a synthetic open to a subscriber that attaches after the source is already open", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    first.addEventListener("open", () => undefined);
    FakeEventSource.instances[0]!.emit("open");

    // The chat band remounting mid-draft: it will never see a native `open`, and its mount-gap
    // resync hangs off exactly that event.
    const late = subscribeLeagueStream(url);
    const opens: string[] = [];
    late.addEventListener("open", () => opens.push("open"));
    expect(opens).toEqual(["open"]);

    first.close();
    late.close();
  });

  it("dispatches a synthetic error to a late subscriber while the shared source is disconnected", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    FakeEventSource.instances[0]!.emit("error");

    const late = subscribeLeagueStream(url);
    const events: string[] = [];
    late.addEventListener("open", () => events.push("open"));
    late.addEventListener("error", () => events.push("error"));
    expect(events).toEqual(["error"]);

    first.close();
    late.close();
  });

  it("stops replaying a synthetic error once the shared source has reconnected", () => {
    const url = nextUrl();
    const first = subscribeLeagueStream(url);
    FakeEventSource.instances[0]!.emit("error");
    FakeEventSource.instances[0]!.emit("open");

    const late = subscribeLeagueStream(url);
    const events: string[] = [];
    late.addEventListener("open", () => events.push("open"));
    late.addEventListener("error", () => events.push("error"));
    expect(events).toEqual(["open"]);

    first.close();
    late.close();
  });

  it("ignores listeners registered after close", () => {
    const url = nextUrl();
    const handle = subscribeLeagueStream(url);
    const source = FakeEventSource.instances[0]!;
    handle.close();
    const seen: string[] = [];
    handle.addEventListener("chat.message", () => seen.push("late"));
    source.emit("chat.message");
    expect(seen).toEqual([]);
  });
});

describe("one socket per tab (Neon cost audit finding 3): the notice stream rides an open league connection", () => {
  const notices = EVENT_STREAM_CONFIG.noticesStreamUrl;

  it("attaches a notice subscriber to the league socket that is already open, so no second socket exists", () => {
    const league = nextUrl();
    const room = subscribeLeagueStream(league);
    const inbox = subscribeLeagueStream(notices);
    expect(FakeEventSource.instances).toHaveLength(1);

    const seen: string[] = [];
    inbox.addEventListener("notice.created", () => seen.push("notice"));
    FakeEventSource.instances[0]!.emit("notice.created");
    expect(seen).toEqual(["notice"]);
    room.close();
    inbox.close();
  });

  it("moves an existing notice subscriber onto a league socket when one opens, and back to its own when the league leaves", () => {
    const inbox = subscribeLeagueStream(notices);
    const seen: string[] = [];
    inbox.addEventListener("notice.created", () => seen.push("notice"));
    const standalone = FakeEventSource.instances[0]!;
    expect(standalone.url).toBe(notices);

    const league = nextUrl();
    const room = subscribeLeagueStream(league);
    expect(standalone.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    const carrier = FakeEventSource.instances[1]!;
    expect(carrier.url).toBe(league);
    carrier.emit("notice.created");
    expect(seen).toEqual(["notice"]);

    room.close();
    expect(carrier.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(3);
    const reopened = FakeEventSource.instances[2]!;
    expect(reopened.url).toBe(notices);
    reopened.emit("notice.created");
    expect(seen).toEqual(["notice", "notice"]);
    inbox.close();
    expect(reopened.closed).toBe(true);
  });

  it("replays an already-open league socket's open to the notice subscriber that joins it", () => {
    const league = nextUrl();
    const room = subscribeLeagueStream(league);
    FakeEventSource.instances[0]!.emit("open");
    const inbox = subscribeLeagueStream(notices);
    const opens: string[] = [];
    inbox.addEventListener("open", () => opens.push("open"));
    expect(opens).toEqual(["open"]);
    room.close();
    inbox.close();
  });
});

describe("hidden tabs hold nothing (finding 3)", () => {
  function setVisibility(state: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("closes every socket once the tab has been hidden past hiddenCloseMs, and reopens them on return with the listeners rebound", () => {
    vi.useFakeTimers();
    const url = nextUrl();
    const room = subscribeLeagueStream(url);
    const seen: string[] = [];
    room.addEventListener("draft.pick", () => seen.push("pick"));
    const first = FakeEventSource.instances[0]!;

    setVisibility("hidden");
    vi.advanceTimersByTime(EVENT_STREAM_CONFIG.hiddenCloseMs - 1);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(first.closed).toBe(true);

    setVisibility("visible");
    expect(FakeEventSource.instances).toHaveLength(2);
    const reopened = FakeEventSource.instances[1]!;
    expect(reopened.url).toBe(url);
    reopened.emit("draft.pick");
    expect(seen).toEqual(["pick"]);
    room.close();
    expect(reopened.closed).toBe(true);
  });

  it("a quick tab switch costs nothing: back before the deadline, the socket never closed", () => {
    vi.useFakeTimers();
    const room = subscribeLeagueStream(nextUrl());
    const socket = FakeEventSource.instances[0]!;
    setVisibility("hidden");
    vi.advanceTimersByTime(1_000);
    setVisibility("visible");
    vi.advanceTimersByTime(EVENT_STREAM_CONFIG.hiddenCloseMs * 2);
    expect(socket.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    room.close();
  });

  it("a subscriber arriving while suspended gets its socket only when the tab returns", () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    vi.advanceTimersByTime(EVENT_STREAM_CONFIG.hiddenCloseMs);
    const room = subscribeLeagueStream(nextUrl());
    expect(FakeEventSource.instances).toHaveLength(0);
    setVisibility("visible");
    expect(FakeEventSource.instances).toHaveLength(1);
    room.close();
  });
});
