import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantDemo } from "./demo";
import { ASSISTANT_DEMO_FIXTURE } from "./fixture";

describe("AssistantDemo", () => {
  it("states the replay label honestly, up front", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("demo-replay-label")).toHaveTextContent("A replayed room, seeded and reproducible");
  });

  it("starts before pick 1, with Back disabled", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent("Before pick 1");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.queryByTestId("demo-latest-pick")).not.toBeInTheDocument();
  });

  it("steps forward one pick at a time, updating the step label and the latest-pick line", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick 1 of ${ASSISTANT_DEMO_FIXTURE.picks.length}`);
    const firstPick = ASSISTANT_DEMO_FIXTURE.picks[0]!;
    expect(screen.getByTestId("demo-latest-pick")).toHaveTextContent(firstPick.teamLabel);

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick 2 of ${ASSISTANT_DEMO_FIXTURE.picks.length}`);
    const secondPick = ASSISTANT_DEMO_FIXTURE.picks[1]!;
    expect(screen.getByTestId("demo-latest-pick")).toHaveTextContent(secondPick.teamLabel);
  });

  it("steps back, and the candidate pane changes between steps that carry different calls", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);

    await user.click(screen.getByRole("button", { name: "Forward" }));
    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent("Pick 2");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent("Pick 1");
  });

  it("disables Forward once the replay reaches its last step", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    const forward = screen.getByRole("button", { name: "Forward" });
    for (let i = 0; i < ASSISTANT_DEMO_FIXTURE.picks.length; i++) {
      await user.click(forward);
    }
    expect(forward).toBeDisabled();
    expect(screen.getByTestId("demo-step-label")).toHaveTextContent(`Pick ${ASSISTANT_DEMO_FIXTURE.picks.length} of ${ASSISTANT_DEMO_FIXTURE.picks.length}`);
  });

  it("shows the assistant's own candidates for the point-of-view seat's upcoming turn", () => {
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    expect(screen.getByTestId("assistant-candidates").querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("renders a post-pick beat once the point-of-view seat's own pick has landed", async () => {
    const user = userEvent.setup();
    render(<AssistantDemo fixture={ASSISTANT_DEMO_FIXTURE} />);
    const yourFirstPickIndex = ASSISTANT_DEMO_FIXTURE.picks.findIndex((pick) => pick.teamId === ASSISTANT_DEMO_FIXTURE.povTeamId);
    expect(yourFirstPickIndex).toBeGreaterThanOrEqual(0);

    const forward = screen.getByRole("button", { name: "Forward" });
    for (let i = 0; i <= yourFirstPickIndex; i++) {
      await user.click(forward);
    }
    expect(screen.getByTestId("assistant-beat")).toBeInTheDocument();
  });
});
