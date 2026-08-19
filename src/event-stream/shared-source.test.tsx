import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { DraftPlayersBody, DraftSnapshotBody } from "@/draft-room/contract";
import type { ChatPageBody } from "@/chat/contract";
import { PLAYERS, SNAKE_VIEW, TEAMS, LEAGUE_NAME } from "@/draft-room/test-fixtures";
import { CHAT_PAGE } from "@/chat-room/test-fixtures";
import { useDraftRoom } from "@/draft-room/hooks/use-draft-room";
import { useLeagueChat } from "@/chat-room/hooks/use-league-chat";

type Listener = (event: MessageEvent) => void;

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
}

const SNAPSHOT: DraftSnapshotBody = {
  draft: SNAKE_VIEW,
  leagueName: LEAGUE_NAME,
  teamId: "t1",
  isCommissioner: false,
  teams: TEAMS,
  queue: [],
};

const PLAYERS_BODY: DraftPlayersBody = { players: PLAYERS };
const CHAT: ChatPageBody = CHAT_PAGE;

function bodyFor(url: string): unknown {
  if (url.endsWith("/players")) return { ok: true, data: PLAYERS_BODY };
  if (url.includes("/chat")) return { ok: true, data: CHAT };
  return { ok: true, data: SNAPSHOT };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", async (url: string) => ({ json: async () => bodyFor(url) }) as unknown as Response);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The whole point of `@/event-stream`, exercised through the seam it actually ships behind: no
 * deps provider, so both hooks resolve their DEFAULT `openEventSource` — the browser factories
 * in each room's `deps.tsx`. A draft room mounts both of these together (the chat band lives
 * inside it), and before this module that cost two SSE connections per tab out of
 * `REALTIME_CONFIG.maxStreamsPerUser`.
 */
describe("the draft room and the chat band on one league stream", () => {
  it("shares a single EventSource between useDraftRoom and useLeagueChat", async () => {
    const draft = renderHook(() => useDraftRoom("d1"));
    await waitFor(() => expect(draft.result.current.status).toBe("ready"));
    // The draft hook only subscribes once its snapshot has told it which league it is in.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const chat = renderHook(() => useLeagueChat(SNAKE_VIEW.leagueId));
    await waitFor(() => expect(chat.result.current.status).toBe("ready"));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe(`/api/leagues/${SNAKE_VIEW.leagueId}/events`);

    // Unmounting one consumer must not take the other's stream down with it.
    chat.unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    draft.unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
});
