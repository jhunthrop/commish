import { describe, it, expect } from "vitest";
import { screen, waitFor, fireEvent, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ToastProvider } from "@/components/ui";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureDeps, renderInRoom } from "../test-fixtures";
import { DraftRoomDepsProvider } from "../hooks/deps";
import { DraftRoom } from "./draft-room";

function mount(fixture = fixtureDeps()) {
  const rendered = renderInRoom(
    <ToastProvider>
      <DraftRoom draftId="d1" />
    </ToastProvider>,
    fixture.deps,
  );
  return { fixture, rendered };
}

describe("DraftRoom", () => {
  it("shows a loading state, then the live snake room — both themes, axe-clean", async () => {
    const fixture = fixtureDeps();
    await inBothThemes(
      <DraftRoomDepsProvider deps={fixture.deps}>
        <ToastProvider>
          <DraftRoom draftId="d1" />
        </ToastProvider>
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

  it("offers a retry when the draft cannot be loaded", async () => {
    const fixture = fixtureDeps();
    fixture.deps = { ...fixture.deps, fetchJson: async () => ({ json: async () => ({ ok: false, error: "That draft doesn't exist." }) }) as unknown as Response };
    renderInRoom(<ToastProvider><DraftRoom draftId="d1" /></ToastProvider>, fixture.deps);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That draft doesn't exist."));
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
});
