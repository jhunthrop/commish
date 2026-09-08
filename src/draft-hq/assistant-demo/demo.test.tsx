import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantDemo } from "./demo";
import { ASSISTANT_DEMO_FIXTURE } from "./fixture";

const firstOnClockStep = ASSISTANT_DEMO_FIXTURE.advisor.findIndex((view) => view.onTheClock);

async function stepTo(step: number): Promise<void> {
  const user = userEvent.setup();
  const forward = screen.getByRole("button", { name: "Forward" });
  for (let i = 0; i < step; i += 1) await user.click(forward);
}

describe("AssistantDemo", () => {
  it("states the replay label honestly, up front, runs included", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("demo-replay-label")).toHaveTextContent("A replayed room, seeded and reproducible");
    expect(screen.getByTestId("demo-replay-label")).toHaveTextContent(`${ASSISTANT_DEMO_FIXTURE.runs} runs`);
  });

  it("starts before pick 1 with Back disabled, showing the one card and the odds list", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent("Before pick 1");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByTestId("advisor-card")).toHaveAttribute("data-on-clock", "false");
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("Your next pick is 1.04, 3 picks away");
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent(`As of 1.01 · ${ASSISTANT_DEMO_FIXTURE.runs} runs`);
    expect(screen.getAllByTestId("demo-odds-row").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("demo-odds-list")).getAllByTestId("advisor-odds-pct").length).toBeGreaterThan(0);
  });

  it("steps forward one pick at a time, and the stamp and the percentages move with the room", async () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    const before = within(screen.getByTestId("demo-odds-list"))
      .getAllByTestId("demo-odds-row")
      .map((row) => row.textContent);
    await stepTo(2);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick 2 of ${ASSISTANT_DEMO_FIXTURE.picks.length}`);
    expect(screen.getByTestId("demo-latest-pick")).toHaveTextContent(ASSISTANT_DEMO_FIXTURE.picks[1]!.teamLabel);
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent("As of 1.03");
    const after = within(screen.getByTestId("demo-odds-list"))
      .getAllByTestId("demo-odds-row")
      .map((row) => row.textContent);
    expect(after).not.toEqual(before);
  });

  it("groups a single position under tier headers, and shows none over the mixed list", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.queryAllByTestId("advisor-tier-header")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "RB" }));
    const headers = screen.getAllByTestId("advisor-tier-header");
    expect(headers.length).toBeGreaterThan(0);
    expect(headers[0]).toHaveTextContent(/^Tier \d+, \d+ of \d+ left$/);
  });

  it("queues the card's pick off the clock and shows its queue order", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await user.click(screen.getByRole("button", { name: "Queue" }));
    expect(screen.getByRole("button", { name: "Queued 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Queued 1" }));
    expect(screen.getByRole("button", { name: "Queue" })).toBeInTheDocument();
  });

  it("drafts from the card on the clock through a confirmation, then steps the replay and says what the replay did", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await stepTo(firstOnClockStep);
    expect(screen.getByTestId("advisor-card")).toHaveAttribute("data-on-clock", "true");
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("You're on the clock");
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Draft" }));
    await user.click(screen.getByRole("button", { name: "Confirm pick" }));
    expect(screen.getByTestId("demo-draft-note")).toHaveTextContent(/You took/);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick ${firstOnClockStep + 1} of`);
  });

  it("renders a post-pick beat once the point-of-view seat's own pick has landed", async () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await stepTo(firstOnClockStep + 1);
    expect(screen.getByTestId("assistant-beat")).toBeInTheDocument();
  });

  it("disables Forward at the last step", async () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await stepTo(ASSISTANT_DEMO_FIXTURE.picks.length);
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });
});
