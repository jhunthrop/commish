import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
