import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { CHAT_CONFIG } from "@/chat/config";
import { CHAT_PAGE, chatMessage, fixtureChatDeps } from "../test-fixtures";
import { ChatRoomDepsProvider, type ChatRoomDeps } from "./deps";
import { useLeagueChat } from "./use-league-chat";

function wrapper(deps: ChatRoomDeps) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <ChatRoomDepsProvider deps={deps}>{children}</ChatRoomDepsProvider>;
  };
}

describe("useLeagueChat", () => {
  it("loads the first page and reports who the caller is", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages.map((m) => m.body)).toEqual(["wheels up", "let's go"]);
    expect(result.current.meUserId).toBe("u1");
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/chat"]);
  });

  it("folds a chat.message frame in without refetching", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => fixture.emit("chat.message", { message: chatMessage("3", { body: "big board" }) }));
    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages[2]?.body).toBe("big board");
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/chat"]);
  });

  it("folds a chat.reaction frame onto the right message, idempotently", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const frame = { messageId: "1", emoji: "🔥", userId: "u2", action: "added" };
    act(() => fixture.emit("chat.reaction", frame));
    act(() => fixture.emit("chat.reaction", frame));
    await waitFor(() => expect(result.current.messages[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]));
  });

  it("ignores a frame it doesn't own", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => fixture.emit("chat.message", { message: { id: 3 } }));
    expect(result.current.messages).toHaveLength(2);
  });

  it("sends a message and folds the server's own copy back", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: { message: chatMessage("3", { authorUserId: "u1", body: "sent" }) } };
    await act(async () => {
      await result.current.send("sent");
    });
    expect(result.current.messages[2]?.body).toBe("sent");
    expect(fixture.calls).toEqual(["GET /api/leagues/l1/chat", "POST /api/leagues/l1/chat"]);
  });

  it("surfaces the server's reason when a send is rejected", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: false, error: "Type a message first." };
    let outcome: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      outcome = await result.current.send("   ");
    });
    expect(outcome).toEqual({ ok: false, reason: "Type a message first." });
    expect(result.current.messages).toHaveLength(2);
  });

  it("reacts through the message's own route", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fixture.response = { ok: true, data: { messageId: "1", action: "added" } };
    await act(async () => {
      await result.current.react("1", "🔥");
    });
    expect(fixture.calls).toContain("POST /api/leagues/l1/chat/1/reactions");
    expect(result.current.messages[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u1" }]);
  });

  // The response used to carry the whole reaction array and this hook REPLACED the message's
  // reactions with it, which made a transient server-side staleness durable: a peer's reaction
  // already folded in from a chat.reaction frame was erased until the next refresh. The wire
  // now carries the TRANSITION, and the client folds it by the same idempotent rule replay uses.
  it("folds its own reaction in without clobbering a peer's", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => fixture.emit("chat.reaction", { messageId: "1", emoji: "😂", userId: "u2", action: "added" }));
    await waitFor(() => expect(result.current.messages[0]?.reactions).toHaveLength(1));

    fixture.response = { ok: true, data: { messageId: "1", action: "added" } };
    await act(async () => {
      await result.current.react("1", "🔥");
    });
    expect(result.current.messages[0]?.reactions).toEqual([
      { emoji: "😂", userId: "u2" },
      { emoji: "🔥", userId: "u1" },
    ]);

    fixture.response = { ok: true, data: { messageId: "1", action: "removed" } };
    await act(async () => {
      await result.current.react("1", "🔥");
    });
    expect(result.current.messages[0]?.reactions).toEqual([{ emoji: "😂", userId: "u2" }]);
  });

  it("prepends an earlier page and stops offering more when the history runs out", async () => {
    const fixture = fixtureChatDeps({ ...CHAT_PAGE, hasMore: true });
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    fixture.response = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("0", { body: "older" })], hasMore: false } };
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages[0]?.body).toBe("older");
    expect(result.current.hasMore).toBe(false);
    expect(fixture.calls).toContain("GET /api/leagues/l1/chat?before=1");
  });

  it("tracks the connection and resyncs on every open", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat")).toHaveLength(2));
    expect(result.current.connection).toBe("live");

    act(() => fixture.fire("error"));
    await waitFor(() => expect(result.current.connection).toBe("reconnecting"));
  });

  // The mount effect and the SSE `open` handler BOTH fire `void refresh()`, with no ordering
  // between them. Before the generation guard, whichever response landed LAST won the write,
  // so a slow first request could overwrite a fresh second one: after a reconnect the pane
  // silently reverted to an older page. This test forces that order deliberately.
  it("keeps the newest refresh when an older one resolves after it", async () => {
    const fixture = fixtureChatDeps(CHAT_PAGE, { deferred: true });
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the mount refresh

    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.pending()).toBe(2)); // plus the open refresh

    const stale = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("1", { body: "stale page" })] } };
    const fresh = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("9", { body: "fresh page" })] } };

    // Newest resolves FIRST, oldest resolves SECOND — the exact interleaving that loses data.
    await act(async () => {
      await fixture.settle(1, fresh);
      await fixture.settle(0, stale);
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages.map((message) => message.body)).toContain("fresh page");
    expect(result.current.messages.map((message) => message.body)).not.toContain("stale page");
  });

  it("reports a network failure as an error state, not a crash", async () => {
    const fixture = fixtureChatDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("We couldn't load the chat. Check your connection and try again.");
  });

  // --- Carried finding 1 (Task 1 review): mergeMessages's cap-and-trim always keeps the
  // NEWEST maxHeldMessages entries. If loadEarlier() routed a backward page through that same
  // function, filling the held buffer to the cap first and THEN loading an older page would
  // have the trim immediately discard the page pagination just fetched — it would always be
  // the oldest entries post-merge. This test fills the buffer to the cap via live frames, then
  // proves loadEarlier's own (uncapped, order-safe) prepend still lands.
  it("keeps a loaded older page even when the held buffer is already at the live-frame cap", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      for (let i = 3; i <= CHAT_CONFIG.maxHeldMessages + 1; i += 1) {
        fixture.emit("chat.message", { message: chatMessage(String(i)) });
      }
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(CHAT_CONFIG.maxHeldMessages));

    fixture.response = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("0", { body: "older" })], hasMore: false } };
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages[0]?.body).toBe("older");
  });

  // The other half of carried finding 1, which the test above could not see: `refresh()` used
  // to route the newest page through `mergeMessages` too, so ANY reconnect (every SSE `open`
  // fires `void refresh()`) re-applied the newest-500 cap to a buffer that backward pagination
  // had deliberately grown past it — silently discarding pages the user explicitly loaded, and
  // leaving them unreachable because `hasMore` was already false.
  it("keeps paged-in history across a reconnect's refresh", async () => {
    const fixture = fixtureChatDeps({ ...CHAT_PAGE, hasMore: true });
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      for (let i = 3; i <= CHAT_CONFIG.maxHeldMessages + 1; i += 1) {
        fixture.emit("chat.message", { message: chatMessage(String(i)) });
      }
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(CHAT_CONFIG.maxHeldMessages));

    fixture.response = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("0", { body: "older" })], hasMore: false } };
    await act(async () => {
      await result.current.loadEarlier();
    });
    expect(result.current.messages[0]?.body).toBe("older");

    fixture.response = { ok: true, data: { ...CHAT_PAGE, hasMore: false } };
    const before = fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat").length;
    act(() => fixture.fire("open"));
    // Gate on the REFETCH landing, not on `connection`: `onOpen` sets connection: "live"
    // synchronously and only then fires `void refresh()`, so a connection-gated wait opens
    // while the write it is really waiting for is still in flight.
    await waitFor(() =>
      expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat")).toHaveLength(before + 1),
    );
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(CHAT_CONFIG.maxHeldMessages));

    expect(result.current.messages[0]?.body).toBe("older");
    // The refreshed page also brings back id "1", which the live-frame cap had trimmed off the
    // front earlier — a page the client is holding is never partially applied.
    expect(result.current.messages.slice(0, 3).map((message) => message.id)).toEqual(["0", "1", "2"]);
    // Truthful either way: `loadEarlier` reached the start of the history, and a refresh of the
    // NEWEST page cannot discover anything about what is behind the oldest held message.
    expect(result.current.hasMore).toBe(false);
  });

  // --- Carried finding 2 (Task 1 review): a chat.reaction frame for a message this browser
  // doesn't hold is dropped by applyReaction's no-op branch, with no queue or later
  // re-application. That is provably safe here, not silent data loss: every fetch this hook
  // makes (mount, refresh, loadEarlier) returns each message with its CURRENT reaction set
  // already attached — history is never delta-applied. So the instant that message is loaded
  // at all, its reactions are already correct; the dropped frame was redundant, not lost.
  it("drops a reaction frame for a message it doesn't hold yet, but the reaction is already correct once that message is fetched", async () => {
    const fixture = fixtureChatDeps();
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => fixture.emit("chat.reaction", { messageId: "99", emoji: "🔥", userId: "u2", action: "added" }));
    expect(result.current.messages.some((m) => m.id === "99")).toBe(false);

    fixture.response = {
      ok: true,
      data: { ...CHAT_PAGE, messages: [chatMessage("99", { reactions: [{ emoji: "🔥", userId: "u2" }] })], hasMore: false },
    };
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.messages.find((m) => m.id === "99")?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });
});
