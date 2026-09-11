import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import type { ActivityFeedRow } from "@/integrity-service/activity";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps } from "../test-fixtures";

/**
 * ONE FRAME, ONE ROW (H1). A `stream.reaction` frame replaces the whole reactions map, and before
 * this fix every row in the stream re-rendered with it — on a Sunday with a dozen managers
 * reacting, a five-hundred-item stream re-rendering per frame, taking the composer's caret and
 * every hover state with it.
 *
 * MEASURED AT `ReactionBar`, which every row renders and no row can re-render without: the mock
 * below records the `targetId` of every bar React actually invokes, so the count after a frame IS
 * the number of rows that committed. A spy in a test double rather than an instrumented component:
 * nothing about the product changes to be measured.
 */
const spy = vi.hoisted(() => ({ targets: [] as string[] }));

vi.mock("@/chat-room/components/reaction-bar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat-room/components/reaction-bar")>();
  return {
    ...actual,
    ReactionBar: (props: Parameters<typeof actual.ReactionBar>[0]) => {
      spy.targets.push(props.targetId);
      return actual.ReactionBar(props);
    },
  };
});

const { RoomStream } = await import("./room-stream");

function pick(n: number): ActivityFeedRow {
  return {
    eventId: `evt_${n}`,
    occurredAt: `2026-08-18T11:0${n}:00.000Z`,
    icon: "users",
    headline: `Jordan Lee drafted Player ${n}.`,
    detail: null,
    kind: "pick",
    actor: { userId: "u2", name: "Jordan Lee", avatar: null },
  };
}

const PICKS = [pick(1), pick(2), pick(3), pick(4)];

describe("RoomStream commits one row per reaction frame (H1)", () => {
  it("re-renders only the row the frame is about, and leaves every other row and message alone", async () => {
    const league = fixtureLeagueDeps();
    render(
      <LeagueRoomDepsProvider deps={league.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <RoomStream leagueId="l1" activityRows={PICKS} eventReactions={new Map()} sendIsTheAct={false} />
        </ChatRoomDepsProvider>
      </LeagueRoomDepsProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(4));
    // The chat fixture carries two messages, so the stream holds six reaction rows in all.
    await waitFor(() => expect(screen.getAllByTestId("message-bubble")).toHaveLength(2));

    spy.targets.length = 0;
    act(() => league.emit("stream.reaction", { eventId: "evt_2", emoji: "🔥", userId: "u2", action: "added" }));
    await waitFor(() => expect(spy.targets.length).toBeGreaterThan(0));

    expect(spy.targets).toEqual(["evt_2"]);
  });

  it("commits one row again when a second frame lands on a different event", async () => {
    const league = fixtureLeagueDeps();
    render(
      <LeagueRoomDepsProvider deps={league.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <RoomStream leagueId="l1" activityRows={PICKS} eventReactions={new Map()} sendIsTheAct={false} />
        </ChatRoomDepsProvider>
      </LeagueRoomDepsProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("stream-event")).toHaveLength(4));

    act(() => league.emit("stream.reaction", { eventId: "evt_2", emoji: "🔥", userId: "u2", action: "added" }));
    await waitFor(() => expect(spy.targets.at(-1)).toBe("evt_2"));

    spy.targets.length = 0;
    act(() => league.emit("stream.reaction", { eventId: "evt_4", emoji: "👏", userId: "u3", action: "added" }));
    await waitFor(() => expect(spy.targets.length).toBeGreaterThan(0));

    // Not `evt_2` again: its own array kept its identity through the second fold.
    expect(spy.targets).toEqual(["evt_4"]);
  });
});
