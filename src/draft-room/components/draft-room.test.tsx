import { describe, it, expect } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { renderSurface } from "@/components/ui/test-utils";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { fixtureDeps, MOCK_ROOM, renderInRoom, SNAKE_VIEW } from "../test-fixtures";
import { DraftRoomDepsProvider } from "../hooks/deps";
import { DraftRoom } from "./draft-room";

/** Already dismissed, so `RoomTour` stays out of the way of every case that isn't testing it. */
const TOUR_DISMISSED = "2026-01-01T00:00:00.000Z";

function mount(fixture = fixtureDeps(), dismissedAt: string | null = TOUR_DISMISSED) {
  const rendered = renderInRoom(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <ToastProvider>
        <DraftRoom draftId="d1" dismissedAt={dismissedAt} />
      </ToastProvider>
    </ChatRoomDepsProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("DraftRoom", () => {
  it("shows a loading state, then the live snake room — both themes, axe-clean", async () => {
    const fixture = fixtureDeps();
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <ToastProvider>
            <DraftRoom draftId="d1" dismissedAt={TOUR_DISMISSED} />
          </ToastProvider>
        </ChatRoomDepsProvider>
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Loading…")).toBeInTheDocument();
        // "Bay Bandits" appears in the rail AND on the board's column head — presence, not uniqueness.
        await waitFor(() => expect(screen.getAllByText("Bay Bandits").length).toBeGreaterThan(0));
        expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
        expect(screen.getByTestId("room-layout")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("gives the room a chat band", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("room-aside")).toBeInTheDocument());
  });

  it("collapses the chat band to a reopen strip and brings it back", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("region", { name: "League chat" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Hide chat" }));
    expect(screen.queryByRole("region", { name: "League chat" })).not.toBeInTheDocument();
    // The band itself stays — a slim strip holding the way back in.
    expect(screen.getByTestId("room-aside")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));
    expect(await screen.findByRole("region", { name: "League chat" })).toBeInTheDocument();
  });

  it("offers a retry when the draft cannot be loaded", async () => {
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft does not exist." }) }) as unknown as Response };
    renderInRoom(
      <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
        <ToastProvider>
          <DraftRoom draftId="d1" dismissedAt={TOUR_DISMISSED} />
        </ToastProvider>
      </ChatRoomDepsProvider>,
      fixture.deps,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft does not exist."));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("submits a pick and shows the reducer's reason in a toast when it is rejected", async () => {
    const fixture = fixtureDeps();
    fixture.postResponse = { ok: false, error: "It's not your turn to pick." };
    mount(fixture);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("It's not your turn to pick.");
    // rolled back: the player is available again
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("queues a player and shows the reducer's reason in a toast when the queue change is rejected", async () => {
    const fixture = fixtureDeps();
    fixture.queueResponse = { ok: false, error: "A queue can hold at most 50 players." };
    mount(fixture);
    await waitFor(() => expect(screen.getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("A queue can hold at most 50 players.");
    // Rolled back: the pool still offers to queue the player, not to remove them.
    expect(screen.getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument();
  });

  it("tells the user when the connection drops", async () => {
    const { fixture } = mount();
    await waitFor(() => expect(fixture.sources).toHaveLength(1));
    act(() => fixture.sources[0]!.emit("error"));
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
  });

  it("shows the room tour once, before it has ever been dismissed", async () => {
    mount(fixtureDeps(), null);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument());
  });

  it("PATCHes the dismissal and closes the tour without blocking the room", async () => {
    const { fixture } = mount(fixtureDeps(), null);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.calls).toContain("PATCH /api/preferences");
    // The rest of the room is unaffected — the tour never sat between a manager and the board.
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  });

  it("never shows the tour once it has already been dismissed", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/**
 * Task 8: the room's own honest chrome for a mock draft. `mock: null` (the default `fixtureDeps`
 * already sets) is a REAL draft, and every case above already proves that shape unaffected —
 * these cases exercise the three new `mock`-populated shapes instead.
 */
describe("DraftRoom — Task 8's mock room dressing", () => {
  it("mounts no practice banner and no share panel for a real draft", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument());
    expect(screen.queryByTestId("practice-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-link-panel")).not.toBeInTheDocument();
  });

  it("shows the practice banner for the whole life of a mock room", async () => {
    const fixture = fixtureDeps();
    fixture.mock = MOCK_ROOM;
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("practice-banner")).toHaveTextContent(MOCK_ROOM.practiceBanner));
    // The rest of the room is unaffected — the banner is additive chrome, not a replacement.
    expect(screen.getByRole("list", { name: /available players/i })).toBeInTheDocument();
  });

  it("mounts ShareLinkPanel beside the waiting room for an unstarted link-mode mock", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      share: { shareCode: "ABC123", path: "/app/mock-drafts/ABC123", teamCount: 8, seatsFilled: 3, startsAt: "2026-09-01T00:10:00.000Z" },
    };
    mount(fixture);
    await waitFor(() => expect(screen.getByTestId("share-link-panel")).toBeInTheDocument());
    expect(screen.getByLabelText("Share link")).toHaveValue("/app/mock-drafts/ABC123");
  });

  it("lets the board yield entirely to MockResults once a mock draft finishes", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "complete", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      results: {
        heading: "Your practice draft is complete.",
        retentionSentence: "Your results stay here for 24 hours, then this room clears itself.",
        runAgainLabel: "Run another practice draft",
        openLobbyLabel: "Open the practice lobby",
        browseLeaguesLabel: "Browse real leagues",
      },
    };
    mount(fixture);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your practice draft is complete." })).toBeInTheDocument());
    // The board and dock are gone — the results panel is what the room shows now.
    expect(screen.queryByRole("list", { name: /available players/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse real leagues" })).toBeInTheDocument();
  });

  it("is axe-clean with every one of its own additions mounted at once, in both themes", async () => {
    const fixture = fixtureDeps({ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null });
    fixture.mock = {
      ...MOCK_ROOM,
      share: { shareCode: "ABC123", path: "/app/mock-drafts/ABC123", teamCount: 8, seatsFilled: 3, startsAt: "2026-09-01T00:10:00.000Z" },
    };
    await renderSurface(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
          <ToastProvider>
            <DraftRoom draftId="d1" dismissedAt="2026-01-01T00:00:00.000Z" />
          </ToastProvider>
        </ChatRoomDepsProvider>
      </DraftRoomDepsProvider>,
      async ({ container }) => {
        await waitFor(() => expect(screen.getByTestId("share-link-panel")).toBeInTheDocument());
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
