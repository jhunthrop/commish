import { describe, it, expect } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { CHAT_PAGE, chatMessage, fixtureChatDeps } from "@/chat-room/test-fixtures";
import type { ActivityFeedRow } from "@/integrity-service/activity";
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

function wrap(ui: React.ReactElement, deps = fixtureChatDeps()) {
  return <ChatRoomDepsProvider deps={deps.deps}>{ui}</ChatRoomDepsProvider>;
}

describe("RoomStream", () => {
  it("is one stream: the league's history and its messages in time order, with faces, then the say-something field", async () => {
    const { container } = render(wrap(<RoomStream leagueId="l1" activityRows={[CLOCK_PICK, PICK]} sendIsTheAct={false} />));
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
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} sendIsTheAct />));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-accent"));
  });

  it("says once that nothing has happened, and still hands you the field", async () => {
    const deps = fixtureChatDeps({ ...CHAT_PAGE, messages: [] });
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} sendIsTheAct />, deps));
    await waitFor(() => expect(screen.getByText("Nothing has happened here yet. Say the first thing.")).toBeInTheDocument());
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
  });

  it("carries reactions on every message and lands a new message from the live wire", async () => {
    const deps = fixtureChatDeps();
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} sendIsTheAct={false} />, deps));
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
    render(wrap(<RoomStream leagueId="l1" activityRows={[]} sendIsTheAct={false} />, deps));
    await waitFor(() => expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Yesterday" })).toBeInTheDocument();
  });
});
