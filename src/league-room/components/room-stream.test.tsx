import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { CHAT_CONFIG } from "@/chat/config";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { CHAT_PAGE, chatMessage, fixtureChatDeps } from "@/chat-room/test-fixtures";
import type { ActivityFeedRow } from "@/integrity-service/activity";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps } from "../test-fixtures";
import { RoomStream } from "./room-stream";

const PICK: ActivityFeedRow = {
  eventId: "evt_1",
  occurredAt: "2026-08-18T11:00:00.000Z",
  icon: "users",
  headline: "Jordan Lee drafted Josh Allen.",
  detail: null,
  kind: "pick",
  actor: { userId: "u2", name: "Jordan Lee", avatar: null },
};

const CLOCK_PICK: ActivityFeedRow = {
  eventId: "evt_2",
  occurredAt: "2026-08-18T11:30:00.000Z",
  icon: "refresh-cw",
  headline: "The clock ran out, so Comet Crew drafted Derrick Henry from their queue.",
  detail: null,
  kind: "pick",
  actor: null,
};

const CLAIM: ActivityFeedRow = {
  eventId: "evt_3",
  occurredAt: "2026-08-18T11:40:00.000Z",
  icon: "users",
  headline: "Dana Kwon claimed Tank Dell.",
  detail: null,
  kind: "claim",
  actor: { userId: "u3", name: "Dana Kwon", avatar: null },
};

const TRADE: ActivityFeedRow = {
  eventId: "evt_4",
  occurredAt: "2026-08-18T11:45:00.000Z",
  icon: "users",
  headline: "Jordan Lee traded Kyren Williams to Dana Kwon.",
  detail: null,
  kind: "trade",
  actor: { userId: "u2", name: "Jordan Lee", avatar: null },
};

/** A kind nobody reacts to: somebody arriving is not a move with an opinion attached. */
const JOINED: ActivityFeedRow = {
  eventId: "evt_5",
  occurredAt: "2026-08-18T11:50:00.000Z",
  icon: "users",
  headline: "Dana Kwon joined the league.",
  detail: null,
  kind: "join",
  actor: { userId: "u3", name: "Dana Kwon", avatar: null },
};

/** The stream now reads BOTH dependency contexts: chat's for the messages, the league room's for
 *  the reactions on picks, claims and trades. Both are injected, so no test opens a socket. */
function wrap(ui: React.ReactElement, deps = fixtureChatDeps(), league = fixtureLeagueDeps()) {
  return (
    <LeagueRoomDepsProvider deps={league.deps}>
      <ChatRoomDepsProvider deps={deps.deps}>{ui}</ChatRoomDepsProvider>
    </LeagueRoomDepsProvider>
  );
}

describe("RoomStream", () => {
  it("is one stream: the league's history and its messages in time order, with faces, then the say-something field", async () => {
    const { container } = render(wrap(<RoomStream leagueId="l1" activityRows={[CLOCK_PICK, PICK]} eventReactions={new Map()} sendIsTheAct={false} />));
    await waitFor(() => expect(screen.getByRole("log", { name: "What happened" })).toBeInTheDocument());
    const events = screen.getAllByTestId("stream-event");
    expect(events[0]).toHaveTextContent("Jordan Lee drafted Josh Allen.");
    expect(events[0]!.querySelector("[aria-hidden='true']")).toHaveTextContent("JL");
    expect(events[1]).toHaveTextContent("The clock ran out");
    const bubbles = screen.getAllByTestId("message-bubble");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toHaveAttribute("data-mine", "true");
    // Events at 11:00 and 11:30 come before the messages at 12:00.
    const log = screen.getByRole("log", { name: "What happened" });
    const order = Array.from(log.querySelectorAll("[data-testid='stream-event'], [data-testid='message-bubble']")).map((node) => node.getAttribute("data-testid"));
    expect(order).toEqual(["stream-event", "stream-event", "message-bubble", "message-bubble"]);
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" }).className).not.toContain("bg-accent");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("makes Send the page's one solid act when nothing else needs the manager", async () => {
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} eventReactions={new Map()} sendIsTheAct />));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-accent"));
  });

  it("says once that nothing has happened, and still hands you the field", async () => {
    const deps = fixtureChatDeps({ ...CHAT_PAGE, messages: [] });
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} eventReactions={new Map()} sendIsTheAct />, deps));
    await waitFor(() => expect(screen.getByText("Nothing has happened here yet. Say the first thing.")).toBeInTheDocument());
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
  });

  it("carries reactions on every message and lands a new message from the live wire", async () => {
    const deps = fixtureChatDeps();
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} eventReactions={new Map()} sendIsTheAct={false} />, deps));
    await waitFor(() => expect(screen.getAllByTestId("message-bubble")).toHaveLength(2));
    expect(screen.getAllByRole("button", { name: /React with/ }).length).toBeGreaterThanOrEqual(2);
    act(() => deps.emit("chat.message", { message: chatMessage("3", { body: "leave Cook alone", createdAt: "2026-08-18T12:05:00.000Z" }) }));
    await waitFor(() => expect(screen.getByText("leave Cook alone")).toBeInTheDocument());
  });

  it("bands the stream by day, in the reader's own words", async () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const deps = fixtureChatDeps({
      ...CHAT_PAGE,
      messages: [chatMessage("1", { createdAt: yesterday.toISOString() }), chatMessage("2", { createdAt: today.toISOString() })],
    });
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} eventReactions={new Map()} sendIsTheAct={false} />, deps));
    await waitFor(() => expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Yesterday" })).toBeInTheDocument();
  });
});

describe("RoomStream carries reactions on what people did (Sideline P5)", () => {
  it("offers the same five on a pick, a claim and a trade, and on nothing the platform did", async () => {
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK, CLAIM, TRADE, CLOCK_PICK, JOINED]} eventReactions={new Map()} sendIsTheAct={false} />));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(5));
    const pillsOn = (kind: string): number =>
      screen.getAllByTestId("stream-event").filter((node) => node.getAttribute("data-kind") === kind)[0]!.querySelectorAll("[aria-label^='React with']").length;
    expect(pillsOn("pick")).toBe(CHAT_CONFIG.reactions.length);
    expect(pillsOn("claim")).toBe(CHAT_CONFIG.reactions.length);
    expect(pillsOn("trade")).toBe(CHAT_CONFIG.reactions.length);
    expect(pillsOn("join")).toBe(0);
  });

  it("draws the reactions the server already read, and marks the viewer's own", async () => {
    const held = new Map([["evt_1", [{ emoji: "🔥", userId: "u1" }, { emoji: "🔥", userId: "u2" }]]]);
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK]} eventReactions={held} sendIsTheAct={false} />));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(1));
    const pill = within(screen.getByTestId("stream-event")).getByRole("button", { name: "React with 🔥" });
    expect(pill).toHaveTextContent("2");
    expect(pill).toHaveAttribute("aria-pressed", "true");
  });

  it("lands a leaguemate's reaction from the live wire", async () => {
    const league = fixtureLeagueDeps();
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK]} eventReactions={new Map()} sendIsTheAct={false} />, fixtureChatDeps(), league));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(1));
    act(() => league.emit("stream.reaction", { eventId: "evt_1", emoji: "👏", userId: "u2", action: "added" }));
    const pill = () => within(screen.getByTestId("stream-event")).getByRole("button", { name: "React with 👏" });
    await waitFor(() => expect(pill()).toHaveTextContent("1"));
    expect(pill()).toHaveAttribute("aria-pressed", "false");
  });

  it("answers the tap before the wire does, and posts the toggle", async () => {
    const league = fixtureLeagueDeps({ ok: true, data: { eventId: "evt_1", action: "added" } });
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK]} eventReactions={new Map()} sendIsTheAct={false} />, fixtureChatDeps(), league));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(1));
    const pill = within(screen.getByTestId("stream-event")).getByRole("button", { name: "React with 🔥" });
    await userEvent.click(pill);
    await waitFor(() => expect(pill).toHaveTextContent("1"));
    expect(pill).toHaveAttribute("aria-pressed", "true");
    expect(league.calls).toContain("POST /api/leagues/l1/activity/evt_1/reactions");
  });

  it("puts the pill back when the write refuses", async () => {
    const league = fixtureLeagueDeps({ ok: false, error: "That is no longer here." });
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK]} eventReactions={new Map()} sendIsTheAct={false} />, fixtureChatDeps(), league));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(1));
    const pill = within(screen.getByTestId("stream-event")).getByRole("button", { name: "React with 🔥" });
    await userEvent.click(pill);
    await waitFor(() => expect(pill).toHaveAttribute("aria-pressed", "false"));
    expect(pill).not.toHaveTextContent("1");
  });

  it("keeps a leaguemate's reaction that landed while the viewer's own write was out", async () => {
    const league = fixtureLeagueDeps({ ok: false, error: "no" }, { deferred: true });
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK]} eventReactions={new Map()} sendIsTheAct={false} />, fixtureChatDeps(), league));
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(1));
    const pill = within(screen.getByTestId("stream-event")).getByRole("button", { name: "React with 🔥" });
    await userEvent.click(pill);
    await waitFor(() => expect(pill).toHaveTextContent("1"));
    act(() => league.emit("stream.reaction", { eventId: "evt_1", emoji: "🔥", userId: "u2", action: "added" }));
    await waitFor(() => expect(pill).toHaveTextContent("2"));
    await act(async () => {
      await league.settle(0, { ok: false, error: "no" });
    });
    // The viewer's own optimistic draw is put back; the leaguemate's survives it.
    await waitFor(() => expect(pill).toHaveTextContent("1"));
    expect(pill).toHaveAttribute("aria-pressed", "false");
  });
});

describe("RoomStream keeps the landing view (H3)", () => {
  it("never scrolls on first paint, so the rival card above it stays in view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(wrap(<RoomStream leagueId="l1" activityRows={[PICK, CLOCK_PICK]} eventReactions={new Map()} sendIsTheAct={false} />));
    await waitFor(() => expect(screen.getAllByTestId("message-bubble")).toHaveLength(2));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("follows a new item to the foot only when the reader was already at the foot", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    let report: ((entries: readonly { isIntersecting: boolean }[]) => void) | null = null;
    class FakeObserver {
      constructor(callback: (entries: readonly { isIntersecting: boolean }[]) => void) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    }
    const previous = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      const deps = fixtureChatDeps();
      render(wrap(<RoomStream leagueId="l1" activityRows={[]} eventReactions={new Map()} sendIsTheAct={false} />, deps));
      await waitFor(() => expect(screen.getAllByTestId("message-bubble")).toHaveLength(2));

      // Scrolled up to read: a landing message does not yank the view.
      act(() => report?.([{ isIntersecting: false }]));
      act(() => deps.emit("chat.message", { message: chatMessage("3", { body: "one", createdAt: "2026-08-18T12:05:00.000Z" }) }));
      await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());
      expect(scrollIntoView).not.toHaveBeenCalled();

      // At the foot: the next message pulls the view to itself.
      act(() => report?.([{ isIntersecting: true }]));
      act(() => deps.emit("chat.message", { message: chatMessage("4", { body: "two", createdAt: "2026-08-18T12:06:00.000Z" }) }));
      await waitFor(() => expect(screen.getByText("two")).toBeInTheDocument());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.IntersectionObserver = previous;
    }
  });
});
