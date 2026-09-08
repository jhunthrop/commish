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

  it("starts before pick 1 with Back disabled, showing all three bands", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent("Before pick 1");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByTestId("advisor-signals")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-plan")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-now")).toBeInTheDocument();
    expect(screen.getAllByTestId("advisor-plan-turn")).toHaveLength(3);
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent(`As of 1.01 · ${ASSISTANT_DEMO_FIXTURE.runs} runs`);
  });

  it("every sentence is the template floor, and says so", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("advisor-strategy")).toHaveAttribute("data-voice", "template");
    for (const reason of screen.getAllByTestId("advisor-reason")) expect(reason).toHaveAttribute("data-voice", "template");
  });

  it("steps forward one pick at a time and the stamp moves with the room", async () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await stepTo(2);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick 2 of ${ASSISTANT_DEMO_FIXTURE.picks.length}`);
    expect(screen.getByTestId("demo-latest-pick")).toHaveTextContent(ASSISTANT_DEMO_FIXTURE.picks[1]!.teamLabel);
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent("As of 1.03");
  });

  it("queues a target off the clock and shows its queue order on the row", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    const rows = screen.getAllByTestId("advisor-now-row");
    await user.click(within(rows[0]!).getByRole("button", { name: "Queue" }));
    expect(within(rows[0]!).getByRole("button", { name: "Queued 1" })).toBeInTheDocument();
    await user.click(within(rows[1]!).getByRole("button", { name: "Queue" }));
    expect(within(rows[1]!).getByRole("button", { name: "Queued 2" })).toBeInTheDocument();
    await user.click(within(rows[0]!).getByRole("button", { name: "Queued 1" }));
    expect(within(rows[1]!).getByRole("button", { name: "Queued 1" })).toBeInTheDocument();
  });

  it("drafts from the now card on the clock through a confirmation, then steps the replay and says what the replay did", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    await stepTo(firstOnClockStep);
    expect(screen.getByTestId("advisor-now")).toHaveAttribute("data-on-clock", "true");
    const rows = screen.getAllByTestId("advisor-now-row");
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    await user.click(within(rows[0]!).getByRole("button", { name: "Draft" }));
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
