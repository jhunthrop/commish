import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ADVISOR_ROOM_CONFIG } from "../config";
import { advisorView, candidatePlayers } from "../test-view";
import { AdvisorPanel, type AdvisorPanelProps } from "./advisor-panel";

const KEY = ADVISOR_ROOM_CONFIG.pickCount.storageKey;

function renderPanel(over: Partial<AdvisorPanelProps> = {}) {
  const props: AdvisorPanelProps = {
    view: advisorView(),
    acts: { canDraft: true, submitting: false, queueOrder: new Map(), onDraft: vi.fn(), onQueueToggle: vi.fn() },
    playersById: candidatePlayers(),
    byeWeeks: new Map([["KC", 10]]),
    recomputing: false,
    ...over,
  };
  return { ...render(<AdvisorPanel {...props} />), props };
}

describe("AdvisorPanel", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows five by default: the lead card and four rows, with the selector at 5", () => {
    renderPanel();
    expect(screen.getByTestId("advisor-card")).toBeInTheDocument();
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(4);
    const selector = screen.getByRole("group", { name: "Show" });
    expect(within(selector).getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    expect(within(selector).getAllByRole("button").map((button) => button.textContent)).toEqual(["3", "5", "10"]);
  });

  it("moves the row count with the selector, three states, and remembers the choice per browser", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "10" }));
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(9);
    await user.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(2);
    expect(window.localStorage.getItem(KEY)).toBe("3");
    await user.click(screen.getByRole("button", { name: "5" }));
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(4);
  });

  it("starts from the remembered count on a later visit", async () => {
    window.localStorage.setItem(KEY, "10");
    renderPanel();
    await waitFor(() => expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(9));
    expect(screen.getByRole("button", { name: "10" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders no strip and no filler line when the room has nothing to report, and the chips when it does", () => {
    const { unmount } = renderPanel();
    expect(screen.queryByRole("list", { name: "Runs and tiers" })).toBeNull();
    expect(screen.queryByText(/Best available/)).toBeNull();
    unmount();
    renderPanel({ view: advisorView({ signals: { run: { position: "WR", count: 3, window: 4 }, collapses: [] } }) });
    expect(screen.getByTestId("advisor-run")).toHaveTextContent("Receivers are going, 3 of the last 4 picks");
  });

  it("routes the lead card's Draft and a row's Draft through the same action", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();
    await user.click(within(screen.getByTestId("advisor-card")).getByRole("button", { name: "Draft" }));
    await user.click(screen.getByRole("button", { name: "Draft Andre Salas" }));
    expect(props.acts.onDraft).toHaveBeenNthCalledWith(1, "rb1");
    expect(props.acts.onDraft).toHaveBeenNthCalledWith(2, "wr1");
  });

  it("shows no selector and no rows when the card has no pick", () => {
    renderPanel({ view: advisorView({ pick: null, candidates: [] }) });
    expect(screen.getByText("Nothing on the board fits your roster right now.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.queryAllByTestId("advisor-candidate")).toHaveLength(0);
  });
});
